'use client';
// Parses Anki .apkg / .colpkg packages in the browser.
// Supports legacy (collection.anki2 / .anki21) and modern (collection.anki21b, zstd + schema 18).
import { unzipSync } from 'fflate';
import { decompress as zstd } from 'fzstd';
import initSqlJs, { Database } from 'sql.js';
import type { Template } from './render';

export type ParsedNotetype = { key: string; name: string; isCloze: boolean; fields: string[]; templates: Template[]; css: string };
export type ParsedDeck = { key: string; name: string };
export type ParsedNote = { notetypeKey: string; fields: string[]; tags: string[]; cards: { ord: number; deckKey: string; suspended: boolean }[] };
export type ParsedPackage = {
  notetypes: ParsedNotetype[];
  decks: ParsedDeck[];
  notes: ParsedNote[];
  media: { name: string; data: () => Uint8Array; size: number }[];
};

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => b.length > 4 && ZSTD_MAGIC.every((m, i) => b[i] === m);
const maybeZstd = (b: Uint8Array) => (isZstd(b) ? zstd(b) : b);

// ---- tiny protobuf reader (only what Anki's configs need) ----
type PbField = { no: number; wire: number; value: number | Uint8Array };
function readVarint(b: Uint8Array, pos: { i: number }): number {
  let result = 0;
  let shift = 0;
  while (pos.i < b.length) {
    const byte = b[pos.i++];
    result += (byte & 0x7f) * Math.pow(2, shift);
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  return result;
}
function pbFields(b: Uint8Array): PbField[] {
  const out: PbField[] = [];
  const pos = { i: 0 };
  while (pos.i < b.length) {
    const key = readVarint(b, pos);
    const no = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) out.push({ no, wire, value: readVarint(b, pos) });
    else if (wire === 2) {
      const len = readVarint(b, pos);
      out.push({ no, wire, value: b.subarray(pos.i, pos.i + len) });
      pos.i += len;
    } else if (wire === 1) pos.i += 8;
    else if (wire === 5) pos.i += 4;
    else break;
  }
  return out;
}
const td = new TextDecoder();
const pbString = (f: PbField[], no: number) => {
  const x = f.find((v) => v.no === no && v.wire === 2);
  return x ? td.decode(x.value as Uint8Array) : '';
};
const pbInt = (f: PbField[], no: number) => {
  const x = f.find((v) => v.no === no && v.wire === 0);
  return x ? (x.value as number) : 0;
};

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;
const sql = () => (sqlPromise ??= initSqlJs({ locateFile: () => '/sql-wasm.wasm' } as unknown as Parameters<typeof initSqlJs>[0]));

function rows(db: Database, q: string): Record<string, unknown>[] {
  const res = db.exec(q);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
}

function hasTable(db: Database, name: string) {
  return rows(db, `select name from sqlite_master where type='table' and name='${name}'`).length > 0;
}

export async function parseApkg(buf: ArrayBuffer): Promise<ParsedPackage> {
  const files = unzipSync(new Uint8Array(buf));
  const colBytes = files['collection.anki21b']
    ? zstd(files['collection.anki21b'])
    : files['collection.anki21'] || files['collection.anki2'];
  if (!colBytes) throw new Error('This file has no Anki collection inside. Is it a .apkg file?');
  const SQL = await sql();
  let db = new SQL.Database(colBytes);
  // Anki declares a custom "unicase" collation that sql.js doesn't have. Strip it from the schema and reopen.
  if (rows(db, `select 1 from sqlite_master where sql like '%unicase%' limit 1`).length) {
    db.exec(`PRAGMA writable_schema=ON;
      UPDATE sqlite_master SET sql = replace(replace(sql, 'COLLATE unicase', ''), 'collate unicase', '') WHERE sql LIKE '%unicase%';
      PRAGMA writable_schema=OFF;`);
    const fixed = db.export();
    db.close();
    db = new SQL.Database(fixed);
  }

  const notetypes: ParsedNotetype[] = [];
  const decks: ParsedDeck[] = [];

  if (hasTable(db, 'notetypes')) {
    // schema 18+
    for (const nt of rows(db, 'select id, name, config from notetypes')) {
      const cfg = pbFields(nt.config as Uint8Array);
      const id = String(nt.id);
      const fields = rows(db, `select name from fields where ntid=${id} order by ord`).map((r) => String(r.name));
      const templates = rows(db, `select name, config from templates where ntid=${id} order by ord`).map((t) => {
        const tc = pbFields(t.config as Uint8Array);
        return { name: String(t.name), qfmt: pbString(tc, 1), afmt: pbString(tc, 2) };
      });
      notetypes.push({ key: id, name: String(nt.name), isCloze: pbInt(cfg, 1) === 1, fields, templates, css: pbString(cfg, 3) });
    }
    for (const d of rows(db, 'select id, name from decks')) decks.push({ key: String(d.id), name: String(d.name).replace(/\x1f/g, '::') });
  } else {
    const col = rows(db, 'select models, decks from col')[0];
    const models = JSON.parse(String(col.models)) as Record<string, any>;
    for (const [id, m] of Object.entries(models)) {
      notetypes.push({
        key: id,
        name: m.name,
        isCloze: m.type === 1,
        fields: [...m.flds].sort((a: any, b: any) => a.ord - b.ord).map((f: any) => f.name),
        templates: [...m.tmpls].sort((a: any, b: any) => a.ord - b.ord).map((t: any) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
        css: m.css || '',
      });
    }
    for (const [id, d] of Object.entries(JSON.parse(String(col.decks)) as Record<string, any>)) decks.push({ key: id, name: d.name });
  }

  const byNote = new Map<string, ParsedNote>();
  for (const n of rows(db, 'select id, mid, flds, tags from notes')) {
    byNote.set(String(n.id), {
      notetypeKey: String(n.mid),
      fields: String(n.flds).split('\x1f'),
      tags: String(n.tags || '').trim().split(/\s+/).filter(Boolean),
      cards: [],
    });
  }
  for (const c of rows(db, 'select nid, did, odid, ord, queue from cards')) {
    const note = byNote.get(String(c.nid));
    if (!note) continue;
    const deck = Number(c.odid) ? String(c.odid) : String(c.did);
    note.cards.push({ ord: Number(c.ord), deckKey: deck, suspended: Number(c.queue) === -1 });
  }
  db.close();

  // Drop the placeholder "please update Anki" note that modern exports put in the legacy file.
  const notes = [...byNote.values()].filter((n) => n.cards.length);
  const usedDecks = new Set(notes.flatMap((n) => n.cards.map((c) => c.deckKey)));
  const usedNt = new Set(notes.map((n) => n.notetypeKey));

  // media map
  const media: ParsedPackage['media'] = [];
  const mediaFile = files['media'];
  if (mediaFile) {
    const raw = maybeZstd(mediaFile);
    let names: [string, string][] = [];
    try {
      const json = JSON.parse(td.decode(raw)) as Record<string, string>;
      names = Object.entries(json);
    } catch {
      // protobuf MediaEntries { repeated MediaEntry entries = 1 { string name = 1; uint32 size = 2; ... } }
      pbFields(raw)
        .filter((f) => f.no === 1 && f.wire === 2)
        .forEach((f, i) => names.push([String(i), pbString(pbFields(f.value as Uint8Array), 1)]));
    }
    for (const [idx, name] of names) {
      const bytes = files[idx];
      if (!bytes || !name) continue;
      media.push({ name, size: bytes.length, data: () => maybeZstd(bytes) });
    }
  }

  return {
    notetypes: notetypes.filter((n) => usedNt.has(n.key)),
    decks: decks.filter((d) => usedDecks.has(d.key)),
    notes,
    media,
  };
}

/** Replace media references in note fields with uploaded URLs. */
/** All media filenames referenced by src= attributes or [sound:] tags. */
export function mediaRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'>\s]+))/gi)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1]);
  return out.filter((n) => n && !/^(https?:|data:|\/)/i.test(n));
}

export function rewriteMedia(field: string, urls: Map<string, string>): string {
  if (!urls.size) return field;
  const sub = (name: string) => {
    const decoded = (() => {
      try {
        return decodeURIComponent(name);
      } catch {
        return name;
      }
    })();
    return urls.get(name) || urls.get(decoded);
  };
  return field
    .replace(/(src\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^"'>\s]+))/gi, (all, pre, a, b, c) => {
      const u = sub(a ?? b ?? c);
      return u ? `${pre}"${u}"` : all;
    })
    .replace(/\[sound:([^\]]+)\]/g, (all, name) => {
      const u = sub(name);
      return u ? `[sound:${u}]` : all;
    });
}

/** Simple CSV/TSV: first column front, second back. */
export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const sample = lines.slice(0, 20).join('\n');
  const delim = ['\t', ';', ','].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === delim) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

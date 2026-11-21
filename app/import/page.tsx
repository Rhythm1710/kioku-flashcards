'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import TopBar from '@/components/TopBar';
import { api, dayStart } from '@/lib/client';
import type { ParsedPackage } from '@/lib/apkg';

type Stage = 'idle' | 'parsing' | 'ready' | 'importing' | 'done';
const BATCH = 400;
const MAX_MEDIA = 4_400_000;

function referencedMedia(pkg: ParsedPackage, refs: (h: string) => string[]): Set<string> {
  const names = new Set<string>();
  const add = (n: string) => {
    names.add(n);
    try {
      names.add(decodeURIComponent(n));
    } catch {}
  };
  for (const n of pkg.notes) for (const f of n.fields) refs(f).forEach(add);
  for (const nt of pkg.notetypes) for (const t of nt.templates) refs(t.qfmt + t.afmt).forEach(add);
  return names;
}

export default function ImportPage() {
  const [stage, setStage] = useState<Stage>('idle');
  const [pkg, setPkg] = useState<ParsedPackage | null>(null);
  const [csv, setCsv] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState({ label: '', pct: 0 });
  const [result, setResult] = useState('');
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([]);
  const [csvDeck, setCsvDeck] = useState('');
  const [csvType, setCsvType] = useState('');
  const [nts, setNts] = useState<{ id: string; name: string; isCloze: boolean; fields: string[] }[]>([]);

  useEffect(() => {
    api(`/api/decks?dayStart=${encodeURIComponent(dayStart())}`).then((d) => {
      setDecks(d.decks);
      setCsvDeck(d.decks[0]?.id || '');
    });
    api('/api/notetypes').then((d) => {
      setNts(d.notetypes);
      setCsvType(d.notetypes.find((n: { name: string }) => n.name === 'Basic')?.id || d.notetypes[0]?.id || '');
    });
  }, []);

  async function pick(file: File) {
    setErr('');
    setResult('');
    setPkg(null);
    setCsv(null);
    setFileName(file.name);
    setStage('parsing');
    try {
      if (/\.(apkg|colpkg)$/i.test(file.name)) {
        const { parseApkg } = await import('@/lib/apkg');
        setPkg(await parseApkg(await file.arrayBuffer()));
      } else {
        const { parseDelimited } = await import('@/lib/apkg');
        const rows = parseDelimited(await file.text()).filter((r) => r.some((c) => c.trim()));
        if (!rows.length) throw new Error('No rows found in the file');
        setCsv(rows);
      }
      setStage('ready');
    } catch (e) {
      console.error(e);
      setErr((e as Error).message || 'Could not read this file');
      setStage('idle');
    }
  }

  async function runApkg(p: ParsedPackage) {
    setStage('importing');
    setErr('');
    try {
      const { rewriteMedia, mediaRefs } = await import('@/lib/apkg');
      const wanted = referencedMedia(p, mediaRefs);
      const media = p.media.filter((m) => wanted.has(m.name));
      const urls = new Map<string, string>();
      let skipped = 0;
      let doneMedia = 0;
      const queue = [...media];
      const worker = async () => {
        while (queue.length) {
          const m = queue.shift()!;
          try {
            const data = m.data();
            if (data.length > MAX_MEDIA) {
              skipped++;
            } else {
              const fd = new FormData();
              fd.append('file', new Blob([data as BlobPart]), m.name);
              fd.append('name', m.name);
              const { url } = await api<{ url: string }>('/api/media', { method: 'POST', body: fd });
              urls.set(m.name, url);
            }
          } catch {
            skipped++;
          }
          doneMedia++;
          setProgress({ label: `Uploading media ${doneMedia}/${media.length}`, pct: (doneMedia / Math.max(1, media.length)) * 50 });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);

      setProgress({ label: 'Creating decks and note types', pct: 50 });
      const { notetypeMap, deckMap } = await api('/api/import/setup', {
        method: 'POST',
        json: {
          notetypes: p.notetypes.map((nt) => ({
            ...nt,
            templates: nt.templates.map((t) => ({ ...t, qfmt: rewriteMedia(t.qfmt, urls), afmt: rewriteMedia(t.afmt, urls) })),
          })),
          decks: p.decks,
        },
      });
      let imported = 0;
      for (let i = 0; i < p.notes.length; i += BATCH) {
        const batch = p.notes.slice(i, i + BATCH).map((n) => ({
          notetypeId: notetypeMap[n.notetypeKey],
          fields: n.fields.map((f) => rewriteMedia(f, urls)),
          tags: n.tags,
          cards: n.cards.map((c) => ({ ord: c.ord, deckId: deckMap[c.deckKey], suspended: c.suspended })),
        }));
        const r = await api<{ imported: number }>('/api/import/notes', { method: 'POST', json: { notes: batch } });
        imported += r.imported;
        setProgress({ label: `Importing notes ${Math.min(i + BATCH, p.notes.length)}/${p.notes.length}`, pct: 50 + ((i + BATCH) / p.notes.length) * 50 });
      }
      setResult(
        `Imported ${imported} notes into ${p.decks.length} deck${p.decks.length > 1 ? 's' : ''}` +
          (urls.size ? `, with ${urls.size} media files` : '') +
          (skipped ? `. ${skipped} media files were skipped (too large or failed).` : '.') +
          ' Cards start as new; Anki review history is not carried over.',
      );
      setStage('done');
    } catch (e) {
      setErr((e as Error).message);
      setStage('ready');
    }
  }

  async function runCsv(rows: string[][]) {
    setStage('importing');
    try {
      const nt = nts.find((n) => n.id === csvType)!;
      const notes = rows.map((r) => {
        const fields = nt.fields.map((_, i) => (r[i] ?? '').trim());
        return { notetypeId: nt.id, fields, tags: [], cards: [] as { ord: number; deckId: string }[] };
      });
      const { cardOrds } = await import('@/lib/render');
      const full = nts.find((n) => n.id === csvType) as any;
      for (const n of notes) n.cards = cardOrds({ isCloze: full.isCloze, fields: full.fields, templates: full.templates }, n.fields).map((ord) => ({ ord, deckId: csvDeck }));
      let imported = 0;
      for (let i = 0; i < notes.length; i += BATCH) {
        const r = await api<{ imported: number }>('/api/import/notes', { method: 'POST', json: { notes: notes.slice(i, i + BATCH) } });
        imported += r.imported;
        setProgress({ label: `Importing ${Math.min(i + BATCH, notes.length)}/${notes.length}`, pct: ((i + BATCH) / notes.length) * 100 });
      }
      setResult(`Imported ${imported} notes.`);
      setStage('done');
    } catch (e) {
      setErr((e as Error).message);
      setStage('ready');
    }
  }

  const deckCounts = pkg
    ? pkg.decks.map((d) => ({ name: d.name, n: pkg.notes.reduce((a, n) => a + n.cards.filter((c) => c.deckKey === d.key).length, 0) }))
    : [];

  return (
    <>
      <TopBar title="Import" />
      <main>
        <div className="panel" style={{ padding: 20 }}>
          <p style={{ marginTop: 0 }}>
            Import an Anki deck (<b>.apkg</b>) exported from Anki desktop, AnkiDroid or downloaded from AnkiWeb shared decks. You can
            also import a <b>CSV/TSV</b> file where each row is one card.
          </p>
          <label className="btn primary" style={{ display: 'inline-flex', margin: 0, color: 'var(--accent-ink)' }}>
            Choose file
            <input
              type="file"
              accept=".apkg,.colpkg,.csv,.tsv,.txt"
              hidden
              onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
              disabled={stage === 'importing'}
            />
          </label>
          {fileName && <span className="muted" style={{ marginLeft: 12 }}>{fileName}</span>}
          {stage === 'parsing' && <p className="muted">Reading the package…</p>}
          {err && <div className="err">{err}</div>}

          {pkg && stage !== 'idle' && (
            <div style={{ marginTop: 18 }}>
              <strong>
                {pkg.notes.length} notes, {pkg.notes.reduce((a, n) => a + n.cards.length, 0)} cards, {pkg.media.length} media files
              </strong>
              <ul className="muted">
                {deckCounts.map((d) => (
                  <li key={d.name}>
                    {d.name} ({d.n} cards)
                  </li>
                ))}
              </ul>
              <div className="muted" style={{ fontSize: 15 }}>
                Note types: {pkg.notetypes.map((n) => n.name).join(', ')}
              </div>
              {stage === 'ready' && (
                <button className="btn primary" style={{ marginTop: 14 }} onClick={() => runApkg(pkg)}>
                  Import
                </button>
              )}
            </div>
          )}

          {csv && stage !== 'idle' && (
            <div style={{ marginTop: 18 }}>
              <strong>{csv.length} rows</strong>
              <div className="muted" style={{ fontSize: 15 }}>
                First row: {csv[0].slice(0, 3).join(' | ')}
              </div>
              <div className="row">
                <div className="grow">
                  <label>Note type (columns map to fields in order)</label>
                  <select value={csvType} onChange={(e) => setCsvType(e.target.value)}>
                    {nts.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.fields.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grow">
                  <label>Deck</label>
                  <select value={csvDeck} onChange={(e) => setCsvDeck(e.target.value)}>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {stage === 'ready' && (
                <button className="btn primary" style={{ marginTop: 14 }} onClick={() => runCsv(csv)}>
                  Import
                </button>
              )}
            </div>
          )}

          {stage === 'importing' && (
            <div style={{ marginTop: 16 }}>
              <div className="muted">{progress.label}</div>
              <div className="progress">
                <div style={{ width: `${Math.min(100, progress.pct)}%` }} />
              </div>
              <p className="muted" style={{ fontSize: 14 }}>Keep this screen open until it finishes.</p>
            </div>
          )}
          {stage === 'done' && (
            <div style={{ marginTop: 16 }}>
              <div className="ok">{result}</div>
              <Link href="/" className="btn primary" style={{ marginTop: 12 }}>
                Go to decks
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

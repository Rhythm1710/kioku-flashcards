import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { cardOrds } from './render';
import { HttpError } from './auth';

export async function loadNotetype(c: PoolClient, userId: string, id: string) {
  const r = await c.query('select id, name, is_cloze, fields, templates, css from notetypes where id=$1 and user_id=$2', [
    id,
    userId,
  ]);
  if (!r.rowCount) throw new HttpError(404, 'Note type not found');
  const n = r.rows[0];
  return { id: n.id, name: n.name, isCloze: n.is_cloze, fields: n.fields as string[], templates: n.templates, css: n.css };
}

export async function assertDeck(c: PoolClient, userId: string, deckId: string) {
  const r = await c.query('select 1 from decks where id=$1 and user_id=$2', [deckId, userId]);
  if (!r.rowCount) throw new HttpError(404, 'Deck not found');
}

/** Bulk insert notes + cards (used by editor and importer). */
export async function insertNotes(
  c: PoolClient,
  userId: string,
  items: { notetypeId: string; fields: string[]; tags: string[]; cards: { ord: number; deckId: string; suspended?: boolean }[] }[],
) {
  if (!items.length) return 0;
  const noteIds: string[] = [];
  const ntIds: string[] = [];
  const fields: string[] = [];
  const tags: string[] = [];
  const cId: string[] = [];
  const cNote: string[] = [];
  const cDeck: string[] = [];
  const cOrd: number[] = [];
  const cSusp: boolean[] = [];
  const base = Date.now();
  const cCreated: string[] = [];
  items.forEach((it, i) => {
    const id = randomUUID();
    noteIds.push(id);
    ntIds.push(it.notetypeId);
    fields.push(JSON.stringify(it.fields));
    tags.push(JSON.stringify(it.tags || []));
    const seen = new Set<number>();
    for (const card of it.cards) {
      if (seen.has(card.ord)) continue;
      seen.add(card.ord);
      cId.push(randomUUID());
      cNote.push(id);
      cDeck.push(card.deckId);
      cOrd.push(card.ord);
      cSusp.push(!!card.suspended);
      cCreated.push(new Date(base + i).toISOString());
    }
  });
  await c.query(
    `insert into notes(id, user_id, notetype_id, fields, tags)
     select id, $1, nt, f::jsonb, array(select jsonb_array_elements_text(t::jsonb))
     from unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[]) as x(id, nt, f, t)`,
    [userId, noteIds, ntIds, fields, tags],
  );
  await c.query(
    `insert into cards(id, user_id, note_id, deck_id, ord, suspended, created_at)
     select id, $1, n, d, o, s, ca from unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::int[], $6::bool[], $7::timestamptz[]) as x(id, n, d, o, s, ca)`,
    [userId, cId, cNote, cDeck, cOrd, cSusp, cCreated],
  );
  return items.length;
}

export function ordsFor(nt: Awaited<ReturnType<typeof loadNotetype>>, fields: string[]) {
  return cardOrds(nt, fields);
}

/** Create a deck and any missing parent decks ("A::B::C" creates A and A::B). Returns the deck id. */
export async function ensureDeck(c: PoolClient | import('pg').Pool, userId: string, rawName: string): Promise<string> {
  const parts = rawName.split('::').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) parts.push('Default');
  let id = '';
  for (let i = 1; i <= parts.length; i++) {
    const r = await c.query(
      `insert into decks(user_id, name) values ($1,$2) on conflict (user_id, name) do update set name=excluded.name returning id`,
      [userId, parts.slice(0, i).join('::')],
    );
    id = r.rows[0].id;
  }
  return id;
}

import { db, tx } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';
import { assertDeck, insertNotes, loadNotetype, ordsFor } from '@/lib/notes';
import { stripHtml } from '@/lib/render';

export const POST = handler(async (req: Request) => {
  const u = await requireUser();
  const body = await req.json();
  const fields: string[] = Array.isArray(body.fields) ? body.fields.map(String) : [];
  if (!fields.some((f) => stripHtml(f))) throw new HttpError(400, 'The note is empty');
  return tx(async (c) => {
    const nt = await loadNotetype(c, u.id, body.notetypeId);
    await assertDeck(c, u.id, body.deckId);
    if (nt.isCloze && !/\{\{c\d+::/.test(fields.join(''))) throw new HttpError(400, 'Add at least one cloze like {{c1::text}}');
    const ords = ordsFor(nt, fields);
    await insertNotes(c, u.id, [
      { notetypeId: nt.id, fields, tags: body.tags || [], cards: ords.map((ord) => ({ ord, deckId: body.deckId })) },
    ]);
    return { ok: true, cards: ords.length };
  });
});

export const GET = handler(async (req: Request) => {
  const u = await requireUser();
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const deck = url.searchParams.get('deck');
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const p = await db();
  const params: unknown[] = [u.id];
  let where = 'n.user_id=$1';
  if (q) {
    params.push('%' + q.replace(/[%_]/g, '\\$&') + '%');
    where += ` and (n.fields::text ilike $${params.length} or array_to_string(n.tags,' ') ilike $${params.length})`;
  }
  if (deck) {
    params.push(deck);
    where += ` and exists (select 1 from cards c2 join decks d2 on d2.id=c2.deck_id join decks d3 on d3.id=$${params.length}
      where c2.note_id=n.id and (d2.id=d3.id or d2.name like d3.name || '::%'))`;
  }
  const r = await p.query(
    `select n.id, n.fields->>0 as first, n.fields->>1 as second, nt.name as notetype,
       (select d.name from cards c join decks d on d.id=c.deck_id where c.note_id=n.id limit 1) as deck,
       (select count(*)::int from cards c where c.note_id=n.id) as cards,
       (select bool_and(c.suspended) from cards c where c.note_id=n.id) as suspended
     from notes n join notetypes nt on nt.id=n.notetype_id
     where ${where} order by n.created_at desc limit 100 offset ${offset}`,
    params,
  );
  return {
    notes: r.rows.map((n) => ({
      ...n,
      first: stripHtml(n.first || '').slice(0, 140),
      second: stripHtml(n.second || '').slice(0, 140),
    })),
  };
});

import { randomUUID } from 'crypto';
import { db, tx } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';
import { assertDeck, loadNotetype, ordsFor } from '@/lib/notes';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const p = await db();
  const n = await p.query('select id, notetype_id, fields, tags from notes where id=$1 and user_id=$2', [id, u.id]);
  if (!n.rowCount) throw new HttpError(404, 'Note not found');
  const cards = await p.query(
    'select id, ord, deck_id, state, due, suspended from cards where note_id=$1 order by ord',
    [id],
  );
  return { note: n.rows[0], cards: cards.rows };
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const body = await req.json();
  return tx(async (c) => {
    const n = await c.query('select notetype_id from notes where id=$1 and user_id=$2', [id, u.id]);
    if (!n.rowCount) throw new HttpError(404, 'Note not found');
    const nt = await loadNotetype(c, u.id, n.rows[0].notetype_id);
    if (Array.isArray(body.fields)) {
      const fields = body.fields.map(String);
      await c.query('update notes set fields=$1, tags=$2, updated_at=now() where id=$3', [
        JSON.stringify(fields),
        Array.isArray(body.tags) ? body.tags : [],
        id,
      ]);
      const existing = await c.query('select ord, deck_id from cards where note_id=$1', [id]);
      const have = new Set(existing.rows.map((r) => r.ord));
      const deckId = body.deckId || existing.rows[0]?.deck_id;
      for (const ord of ordsFor(nt, fields)) {
        if (!have.has(ord))
          await c.query('insert into cards(id, user_id, note_id, deck_id, ord) values ($1,$2,$3,$4,$5)', [
            randomUUID(),
            u.id,
            id,
            deckId,
            ord,
          ]);
      }
    }
    if (body.deckId) {
      await assertDeck(c, u.id, body.deckId);
      await c.query('update cards set deck_id=$1 where note_id=$2', [body.deckId, id]);
    }
    if (typeof body.suspended === 'boolean') await c.query('update cards set suspended=$1 where note_id=$2', [body.suspended, id]);
    if (body.reset) await c.query(`update cards set state=0, fsrs=null, due=now(), last_review=null where note_id=$1`, [id]);
    return { ok: true };
  });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const p = await db();
  await p.query('delete from notes where id=$1 and user_id=$2', [id, u.id]);
  return { ok: true };
});

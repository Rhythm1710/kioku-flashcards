import { db, tx } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';
import { ensureDeck } from '@/lib/notes';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const body = await req.json();
  return tx(async (c) => {
    const cur = await c.query('select name from decks where id=$1 and user_id=$2', [id, u.id]);
    if (!cur.rowCount) throw new HttpError(404, 'Deck not found');
    const old: string = cur.rows[0].name;
    if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== old) {
      const name = body.name.trim();
      const clash = await c.query('select 1 from decks where user_id=$1 and name=$2', [u.id, name]);
      if (clash.rowCount) throw new HttpError(409, 'A deck with that name exists');
      await c.query(
        `update decks set name = $3 || substr(name, length($2) + 1) where user_id=$1 and (name=$2 or name like $2 || '::%')`,
        [u.id, old, name],
      );
      if (name.includes('::')) await ensureDeck(c, u.id, name.split('::').slice(0, -1).join('::'));
    }
    if (Number.isFinite(body.newPerDay))
      await c.query('update decks set new_per_day=$1 where id=$2', [Math.max(0, Math.min(9999, body.newPerDay | 0)), id]);
    if (Number.isFinite(body.reviewsPerDay))
      await c.query('update decks set reviews_per_day=$1 where id=$2', [Math.max(0, Math.min(99999, body.reviewsPerDay | 0)), id]);
    return { ok: true };
  });
});

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const p = await db();
  const cur = await p.query('select name from decks where id=$1 and user_id=$2', [id, u.id]);
  if (!cur.rowCount) throw new HttpError(404, 'Deck not found');
  const name = cur.rows[0].name;
  await p.query(`delete from notes where user_id=$1 and id in (
      select c.note_id from cards c join decks d on d.id=c.deck_id
      where d.user_id=$1 and (d.name=$2 or d.name like $2 || '::%'))`, [u.id, name]);
  await p.query(`delete from decks where user_id=$1 and (name=$2 or name like $2 || '::%')`, [u.id, name]);
  return { ok: true };
});

import { db } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';
import { deckCounts } from '@/lib/queries';
import { ensureDeck } from '@/lib/notes';

export const GET = handler(async (req: Request) => {
  const u = await requireUser();
  const url = new URL(req.url);
  const p = await db();
  const today = await p.query(
    `select count(*)::int as n from revlog where user_id=$1 and reviewed_at >= $2`,
    [u.id, url.searchParams.get('dayStart') || new Date(Date.now() - 43200000).toISOString()],
  );
  return { decks: await deckCounts(u.id, url.searchParams), reviewedToday: today.rows[0].n, email: u.email };
});

export const POST = handler(async (req: Request) => {
  const u = await requireUser();
  const { name } = await req.json();
  const clean = String(name || '')
    .split('::')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('::');
  if (!clean) throw new HttpError(400, 'Deck name required');
  return { id: await ensureDeck(await db(), u.id, clean) };
});

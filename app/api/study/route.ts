import { handler, HttpError, requireUser } from '@/lib/auth';
import { studyQueue } from '@/lib/queries';

export const GET = handler(async (req: Request) => {
  const u = await requireUser();
  const url = new URL(req.url);
  const deck = url.searchParams.get('deck') || '';
  const q = await studyQueue(u.id, deck, url.searchParams);
  if (!q) throw new HttpError(404, 'Deck not found');
  return q;
});

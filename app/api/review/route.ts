import { tx } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';

type Review = {
  clientId: string;
  cardId: string;
  card: { due: string; state: number; last_review?: string } & Record<string, unknown>;
  rating: number;
  prevState: number;
  reviewedAt: string;
};

export const POST = handler(async (req: Request) => {
  const u = await requireUser();
  const { reviews } = (await req.json()) as { reviews: Review[] };
  if (!Array.isArray(reviews) || reviews.length > 1000) throw new HttpError(400, 'Bad reviews payload');
  const done: string[] = [];
  await tx(async (c) => {
    for (const r of reviews) {
      const at = new Date(r.reviewedAt);
      if (isNaN(+at) || !r.card || ![1, 2, 3, 4].includes(r.rating)) continue;
      const ins = await c.query(
        `insert into revlog(user_id, card_id, deck_id, rating, prev_state, reviewed_at, client_id)
         select $1, c.id, c.deck_id, $3, $4, $5, $6 from cards c where c.id=$2 and c.user_id=$1
         on conflict (client_id) do nothing returning id`,
        [u.id, r.cardId, r.rating, r.prevState, at, r.clientId],
      );
      if (ins.rowCount) {
        await c.query(
          `update cards set fsrs=$3, state=$4, due=$5, last_review=$6
           where id=$1 and user_id=$2 and (last_review is null or last_review <= $6)`,
          [r.cardId, u.id, JSON.stringify(r.card), r.card.state, new Date(r.card.due), at],
        );
      }
      done.push(r.clientId);
    }
  });
  return { done };
});

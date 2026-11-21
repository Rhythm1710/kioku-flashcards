import { db } from './db';

export type DeckRow = {
  id: string;
  name: string;
  newPerDay: number;
  reviewsPerDay: number;
  newAvail: number;
  learn: number;
  review: number;
  total: number;
};

function day(params: URLSearchParams) {
  const now = Date.now();
  const s = Date.parse(params.get('dayStart') || '');
  const dayStart = Number.isFinite(s) ? new Date(s) : new Date(now - 86400000 / 2);
  const dayEnd = new Date(dayStart.getTime() + 86400000);
  return { dayStart, dayEnd };
}

export async function deckCounts(userId: string, params: URLSearchParams): Promise<DeckRow[]> {
  const { dayStart, dayEnd } = day(params);
  const p = await db();
  const [decks, today] = await Promise.all([
    p.query(
      `select d.id, d.name, d.new_per_day, d.reviews_per_day,
        count(c.id) filter (where c.state=0 and not c.suspended)::int as new_count,
        count(c.id) filter (where c.state in (1,3) and c.due <= $2 and not c.suspended)::int as learn,
        count(c.id) filter (where c.state=2 and c.due <= $2 and not c.suspended)::int as review,
        count(c.id)::int as total
      from decks d left join cards c on c.deck_id = d.id
      where d.user_id = $1 group by d.id order by d.name`,
      [userId, dayEnd],
    ),
    p.query(
      `select deck_id,
        count(distinct card_id) filter (where prev_state=0)::int as introduced,
        count(*) filter (where prev_state=2)::int as reviewed
       from revlog where user_id=$1 and reviewed_at >= $2 group by deck_id`,
      [userId, dayStart],
    ),
  ]);
  const t = new Map(today.rows.map((r) => [r.deck_id, r]));
  return decks.rows.map((d) => {
    const tt = t.get(d.id) || { introduced: 0, reviewed: 0 };
    return {
      id: d.id,
      name: d.name,
      newPerDay: d.new_per_day,
      reviewsPerDay: d.reviews_per_day,
      newAvail: Math.max(0, Math.min(d.new_count, d.new_per_day - tt.introduced)),
      learn: d.learn,
      review: Math.max(0, Math.min(d.review, d.reviews_per_day - tt.reviewed)),
      total: d.total,
    };
  });
}

export async function studyQueue(userId: string, deckId: string, params: URLSearchParams) {
  const { dayEnd } = day(params);
  const all = await deckCounts(userId, params);
  const root = all.find((d) => d.id === deckId);
  if (!root) return null;
  const subtree = all.filter((d) => d.id === deckId || d.name.startsWith(root.name + '::'));
  const p = await db();

  const cardCols = `c.id, c.note_id, c.deck_id, c.ord, c.state, c.due, c.fsrs, c.last_review`;
  const parts: Promise<{ rows: Record<string, unknown>[] }>[] = [];
  let newLeft = root.newPerDay; // the selected deck's limit caps subdecks too
  let revLeft = root.reviewsPerDay;
  for (const d of subtree) {
    const n = Math.min(d.newAvail, newLeft);
    newLeft -= n;
    const r = Math.min(d.review, revLeft);
    revLeft -= r;
    if (n > 0)
      parts.push(
        p.query(
          `select ${cardCols} from cards c where c.deck_id=$1 and c.state=0 and not c.suspended order by c.created_at, c.ord limit $2`,
          [d.id, n],
        ),
      );
    if (r > 0)
      parts.push(
        p.query(
          `select ${cardCols} from cards c where c.deck_id=$1 and c.state=2 and c.due <= $2 and not c.suspended order by c.due limit $3`,
          [d.id, dayEnd, r],
        ),
      );
  }
  parts.push(
    p.query(
      `select ${cardCols} from cards c where c.deck_id = any($1) and c.state in (1,3) and c.due <= $2 and not c.suspended order by c.due limit 500`,
      [subtree.map((d) => d.id), dayEnd],
    ),
  );
  const cards = (await Promise.all(parts)).flatMap((r) => r.rows);
  const noteIds = [...new Set(cards.map((c) => c.note_id as string))];
  const notes = noteIds.length
    ? (
        await p.query(
          `select n.id, n.fields, n.tags, n.notetype_id from notes n where n.id = any($1) and n.user_id=$2`,
          [noteIds, userId],
        )
      ).rows
    : [];
  const ntIds = [...new Set(notes.map((n) => n.notetype_id))];
  const notetypes = ntIds.length
    ? (await p.query(`select id, name, is_cloze, fields, templates, css from notetypes where id = any($1)`, [ntIds])).rows
    : [];
  return {
    deck: root,
    decks: Object.fromEntries(subtree.map((d) => [d.id, d.name])),
    cards,
    notes,
    notetypes: notetypes.map((n) => ({
      id: n.id,
      name: n.name,
      isCloze: n.is_cloze,
      fields: n.fields,
      templates: n.templates,
      css: n.css,
    })),
  };
}

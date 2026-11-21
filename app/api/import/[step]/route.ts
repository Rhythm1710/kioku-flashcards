import { tx } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';
import { ensureDeck, insertNotes } from '@/lib/notes';

type Ctx = { params: Promise<{ step: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const { step } = await ctx.params;
  const body = await req.json();

  if (step === 'setup') {
    // Create note types and decks; return key -> id maps.
    return tx(async (c) => {
      const notetypeMap: Record<string, string> = {};
      const deckMap: Record<string, string> = {};
      for (const nt of body.notetypes || []) {
        const r = await c.query(
          'insert into notetypes(user_id, name, is_cloze, fields, templates, css) values ($1,$2,$3,$4,$5,$6) returning id',
          [u.id, String(nt.name).slice(0, 200), !!nt.isCloze, JSON.stringify(nt.fields), JSON.stringify(nt.templates), nt.css || ''],
        );
        notetypeMap[nt.key] = r.rows[0].id;
      }
      for (const d of body.decks || []) {
        deckMap[d.key] = await ensureDeck(c, u.id, String(d.name || 'Imported'));
      }
      return { notetypeMap, deckMap };
    });
  }

  if (step === 'notes') {
    const notes = body.notes;
    if (!Array.isArray(notes) || notes.length > 1000) throw new HttpError(400, 'Send up to 1000 notes per batch');
    return tx(async (c) => {
      const owned = await c.query('select id from notetypes where user_id=$1', [u.id]);
      const decks = await c.query('select id from decks where user_id=$1', [u.id]);
      const ntOk = new Set(owned.rows.map((r) => r.id));
      const deckOk = new Set(decks.rows.map((r) => r.id));
      const clean = notes
        .filter((n) => ntOk.has(n.notetypeId) && Array.isArray(n.fields) && Array.isArray(n.cards))
        .map((n) => ({
          notetypeId: n.notetypeId,
          fields: n.fields.map(String),
          tags: (n.tags || []).map(String),
          cards: n.cards.filter((cd: { deckId: string }) => deckOk.has(cd.deckId)),
        }))
        .filter((n) => n.cards.length);
      const count = await insertNotes(c, u.id, clean);
      return { imported: count };
    });
  }
  throw new HttpError(404, 'Unknown step');
});

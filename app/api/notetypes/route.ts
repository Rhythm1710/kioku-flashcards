import { db } from '@/lib/db';
import { handler, requireUser } from '@/lib/auth';

export const GET = handler(async () => {
  const u = await requireUser();
  const p = await db();
  const r = await p.query(
    `select nt.id, nt.name, nt.is_cloze, nt.fields, nt.templates, nt.css,
       (select count(*)::int from notes n where n.notetype_id=nt.id) as notes
     from notetypes nt where nt.user_id=$1 order by nt.created_at`,
    [u.id],
  );
  return {
    notetypes: r.rows.map((n) => ({
      id: n.id,
      name: n.name,
      isCloze: n.is_cloze,
      fields: n.fields,
      templates: n.templates,
      css: n.css,
      notes: n.notes,
    })),
  };
});

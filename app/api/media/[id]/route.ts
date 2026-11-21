import { db } from '@/lib/db';

export const runtime = 'nodejs';

// Public by unguessable id so images load inside cards without extra auth plumbing.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const p = await db();
  const r = await p.query('select content_type, url, data from media where id=$1', [id]);
  const m = r.rows[0];
  if (!m) return new Response('Not found', { status: 404 });
  if (m.url) return Response.redirect(m.url, 308);
  return new Response(m.data, {
    headers: { 'content-type': m.content_type, 'cache-control': 'public, max-age=31536000, immutable' },
  });
}

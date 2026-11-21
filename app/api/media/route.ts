import { randomUUID } from 'crypto';
import { put } from '@vercel/blob';
import { db } from '@/lib/db';
import { handler, HttpError, requireUser } from '@/lib/auth';

export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm',
};

export const POST = handler(async (req: Request) => {
  const u = await requireUser();
  const form = await req.formData();
  const file = form.get('file');
  const name = String(form.get('name') || (file instanceof File ? file.name : 'file'));
  if (!(file instanceof Blob)) throw new HttpError(400, 'No file');
  if (file.size > 4_400_000) throw new HttpError(413, 'File too large (max 4.4 MB)');
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const type = TYPES[ext] || file.type || 'application/octet-stream';
  const id = randomUUID();
  const p = await db();
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const safe = name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const blob = await put(`media/${u.id}/${id}-${safe}`, file, { access: 'public', contentType: type, addRandomSuffix: false });
    await p.query('insert into media(id, user_id, name, content_type, url) values ($1,$2,$3,$4,$5)', [id, u.id, name, type, blob.url]);
    return { id, url: blob.url };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  await p.query('insert into media(id, user_id, name, content_type, data) values ($1,$2,$3,$4,$5)', [id, u.id, name, type, buf]);
  return { id, url: `/api/media/${id}` };
});

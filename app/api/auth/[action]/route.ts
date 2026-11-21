import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { createSession, currentUser, destroySession, handler, HttpError, seedUser } from '@/lib/auth';

export const POST = handler(async (req: Request, ctx: { params: Promise<{ action: string }> }) => {
  const { action } = await ctx.params;
  if (action === 'logout') {
    await destroySession();
    return { ok: true };
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email.includes('@') || password.length < 8) throw new HttpError(400, 'Enter an email and a password of at least 8 characters');
  const p = await db();

  if (action === 'signup') {
    const invite = process.env.INVITE_CODE;
    if (invite && String(body.invite || '').trim() !== invite) throw new HttpError(403, 'Invalid invite code');
    const exists = await p.query('select 1 from users where email=$1', [email]);
    if (exists.rowCount) throw new HttpError(409, 'An account with this email already exists');
    const r = await p.query('insert into users(email, password_hash) values ($1,$2) returning id', [
      email,
      await bcrypt.hash(password, 10),
    ]);
    await seedUser(r.rows[0].id);
    await createSession(r.rows[0].id);
    return { ok: true };
  }

  if (action === 'login') {
    const r = await p.query('select id, password_hash from users where email=$1', [email]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'Wrong email or password');
    await createSession(u.id);
    return { ok: true };
  }
  throw new HttpError(404, 'Unknown action');
});

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ action: string }> }) => {
  const { action } = await ctx.params;
  if (action !== 'me') throw new HttpError(404, 'Not found');
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Not signed in');
  return { user: u, inviteRequired: !!process.env.INVITE_CODE };
});

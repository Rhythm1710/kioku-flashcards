import { cookies } from 'next/headers';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from './db';
import { BUILTIN_NOTETYPES } from './render';

const COOKIE = 'sid';
const DAYS = 180;

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const p = await db();
  await p.query(`insert into sessions(token_hash, user_id, expires_at) values ($1,$2, now() + interval '${DAYS} days')`, [
    hash(token),
    userId,
  ]);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) {
    const p = await db();
    await p.query('delete from sessions where token_hash=$1', [hash(t)]);
  }
  jar.delete(COOKIE);
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const p = await db();
  const r = await p.query(
    `select u.id, u.email from sessions s join users u on u.id = s.user_id where s.token_hash=$1 and s.expires_at > now()`,
    [hash(t)],
  );
  return r.rows[0] ?? null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Not signed in');
  return u;
}

/** Wrap a route handler: JSON errors, auth errors. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const r = await fn(...args);
      if (r instanceof Response) return r;
      return NextResponse.json(r ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  };
}

export async function seedUser(userId: string) {
  const p = await db();
  for (const nt of BUILTIN_NOTETYPES) {
    await p.query(
      'insert into notetypes(user_id, name, is_cloze, fields, templates, css) values ($1,$2,$3,$4,$5,$6)',
      [userId, nt.name, nt.isCloze, JSON.stringify(nt.fields), JSON.stringify(nt.templates), nt.css],
    );
  }
  await p.query('insert into decks(user_id, name) values ($1, $2) on conflict do nothing', [userId, 'Default']);
}

export const newId = () => randomUUID();

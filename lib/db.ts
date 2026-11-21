import { Pool, PoolClient } from 'pg';

const globalForPool = globalThis as unknown as { _pool?: Pool; _schema?: Promise<void> };

function connectionString() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function pool(): Pool {
  if (!globalForPool._pool) {
    const url = connectionString();
    const local = /localhost|127\.0\.0\.1/.test(url);
    globalForPool._pool = new Pool({
      connectionString: url,
      ssl: local ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForPool._pool;
}

const SCHEMA = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  new_per_day int not null default 20,
  reviews_per_day int not null default 200,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create table if not exists notetypes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  is_cloze boolean not null default false,
  fields jsonb not null,
  templates jsonb not null,
  css text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists notes (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  notetype_id uuid not null references notetypes(id) on delete cascade,
  fields jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user on notes(user_id);
create table if not exists cards (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  ord int not null,
  state smallint not null default 0,
  due timestamptz not null default now(),
  fsrs jsonb,
  last_review timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (note_id, ord)
);
create index if not exists cards_deck_due on cards(deck_id, state, due);
create index if not exists cards_user on cards(user_id);
create table if not exists revlog (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  deck_id uuid not null,
  rating smallint not null,
  prev_state smallint not null,
  reviewed_at timestamptz not null,
  client_id text unique
);
create index if not exists revlog_user_time on revlog(user_id, reviewed_at);
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  content_type text not null,
  url text,
  data bytea,
  created_at timestamptz not null default now()
);
`;

export async function db(): Promise<Pool> {
  const p = pool();
  if (!globalForPool._schema) {
    globalForPool._schema = p.query(SCHEMA).then(() => undefined).catch((e) => {
      globalForPool._schema = undefined;
      throw e;
    });
  }
  await globalForPool._schema;
  return p;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const p = await db();
  const c = await p.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

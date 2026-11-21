'use client';
import { fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.json !== undefined ? { 'content-type': 'application/json', ...(init?.headers || {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = '/login';
    throw new Error('Not signed in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/** Anki-style day: starts at 4am local time. */
export function dayStart(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setHours(4, 0, 0, 0);
  return d.toISOString();
}

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));
export { Rating, State };

export function toCard(raw: any, due: string): Card {
  if (!raw) {
    return {
      due: new Date(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
      last_review: undefined,
    } as Card;
  }
  return {
    ...raw,
    due: new Date(raw.due ?? due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  } as Card;
}

export function fmtInterval(from: Date, to: Date): string {
  const s = Math.max(0, (to.getTime() - from.getTime()) / 1000);
  if (s < 60) return '<1m';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  const d = s / 86400;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

// ---- offline review outbox ----
export type PendingReview = {
  clientId: string;
  cardId: string;
  card: Record<string, unknown>;
  rating: Grade;
  prevState: number;
  reviewedAt: string;
};
const KEY = 'kioku.outbox';
export function outbox(): PendingReview[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function saveOutbox(v: PendingReview[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}
export function enqueue(r: PendingReview) {
  saveOutbox([...outbox(), r]);
}
let flushing: Promise<number> | null = null;
export function flush(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    const pending = outbox();
    if (!pending.length) return 0;
    try {
      const { done } = await api<{ done: string[] }>('/api/review', { method: 'POST', json: { reviews: pending.slice(0, 500) } });
      const set = new Set(done);
      saveOutbox(outbox().filter((r) => !set.has(r.clientId)));
      return outbox().length;
    } catch {
      return outbox().length;
    }
  })().finally(() => (flushing = null));
  return flushing;
}

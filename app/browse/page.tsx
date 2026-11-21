'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TopBar from '@/components/TopBar';
import { api } from '@/lib/client';

type Row = { id: string; first: string; second: string; notetype: string; deck: string; cards: number; suspended: boolean };

function Inner() {
  const deck = useSearchParams().get('deck') || '';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load(offset = 0, query = q) {
    setLoading(true);
    const params = new URLSearchParams({ q: query, offset: String(offset) });
    if (deck) params.set('deck', deck);
    const { notes } = await api<{ notes: Row[] }>(`/api/notes?${params}`);
    setRows((r) => (offset ? [...r, ...notes] : notes));
    setMore(notes.length === 100);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => load(0, q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, deck]);

  return (
    <>
      <input type="search" placeholder="Search text or tags" value={q} onChange={(e) => setQ(e.target.value)} />
      {deck && (
        <p className="muted">
          Showing one deck. <Link href="/browse" style={{ color: 'var(--accent)' }}>Show all</Link>
        </p>
      )}
      <div className="panel" style={{ marginTop: 14 }}>
        {rows.map((r) => (
          <Link key={r.id} href={`/edit/${r.id}`} className="list-item">
            <div className="t">
              <div style={{ opacity: r.suspended ? 0.5 : 1 }}>{r.first || <span className="muted">(empty)</span>}</div>
              <div className="muted" style={{ fontSize: 15 }}>{r.second}</div>
            </div>
            <span className="tag">{r.deck?.split('::').pop()}</span>
          </Link>
        ))}
        {!rows.length && !loading && <div className="list-item muted">No notes found.</div>}
      </div>
      {more && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => load(rows.length)}>
          Load more
        </button>
      )}
    </>
  );
}

export default function Browse() {
  return (
    <>
      <TopBar />
      <main>
        <Suspense>
          <Inner />
        </Suspense>
      </main>
    </>
  );
}

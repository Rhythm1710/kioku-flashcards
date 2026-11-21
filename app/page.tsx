'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar from '@/components/TopBar';
import { api, dayStart, flush, outbox } from '@/lib/client';

type Deck = { id: string; name: string; newPerDay: number; reviewsPerDay: number; newAvail: number; learn: number; review: number; total: number };
type Node = Deck & { depth: number; leaf: string; children: Node[]; sum: { n: number; l: number; r: number } };

function buildTree(decks: Deck[]): Node[] {
  const byName = new Map<string, Node>();
  const roots: Node[] = [];
  for (const d of [...decks].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = d.name.split('::');
    const node: Node = { ...d, depth: parts.length - 1, leaf: parts[parts.length - 1], children: [], sum: { n: 0, l: 0, r: 0 } };
    byName.set(d.name, node);
    const parent = byName.get(parts.slice(0, -1).join('::'));
    (parent ? parent.children : roots).push(node);
  }
  const total = (n: Node): Node['sum'] => {
    const s = { n: n.newAvail, l: n.learn, r: n.review };
    for (const c of n.children) {
      const cs = total(c);
      s.n += cs.n;
      s.l += cs.l;
      s.r += cs.r;
    }
    s.n = Math.min(s.n, n.newPerDay);
    s.r = Math.min(s.r, n.reviewsPerDay);
    n.sum = s;
    return s;
  };
  roots.forEach(total);
  return roots;
}

function Count({ v, cls }: { v: number; cls: string }) {
  return <b className={v ? cls : 'zero'}>{v}</b>;
}

export default function Home() {
  const [data, setData] = useState<{ decks: Deck[]; reviewedToday: number; email: string } | null>(null);
  const [err, setErr] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<Deck | null>(null);
  const [pending, setPending] = useState(0);

  const load = useCallback(async () => {
    try {
      await flush();
      setPending(outbox().length);
      setData(await api(`/api/decks?dayStart=${encodeURIComponent(dayStart())}`));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    try {
      setCollapsed(JSON.parse(localStorage.getItem('kioku.collapsed') || '{}'));
    } catch {}
    load();
    const v = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, [load]);

  const tree = useMemo(() => buildTree(data?.decks || []), [data]);
  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem('kioku.collapsed', JSON.stringify(next));
    } catch {}
  };

  async function createDeck() {
    const name = prompt('Deck name (use :: for subdecks, e.g. Japanese::Kanji)');
    if (!name) return;
    try {
      await api('/api/decks', { method: 'POST', json: { name } });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const render = (nodes: Node[]): React.ReactNode[] =>
    nodes.flatMap((n) => [
        <li key={n.id} className="deck" style={{ paddingLeft: 16 + n.depth * 22 }}>
          <div className="name">
            {n.children.length ? (
              <button className="twisty" onClick={() => toggle(n.id)} aria-label="Toggle subdecks">
                {collapsed[n.id] ? '▸' : '▾'}
              </button>
            ) : (
              <span style={{ width: 26 }} />
            )}
            <Link href={`/study/${n.id}`} style={{ flex: 1, minWidth: 0 }}>
              <span>{n.leaf}</span>
            </Link>
          </div>
          <Link href={`/study/${n.id}`} className="counts">
            <Count v={n.sum.n} cls="c-new" />
            <Count v={n.sum.l} cls="c-learn" />
            <Count v={n.sum.r} cls="c-due" />
          </Link>
          <button className="menu-btn" onClick={() => setMenu(n)} aria-label="Deck options">
            ⋯
          </button>
        </li>,
        ...(collapsed[n.id] ? [] : render(n.children)),
    ]);

  return (
    <>
      <TopBar />
      <main>
        {pending > 0 && <div className="banner">{pending} review{pending > 1 ? 's' : ''} waiting to sync. They'll upload when you're back online.</div>}
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="grow muted">
            {data ? `${data.reviewedToday} reviewed today` : 'Loading…'}
          </div>
          <div className="counts muted" style={{ fontSize: 13, marginRight: 46 }}>
            <span className="c-new">New</span>
            <span className="c-learn">Learn</span>
            <span className="c-due">Due</span>
          </div>
        </div>
        <ul className="decks panel">{data && render(tree)}</ul>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={createDeck}>
            New deck
          </button>
          <Link className="btn" href="/import">
            Import .apkg
          </Link>
          <div className="grow" />
          {data && (
            <button
              className="btn small"
              onClick={async () => {
                await api('/api/auth/logout', { method: 'POST' });
                location.href = '/login';
              }}
            >
              Sign out {data.email}
            </button>
          )}
        </div>
      </main>
      {menu && <DeckSheet deck={menu} onClose={() => setMenu(null)} onChanged={load} />}
    </>
  );
}

function DeckSheet({ deck, onClose, onChanged }: { deck: Deck; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(deck.name);
  const [newPerDay, setNew] = useState(deck.newPerDay);
  const [reviewsPerDay, setRev] = useState(deck.reviewsPerDay);
  const [err, setErr] = useState('');

  async function save() {
    try {
      await api(`/api/decks/${deck.id}`, { method: 'PATCH', json: { name, newPerDay, reviewsPerDay } });
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function del() {
    if (!confirm(`Delete "${deck.name}", its subdecks and all their cards? This can't be undone.`)) return;
    await api(`/api/decks/${deck.id}`, { method: 'DELETE' });
    onChanged();
    onClose();
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Deck options</h3>
        <div className="muted">{deck.total} cards</div>
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <div className="grow">
            <label>New cards / day</label>
            <input type="number" min={0} value={newPerDay} onChange={(e) => setNew(+e.target.value)} />
          </div>
          <div className="grow">
            <label>Max reviews / day</label>
            <input type="number" min={0} value={reviewsPerDay} onChange={(e) => setRev(+e.target.value)} />
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn danger" onClick={del}>
            Delete
          </button>
          <div className="grow" />
          <Link className="btn" href={`/browse?deck=${deck.id}`}>
            Browse
          </Link>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Grade } from 'ts-fsrs';
import CardView from '@/components/CardView';
import { api, dayStart, enqueue, flush, fmtInterval, outbox, Rating, scheduler, State, toCard } from '@/lib/client';
import { renderCard, type NotetypeDef } from '@/lib/render';

type Row = { id: string; note_id: string; deck_id: string; ord: number; state: number; due: string; fsrs: any };
type Item = { row: Row; card: Card };
type Study = {
  deck: { name: string };
  decks: Record<string, string>;
  cards: Row[];
  notes: { id: string; fields: string[]; tags: string[]; notetype_id: string }[];
  notetypes: (NotetypeDef & { id: string })[];
};

const LEARN_AHEAD_MS = 20 * 60 * 1000;

export default function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Study | null>(null);
  const [err, setErr] = useState('');
  const [main, setMain] = useState<Item[]>([]);
  const [learning, setLearning] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Item | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tick, setTick] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const dayEnd = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        await flush();
        const ds = dayStart();
        dayEnd.current = Date.parse(ds) + 86400000;
        const d = await api<Study>(`/api/study?deck=${id}&dayStart=${encodeURIComponent(ds)}`);
        // Apply any reviews still sitting in the offline outbox so they are not shown again.
        const pending = new Map(outbox().map((r) => [r.cardId, r]));
        const items: Item[] = [];
        const seen = new Set<string>();
        for (const row of d.cards) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          const p = pending.get(row.id);
          const raw = p ? p.card : row.fsrs;
          const state = p ? (p.card.state as number) : row.state;
          items.push({ row: { ...row, state }, card: toCard(raw, row.due) });
        }
        const learn = items.filter((i) => i.card.state === State.Learning || i.card.state === State.Relearning);
        const reviews = items.filter((i) => i.card.state === State.Review && +i.card.due <= dayEnd.current);
        const news = items.filter((i) => i.card.state === State.New);
        // Spread new cards evenly through reviews.
        const mixed: Item[] = [];
        const step = news.length ? Math.max(1, Math.floor(reviews.length / news.length)) : 0;
        let ni = 0;
        reviews.forEach((r, i) => {
          mixed.push(r);
          if (step && (i + 1) % step === 0 && ni < news.length) mixed.push(news[ni++]);
        });
        while (ni < news.length) mixed.push(news[ni++]);
        setMain(mixed);
        setLearning(learn.sort((a, b) => +a.card.due - +b.card.due));
        setData(d);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [id]);

  // pick the next card whenever queues change
  useEffect(() => {
    if (!data || current) return;
    const now = Date.now();
    const dueLearn = learning.find((l) => +l.card.due <= now);
    if (dueLearn) return void (setLearning((ls) => ls.filter((x) => x !== dueLearn)), setCurrent(dueLearn), setRevealed(false));
    if (main.length) {
      const [next, ...rest] = main;
      setMain(rest);
      setCurrent(next);
      setRevealed(false);
      return;
    }
    const soon = learning.find((l) => +l.card.due <= now + LEARN_AHEAD_MS);
    if (soon) {
      setLearning((ls) => ls.filter((x) => x !== soon));
      setCurrent(soon);
      setRevealed(false);
    }
  }, [data, main, learning, current, tick]);

  // re-check learning queue every 15s while waiting
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const noteMap = useMemo(() => new Map(data?.notes.map((n) => [n.id, n]) || []), [data]);
  const ntMap = useMemo(() => new Map(data?.notetypes.map((n) => [n.id, n]) || []), [data]);

  const rendered = useMemo(() => {
    if (!current || !data) return null;
    const note = noteMap.get(current.row.note_id);
    const nt = note && ntMap.get(note.notetype_id);
    if (!note || !nt) return null;
    const deckName = data.decks[current.row.deck_id] || '';
    const r = renderCard(nt, note.fields, current.row.ord, {
      Tags: note.tags.join(' '),
      Deck: deckName,
      Subdeck: deckName.split('::').pop() || '',
      Type: nt.name,
      Card: nt.isCloze ? 'Cloze' : nt.templates[current.row.ord]?.name || '',
    });
    return { ...r, css: nt.css };
  }, [current, data, noteMap, ntMap]);

  const preview = useMemo(() => {
    if (!current || !revealed) return null;
    const now = new Date();
    const p = scheduler.repeat(current.card, now);
    return ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) => ({
      g,
      label: fmtInterval(now, p[g].card.due),
    }));
  }, [current, revealed]);

  const answer = useCallback(
    (g: Grade) => {
      if (!current) return;
      const now = new Date();
      const rec = scheduler.next(current.card, now, g);
      const serial = { ...rec.card, due: rec.card.due.toISOString(), last_review: rec.card.last_review?.toISOString() };
      enqueue({
        clientId: crypto.randomUUID(),
        cardId: current.row.id,
        card: serial,
        rating: g,
        prevState: current.card.state,
        reviewedAt: now.toISOString(),
      });
      flush();
      const next: Item = { row: { ...current.row, state: rec.card.state }, card: rec.card };
      if ((rec.card.state === State.Learning || rec.card.state === State.Relearning) && +rec.card.due < dayEnd.current) {
        setLearning((ls) => [...ls, next].sort((a, b) => +a.card.due - +b.card.due));
      }
      setDoneCount((c) => c + 1);
      setCurrent(null);
      setRevealed(false);
      window.scrollTo({ top: 0 });
    },
    [current],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && e.key !== 'Enter') return;
      if (!current) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key) as Grade);
      else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        answer(Rating.Good);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, answer]);

  const counts = {
    n: main.filter((i) => i.card.state === State.New).length + (current?.card.state === State.New ? 1 : 0),
    l: learning.length + (current && (current.card.state === State.Learning || current.card.state === State.Relearning) ? 1 : 0),
    r: main.filter((i) => i.card.state === State.Review).length + (current?.card.state === State.Review ? 1 : 0),
  };
  const nextLearn = learning[0];

  return (
    <div className="study">
      <header className="top">
        <Link href="/" className="btn small">
          ‹ Decks
        </Link>
        <h1 style={{ textAlign: 'center' }}>{data?.deck.name.split('::').pop() || ''}</h1>
        {current ? (
          <Link href={`/edit/${current.row.note_id}?back=/study/${id}`} className="btn small">
            Edit
          </Link>
        ) : (
          <span style={{ width: 60 }} />
        )}
      </header>
      {err && <main className="err">{err}</main>}
      {data && (
        <div className="study-head">
          <div className="counts" style={{ justifyContent: 'flex-start' }}>
            <b className={counts.n ? 'c-new' : 'zero'}>{counts.n}</b>
            <b className={counts.l ? 'c-learn' : 'zero'}>{counts.l}</b>
            <b className={counts.r ? 'c-due' : 'zero'}>{counts.r}</b>
          </div>
          <span className="muted">{doneCount} done</span>
        </div>
      )}
      {data && current && rendered && (
        <>
          <div className="card-wrap" onClick={() => !revealed && setRevealed(true)}>
            <CardView html={revealed ? rendered.a : rendered.q} css={rendered.css} />
          </div>
          <div className="answer-bar">
            <div className="inner">
              {!revealed ? (
                <button className="btn primary show" style={{ minHeight: 56 }} onClick={() => setRevealed(true)}>
                  Show answer
                </button>
              ) : (
                preview?.map(({ g, label }) => (
                  <button key={g} className={`grade g${g}`} onClick={() => answer(g)}>
                    <small>{label}</small>
                    <strong>{['', 'Again', 'Hard', 'Good', 'Easy'][g]}</strong>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {data && !current && (
        <div className="done">
          <h2>{doneCount ? 'Nice work.' : 'Nothing due.'}</h2>
          <p className="muted">
            {nextLearn
              ? `${learning.length} learning card${learning.length > 1 ? 's' : ''} due again in ${fmtInterval(new Date(), nextLearn.card.due)}. Stay here and they'll appear.`
              : doneCount
                ? `You finished ${doneCount} card${doneCount > 1 ? 's' : ''} in this deck for today.`
                : 'No cards are due in this deck right now.'}
          </p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
            <Link href="/" className="btn">
              Back to decks
            </Link>
            <Link href={`/add?deck=${id}`} className="btn primary">
              Add cards
            </Link>
          </div>
        </div>
      )}
      {!data && !err && <main className="muted">Loading…</main>}
    </div>
  );
}

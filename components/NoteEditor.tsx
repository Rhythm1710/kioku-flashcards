'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import CardView from './CardView';
import { api, dayStart } from '@/lib/client';
import { cardOrds, clozeNumbers, renderCard } from '@/lib/render';

type NT = { id: string; name: string; isCloze: boolean; fields: string[]; templates: { name: string; qfmt: string; afmt: string }[]; css: string };
type Deck = { id: string; name: string };

export default function NoteEditor({
  noteId,
  initialDeck,
  onSaved,
}: {
  noteId?: string;
  initialDeck?: string;
  onSaved?: () => void;
}) {
  const [nts, setNts] = useState<NT[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [ntId, setNtId] = useState('');
  const [deckId, setDeckId] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [suspended, setSuspended] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const [{ notetypes }, { decks }] = await Promise.all([
        api<{ notetypes: NT[] }>('/api/notetypes'),
        api<{ decks: Deck[] }>(`/api/decks?dayStart=${encodeURIComponent(dayStart())}`),
      ]);
      setNts(notetypes);
      setDecks(decks);
      if (noteId) {
        const { note, cards } = await api(`/api/notes/${noteId}`);
        setNtId(note.notetype_id);
        setFields(note.fields);
        setTags((note.tags || []).join(' '));
        setDeckId(cards[0]?.deck_id || decks[0]?.id);
        setSuspended(cards.length > 0 && cards.every((c: { suspended: boolean }) => c.suspended));
      } else {
        const lastNt = localStorage.getItem('kioku.lastNt');
        const lastDeck = localStorage.getItem('kioku.lastDeck');
        const nt = notetypes.find((n) => n.id === lastNt) || notetypes[0];
        setNtId(nt?.id || '');
        setFields(nt ? nt.fields.map(() => '') : []);
        setDeckId(
          (initialDeck && decks.find((d) => d.id === initialDeck)?.id) ||
            decks.find((d) => d.id === lastDeck)?.id ||
            decks.find((d) => d.name === 'Default')?.id ||
            decks[0]?.id ||
            '',
        );
      }
    })().catch((e) => setMsg({ err: e.message }));
  }, [noteId, initialDeck]);

  const nt = nts.find((n) => n.id === ntId);

  function changeNt(id: string) {
    const next = nts.find((n) => n.id === id);
    if (!next) return;
    // keep text in fields with the same position
    setFields(next.fields.map((_, i) => fields[i] || ''));
    setNtId(id);
  }

  const preview = useMemo(() => {
    if (!nt) return null;
    const ord = cardOrds(nt, fields)[0] ?? 0;
    return renderCard(nt, fields, ord);
  }, [nt, fields]);

  function insertAtCursor(text: string, wrap?: [string, string]) {
    const el = refs.current[focusIdx];
    const i = focusIdx;
    const v = fields[i] ?? '';
    const s = el?.selectionStart ?? v.length;
    const e = el?.selectionEnd ?? v.length;
    const nv = wrap ? v.slice(0, s) + wrap[0] + v.slice(s, e) + wrap[1] + v.slice(e) : v.slice(0, s) + text + v.slice(e);
    const copy = [...fields];
    copy[i] = nv;
    setFields(copy);
    requestAnimationFrame(() => el?.focus());
  }

  function cloze() {
    const n = (clozeNumbers(fields).pop() || 0) + 1;
    insertAtCursor('', [`{{c${n}::`, '}}']);
  }

  async function addImage(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', file.name || 'image.jpg');
    try {
      const { url } = await api<{ url: string }>('/api/media', { method: 'POST', body: fd });
      insertAtCursor(`<img src="${url}">`);
    } catch (e) {
      setMsg({ err: (e as Error).message });
    }
  }

  async function save() {
    setMsg({});
    try {
      const tagList = tags.split(/\s+/).filter(Boolean);
      if (noteId) {
        await api(`/api/notes/${noteId}`, { method: 'PATCH', json: { fields, tags: tagList, deckId } });
        setMsg({ ok: 'Saved' });
        onSaved?.();
      } else {
        const r = await api<{ cards: number }>('/api/notes', { method: 'POST', json: { notetypeId: ntId, deckId, fields, tags: tagList } });
        localStorage.setItem('kioku.lastNt', ntId);
        localStorage.setItem('kioku.lastDeck', deckId);
        setFields(fields.map(() => ''));
        setMsg({ ok: `Added ${r.cards} card${r.cards > 1 ? 's' : ''}` });
        refs.current[0]?.focus();
      }
    } catch (e) {
      setMsg({ err: (e as Error).message });
    }
  }

  async function act(body: Record<string, unknown>, label: string) {
    await api(`/api/notes/${noteId}`, { method: 'PATCH', json: body });
    setMsg({ ok: label });
  }

  if (!nt) return <div className="muted">{msg.err || 'Loading…'}</div>;

  return (
    <div
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
      }}
    >
      <div className="row">
        <div className="grow">
          <label>Type</label>
          <select value={ntId} onChange={(e) => changeNt(e.target.value)} disabled={!!noteId}>
            {nts.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label>Deck</label>
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {nt.fields.map((f, i) => (
        <div key={f + i}>
          <label>{f}</label>
          <textarea
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={fields[i] ?? ''}
            onFocus={() => setFocusIdx(i)}
            onChange={(e) => {
              const copy = [...fields];
              copy[i] = e.target.value;
              setFields(copy);
            }}
            autoFocus={i === 0 && !noteId}
          />
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        {nt.isCloze && (
          <button className="btn small" onClick={cloze} type="button">
            Cloze [...]
          </button>
        )}
        <button className="btn small" type="button" onClick={() => insertAtCursor('', ['<b>', '</b>'])}>
          <b>B</b>
        </button>
        <button className="btn small" type="button" onClick={() => insertAtCursor('', ['<i>', '</i>'])}>
          <i>I</i>
        </button>
        <label className="btn small" style={{ margin: 0, color: 'inherit', fontSize: 15 }}>
          Image
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addImage(e.target.files[0])} />
        </label>
      </div>
      <label>Tags (space separated)</label>
      <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="off" />

      {msg.err && <div className="err">{msg.err}</div>}
      {msg.ok && <div className="ok">{msg.ok}</div>}

      <div className="row" style={{ marginTop: 18 }}>
        {noteId && (
          <>
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('Delete this note and its cards?')) return;
                await api(`/api/notes/${noteId}`, { method: 'DELETE' });
                onSaved?.();
              }}
            >
              Delete
            </button>
            <button
              className="btn"
              onClick={() => {
                act({ suspended: !suspended }, suspended ? 'Unsuspended' : 'Suspended');
                setSuspended(!suspended);
              }}
            >
              {suspended ? 'Unsuspend' : 'Suspend'}
            </button>
            <button className="btn" onClick={() => confirm('Forget all progress on this note?') && act({ reset: true }, 'Reset to new')}>
              Reset
            </button>
          </>
        )}
        <div className="grow" />
        <button className="btn primary" onClick={save}>
          {noteId ? 'Save' : 'Add'}
        </button>
      </div>

      {preview && (
        <>
          <div className="row" style={{ marginTop: 26 }}>
            <strong className="grow">Preview</strong>
            <button className="btn small" onClick={() => setShowBack(!showBack)}>
              {showBack ? 'Show front' : 'Show back'}
            </button>
          </div>
          <div className="preview">
            <CardView html={showBack ? preview.a : preview.q} css={nt.css} />
          </div>
        </>
      )}
    </div>
  );
}

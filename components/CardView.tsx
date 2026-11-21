'use client';
import { useEffect, useRef } from 'react';

const BASE = `
:host { display:block; color: var(--ink); }
.card { padding: 28px 22px; min-height: 40vh; overflow-wrap: anywhere; }
.card img { max-width: 100%; height: auto; }
.card hr#answer { border: 0; border-top: 1px solid var(--line); margin: 22px 0; }
.card .cloze { font-weight: 700; color: var(--new); }
.card audio { max-width: 100%; margin: 6px 0; }
.card input.typeans { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); width: min(100%, 420px); }
.card .typeans-answer { font-family: ui-monospace, monospace; }
.card details.hint summary { cursor: pointer; color: var(--muted); }
.card ruby rt { font-size: 0.55em; }
`;

/** Renders card HTML inside a shadow root so the deck's CSS can't leak into the app. */
export default function CardView({ html, css }: { html: string; css: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    // Anki styles often target .card on <body>; also neutralise forced colours so dark mode stays readable.
    const deckCss = css.replace(/\bbody\b/g, '.card').replace(/\.nightMode\b/g, ':host-context(.never)');
    root.innerHTML = `<style>${BASE}${deckCss}
      @media (prefers-color-scheme: dark) { .card { background: transparent !important; color: var(--ink) !important; } }
      .card { background: transparent; }</style><div class="card">${html}</div>`;
    const input = root.querySelector<HTMLInputElement>('input.typeans');
    input?.focus();
    root.querySelectorAll('audio').forEach((a, i) => {
      if (i === 0) a.play().catch(() => {});
    });
  }, [html, css]);
  return <div ref={host} className="card-host panel" />;
}

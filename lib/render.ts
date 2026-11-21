// Anki-compatible card template rendering, shared by client and server.

export type Template = { name: string; qfmt: string; afmt: string };
export type NotetypeDef = {
  name: string;
  isCloze: boolean;
  fields: string[];
  templates: Template[];
  css: string;
};

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; v: string }
  | { t: 'sec'; name: string; neg: boolean; kids: Node[] };

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; kids: Node[] }[] = [{ name: '', kids: root }];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.kids.push({ t: 'text', v: src.slice(last, m.index) });
    last = re.lastIndex;
    const tag = m[1].trim();
    if (tag.startsWith('#') || tag.startsWith('^')) {
      const node: Node = { t: 'sec', name: tag.slice(1).trim(), neg: tag[0] === '^', kids: [] };
      top.kids.push(node);
      stack.push({ name: node.name, kids: node.kids });
    } else if (tag.startsWith('/')) {
      if (stack.length > 1) stack.pop();
    } else if (tag.startsWith('!')) {
      // comment
    } else {
      top.kids.push({ t: 'var', v: tag });
    }
  }
  if (last < src.length) stack[stack.length - 1].kids.push({ t: 'text', v: src.slice(last) });
  return root;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function nonEmpty(v: string | undefined) {
  return !!v && stripHtml(v).length > 0;
}

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeNumbers(fields: string[]): number[] {
  const set = new Set<number>();
  for (const f of fields) {
    for (const m of f.matchAll(CLOZE_RE)) set.add(parseInt(m[1], 10));
  }
  return [...set].sort((a, b) => a - b);
}

function renderCloze(text: string, n: number, side: 'q' | 'a'): string {
  return text.replace(CLOZE_RE, (_all, num, answer, hint) => {
    if (parseInt(num, 10) !== n) return answer;
    if (side === 'q') return `<span class="cloze">[${hint ? hint : '...'}]</span>`;
    return `<span class="cloze">${answer}</span>`;
  });
}

function furigana(s: string, mode: 'furigana' | 'kana' | 'kanji'): string {
  return s.replace(/ ?([^ >]+?)\[(.+?)\]/g, (_a, base, reading) => {
    if (mode === 'kana') return reading;
    if (mode === 'kanji') return base;
    return `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`;
  });
}

type Ctx = {
  fields: Record<string, string>;
  side: 'q' | 'a';
  clozeN: number;
  frontSide: string;
};

function applyVar(tag: string, ctx: Ctx): string {
  if (tag === 'FrontSide') return ctx.frontSide;
  const parts = tag.split(':');
  const name = parts.pop()!.trim();
  const filters = parts.map((p) => p.trim());
  if (name === 'Tags' || name === 'Deck' || name === 'Subdeck' || name === 'Card' || name === 'Type') {
    return ctx.fields[name] ?? '';
  }
  if (filters.some((f) => f.startsWith('tts'))) return '';
  let v = ctx.fields[name] ?? '';
  for (const f of filters.reverse()) {
    if (f === 'text') v = stripHtml(v);
    else if (f === 'cloze') v = renderCloze(v, ctx.clozeN, ctx.side);
    else if (f === 'furigana' || f === 'kana' || f === 'kanji') v = furigana(v, f);
    else if (f === 'hint')
      v = v ? `<details class="hint"><summary>Show hint</summary>${v}</details>` : '';
    else if (f === 'type' || f.startsWith('type')) {
      v = ctx.side === 'q' ? '<input class="typeans" autocapitalize="off" autocomplete="off" placeholder="Type answer">' : `<div class="typeans-answer">${stripHtml(v)}</div>`;
    }
  }
  return v;
}

function renderNodes(nodes: Node[], ctx: Ctx): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') out += applyVar(n.v, ctx);
    else {
      let present: boolean;
      const fname = n.name.split(':').pop()!.trim();
      if (n.name.startsWith('cloze:')) {
        present = clozeNumbers([ctx.fields[fname] ?? '']).includes(ctx.clozeN);
      } else present = nonEmpty(ctx.fields[fname]);
      if (present !== n.neg) out += renderNodes(n.kids, ctx);
    }
  }
  return out;
}

function mediaTags(html: string): string {
  return html.replace(/\[sound:([^\]]+)\]/g, (_a, src) => `<audio controls preload="none" src="${src}"></audio>`);
}

export function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function renderCard(
  nt: Pick<NotetypeDef, 'isCloze' | 'fields' | 'templates'>,
  fieldValues: string[],
  ord: number,
  extra: Record<string, string> = {},
): { q: string; a: string } {
  const tmpl = nt.isCloze ? nt.templates[0] : nt.templates[ord] ?? nt.templates[0];
  const fields: Record<string, string> = { ...extra };
  nt.fields.forEach((f, i) => (fields[f] = fieldValues[i] ?? ''));
  const clozeN = ord + 1;
  const q = renderNodes(parse(tmpl.qfmt), { fields, side: 'q', clozeN, frontSide: '' });
  const qForBack = q.replace(/<input class="typeans"[^>]*>/g, '');
  const a = renderNodes(parse(tmpl.afmt), { fields, side: 'a', clozeN, frontSide: qForBack });
  return { q: sanitize(mediaTags(q)), a: sanitize(mediaTags(a)) };
}

/** Which card ords a note should have (Anki rule: front side not empty). */
export function cardOrds(nt: Pick<NotetypeDef, 'isCloze' | 'fields' | 'templates'>, fieldValues: string[]): number[] {
  if (nt.isCloze) return clozeNumbers(fieldValues).map((n) => n - 1);
  const ords: number[] = [];
  nt.templates.forEach((t, i) => {
    const fields: Record<string, string> = {};
    nt.fields.forEach((f, j) => (fields[f] = fieldValues[j] ?? ''));
    const referenced = [...t.qfmt.matchAll(/\{\{([^#^/!][^}]*)\}\}/g)]
      .map((m) => m[1].split(':').pop()!.trim())
      .filter((n) => n in fields);
    const q = renderNodes(parse(t.qfmt), { fields, side: 'q', clozeN: 1, frontSide: '' });
    const empty = renderNodes(parse(t.qfmt), {
      fields: Object.fromEntries(Object.keys(fields).map((k) => [k, ''])),
      side: 'q',
      clozeN: 1,
      frontSide: '',
    });
    if (referenced.some((r) => nonEmpty(fields[r])) && stripHtml(q) !== stripHtml(empty)) ords.push(i);
  });
  return ords.length ? ords : [0];
}

const BASE_CSS = `.card { font-family: -apple-system, system-ui, sans-serif; font-size: 22px; text-align: center; }`;

export const BUILTIN_NOTETYPES: NotetypeDef[] = [
  {
    name: 'Basic',
    isCloze: false,
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }],
    css: BASE_CSS,
  },
  {
    name: 'Basic (and reversed card)',
    isCloze: false,
    fields: ['Front', 'Back'],
    templates: [
      { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' },
      { name: 'Card 2', qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' },
    ],
    css: BASE_CSS,
  },
  {
    name: 'Cloze',
    isCloze: true,
    fields: ['Text', 'Back Extra'],
    templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Back Extra}}' }],
    css: BASE_CSS + ` .cloze { font-weight: bold; color: #2563eb; }`,
  },
  {
    name: 'Basic (type in the answer)',
    isCloze: false,
    fields: ['Front', 'Back'],
    templates: [{ name: 'Card 1', qfmt: '{{Front}}<br><br>{{type:Back}}', afmt: '{{Front}}<hr id=answer>{{type:Back}}' }],
    css: BASE_CSS,
  },
];

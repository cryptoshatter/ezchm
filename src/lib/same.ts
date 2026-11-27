import { SQL_KEYWORDS } from "./sqlfmt";

const WORDCH = /[\w@#$À-￿]/;
const IDENT = /^[@#]{0,2}[A-Za-z_À-￿][\w$#À-￿]*$/;
const SKIP = ".ez-bar,.ez-ft,.ez-fb,select,option,style,.ez-rail";

export type SameHit = { el: HTMLElement; write: boolean };

export function isIdent(w: string) {
  return w.length >= 2 && w.length <= 80 && IDENT.test(w) && !SQL_KEYWORDS.has(w.toLowerCase());
}

type CaretFn = (x: number, y: number, o?: { shadowRoots?: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null;

export function hitText(x: number, y: number, el: Element): { node: Node; off: number } | null {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let n = 0;
  while (w.nextNode()) {
    const t = w.currentNode as Text;
    const len = t.length;
    for (let i = 0; i < len && n < 4000; i++, n++) {
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      const b = r.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return { node: t, off: i };
    }
  }
  return null;
}

export function wordAtPoint(x: number, y: number, shadow?: ShadowRoot | null, target?: Element | null): string | null {
  let node: Node | null = null;
  let off = 0;
  if (target && target.textContent && target.textContent.length < 4000) {
    const h = hitText(x, y, target);
    if (h) {
      node = h.node;
      off = h.off;
    }
  }
  const d = document as Document & { caretPositionFromPoint?: CaretFn };
  if (!node && d.caretPositionFromPoint) {
    const p = shadow ? d.caretPositionFromPoint(x, y, { shadowRoots: [shadow] }) : d.caretPositionFromPoint(x, y);
    if (p) {
      node = p.offsetNode;
      off = p.offset;
    }
  }
  if ((!node || node.nodeType !== 3) && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) {
      node = r.startContainer;
      off = r.startOffset;
    }
  }
  if (!node || node.nodeType !== 3) return null;
  const s = node.nodeValue ?? "";
  let a = off;
  let b = off;
  while (a > 0 && WORDCH.test(s[a - 1])) a--;
  while (b < s.length && WORDCH.test(s[b])) b++;
  if (a === b) return null;
  return s.slice(a, b);
}

export function selectionText(shadow?: ShadowRoot | null): string {
  const sr = shadow as (ShadowRoot & { getSelection?: () => Selection | null }) | null | undefined;
  const sel = sr?.getSelection?.() ?? document.getSelection();
  return sel ? sel.toString() : "";
}

export function clearSame(root: HTMLElement | ShadowRoot) {
  root.querySelectorAll("mark.ez-same").forEach((m) => {
    const p = m.parentNode;
    m.replaceWith(document.createTextNode(m.textContent ?? ""));
    p?.normalize();
  });
}

const BEFORE_W = /(\bset|\binto|\bupdate|\bdeclare|\bfetch\s+next\s+from\s+\S+\s+into|,)\s*$/i;
const AFTER_W = /^\s*(=(?!=)|:=|\+=|-=|\*=|\/=)/;

function lineText(node: Node): { text: string; start: number } {
  const line = (node.parentElement?.closest(".line") as HTMLElement | null) ?? node.parentElement;
  if (!line) return { text: node.nodeValue ?? "", start: 0 };
  let start = 0;
  let text = "";
  const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    if (w.currentNode === node) start = text.length;
    text += w.currentNode.nodeValue ?? "";
  }
  return { text, start };
}

export function highlightSame(root: HTMLElement, word: string, caseInsensitive: boolean): SameHit[] {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w@#$\\u00c0-\\uffff])${esc}(?![\\w$#\\u00c0-\\uffff])`, caseInsensitive ? "gi" : "g");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const hits: SameHit[] = [];
  for (const node of nodes) {
    const s = node.nodeValue ?? "";
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    const lt = lineText(node);
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const pos = lt.start + m.index;
      const before = lt.text.slice(Math.max(0, pos - 60), pos);
      const after = lt.text.slice(pos + m[0].length, pos + m[0].length + 6);
      const write = AFTER_W.test(after) || (BEFORE_W.test(before) && !/,\s*$/.test(before)) || (/,\s*$/.test(before) && /\bdeclare\b[^;]*$/i.test(before));
      const mark = document.createElement("mark");
      mark.className = "ez-same" + (write ? " w" : "");
      mark.textContent = m[0];
      frag.appendChild(mark);
      hits.push({ el: mark, write });
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.replaceWith(frag);
  }
  return hits;
}

export function railPositions(hits: SameHit[], scroller: HTMLElement) {
  const h = scroller.scrollHeight || 1;
  const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return hits
    .filter((x) => x.el.isConnected && !x.el.closest(".ez-hidden"))
    .map((x) => ({ at: Math.min(1, Math.max(0, (x.el.getBoundingClientRect().top - top) / h)), write: x.write }));
}

export const SAME_CSS = `
@keyframes ezfade{from{background-color:transparent;box-shadow:none}}
mark.ez-same{color:inherit;background:color-mix(in srgb,var(--accent) 15%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 38%,transparent);border-radius:3px;padding:0 1px;margin:0 -1px;animation:ezfade .18s ease-out;transition:background-color .15s,box-shadow .15s}
mark.ez-same.w{background:color-mix(in srgb,var(--write) 17%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--write) 45%,transparent)}
mark.ez-same.cur{background:color-mix(in srgb,var(--accent) 28%,transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 70%,transparent)}
mark.ez-same.w.cur{background:color-mix(in srgb,var(--write) 30%,transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--write) 75%,transparent)}
mark.ez-hit{color:inherit;background:color-mix(in srgb,var(--hit-base) 24%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--hit-base) 45%,transparent);border-radius:3px;padding:0 1px;margin:0 -1px}
::highlight(ez-ask){background-color:color-mix(in srgb,var(--accent) 22%,transparent)}
mark.ez-hit.cur{background:color-mix(in srgb,var(--hit-base) 45%,transparent);box-shadow:inset 0 0 0 1.5px var(--hit-base)}
`;

import { chmUrl } from "../api";

const MONO = /courier|consolas|monaco|menlo|lucida console|fixedsys|monospace|andale mono|source code|jetbrains|fira code|新宋体|nsimsun/i;
const BLOCK_TAGS = new Set(["P", "DIV", "TD", "LI", "DD", "DT", "BLOCKQUOTE", "SPAN", "FONT"]);

export function resolvePath(base: string, href: string): string | null {
  let h = href.trim().replace(/\\/g, "/");
  if (!h || /^javascript:/i.test(h)) return null;
  const its = h.indexOf("::");
  if (its >= 0) h = h.slice(its + 2);
  else if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  try {
    const u = new URL(h, "http://x" + base);
    return decodeURIComponent(u.pathname) + u.hash;
  } catch {
    return null;
  }
}

export function isExternal(href: string) {
  return /^(https?|mailto|ftp):/i.test(href.trim());
}

function rewriteUrls(root: ParentNode, id: string, page: string) {
  const fix = (v: string | null) => {
    if (!v || /^(data|https?|blob):/i.test(v)) return v;
    const p = resolvePath(page, v);
    return p ? chmUrl(id, p.split("#")[0]) : v;
  };
  root.querySelectorAll<HTMLElement>("[src]").forEach((el) => {
    const v = fix(el.getAttribute("src"));
    if (v) el.setAttribute("src", v);
  });
  root.querySelectorAll<HTMLElement>("[background]").forEach((el) => {
    const v = fix(el.getAttribute("background"));
    if (v) el.style.backgroundImage = `url("${v}")`;
    el.removeAttribute("background");
  });
  root.querySelectorAll<HTMLLinkElement>("link[rel~=stylesheet][href]").forEach((el) => {
    const v = fix(el.getAttribute("href"));
    if (v) el.setAttribute("href", v);
  });
}

function stripLegacy(root: ParentNode) {
  root.querySelectorAll("font").forEach((f) => {
    f.removeAttribute("face");
    f.removeAttribute("size");
    f.removeAttribute("color");
  });
  root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    const s = el.style;
    const mono = MONO.test(s.fontFamily);
    s.removeProperty("font-family");
    s.removeProperty("font-size");
    s.removeProperty("line-height");
    s.removeProperty("color");
    s.removeProperty("background");
    s.removeProperty("background-color");
    s.removeProperty("mso-bidi-font-family");
    if (mono) el.dataset.ezMono = "1";
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
  });
  root.querySelectorAll("[bgcolor],[color],[text],[link],[vlink],[alink],table[border],table[cellpadding],table[width]").forEach((el) => {
    for (const a of ["bgcolor", "color", "text", "link", "vlink", "alink", "border", "cellpadding", "cellspacing", "width"]) el.removeAttribute(a);
  });
}

export function buildPage(html: string, id: string, page: string, keepStyle: boolean): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("font[face]").forEach((f) => {
    if (MONO.test(f.getAttribute("face") ?? "")) (f as HTMLElement).dataset.ezMono = "1";
  });
  doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (MONO.test(el.style.fontFamily)) el.dataset.ezMono = "1";
  });
  doc.querySelectorAll("script,noscript,iframe,frame,frameset,object,embed,applet,meta,base,title").forEach((e) => e.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  });
  const frag = document.createDocumentFragment();
  if (keepStyle) {
    doc.head.querySelectorAll("style,link[rel~=stylesheet]").forEach((s) => frag.appendChild(document.importNode(s, true)));
  } else {
    doc.querySelectorAll("style,link").forEach((s) => s.remove());
    stripLegacy(doc.body);
  }
  rewriteUrls(doc, id, page);
  const body = document.createElement("div");
  body.className = "ez-page";
  for (const n of Array.from(doc.body.childNodes)) body.appendChild(document.importNode(n, true));
  frag.appendChild(body);
  return frag;
}

function textOf(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  clone.querySelectorAll("p,div,li,tr").forEach((b) => b.append("\n"));
  return (clone.textContent ?? "").replace(/ /g, " ");
}

function isMonoEl(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.dataset.ezMono) return true;
  if (/^(CODE|TT|KBD|SAMP)$/.test(el.tagName)) return true;
  const kids = Array.from(el.children);
  if (!kids.length) return false;
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  const monoText = kids.filter((k) => isMonoEl(k)).map((k) => k.textContent ?? "").join("").trim();
  return monoText.length >= text.length * 0.9;
}

export type CodeCandidate = { host: HTMLElement; text: string };

export function findCodeBlocks(root: HTMLElement): CodeCandidate[] {
  const out: CodeCandidate[] = [];
  const used = new Set<Element>();
  root.querySelectorAll("pre,xmp,listing,plaintext").forEach((el) => {
    if (used.has(el) || el.closest(".ez-code")) return;
    used.add(el);
    out.push({ host: el as HTMLElement, text: textOf(el) });
  });
  root.querySelectorAll("textarea").forEach((el) => {
    const t = (el as HTMLTextAreaElement).value || el.textContent || "";
    if (t.includes("\n")) out.push({ host: el as HTMLElement, text: t });
  });
  root.querySelectorAll("code").forEach((el) => {
    if (el.closest("pre,xmp,listing,.ez-code")) return;
    const t = textOf(el);
    const parent = el.parentElement;
    const alone = parent && BLOCK_TAGS.has(parent.tagName) && (parent.textContent ?? "").trim() === t.trim();
    if (t.trim().includes("\n") || (alone && t.length > 80)) {
      used.add(el);
      out.push({ host: (alone && parent!.tagName !== "TD" && parent!.tagName !== "LI" ? parent : el) as HTMLElement, text: t });
    }
  });
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("p,div,td,li,blockquote,dd")).filter(
    (el) => !el.closest("pre,xmp,listing,.ez-code") && !el.querySelector("p,div,table,pre,ul,ol") && isMonoEl(el),
  );
  const seen = new Set<HTMLElement>();
  for (const el of blocks) {
    if (seen.has(el) || el.closest("pre,xmp,listing,.ez-code") || (el.tagName === "TD" && el.parentElement?.children.length !== 1)) continue;
    const group: HTMLElement[] = [el];
    seen.add(el);
    let next = el.nextElementSibling as HTMLElement | null;
    while (next && blocks.includes(next) && next.tagName === el.tagName) {
      group.push(next);
      seen.add(next);
      next = next.nextElementSibling as HTMLElement | null;
    }
    const text = group.map((g) => textOf(g).replace(/\n+$/, "")).join("\n");
    const lines = text.split("\n").filter((l) => l.trim()).length;
    if (lines < 2 && text.length < 60) continue;
    const host = document.createElement("div");
    group[0].before(host);
    group.forEach((g) => g.remove());
    out.push({ host, text });
  }
  return out;
}

export function markTerms(root: HTMLElement, terms: string[]): HTMLElement[] {
  const ts = terms.map((t) => t.trim()).filter(Boolean);
  if (!ts.length) return [];
  const re = new RegExp(ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement && !n.parentElement.closest("select,option,.ez-bar,style") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    const s = node.nodeValue ?? "";
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "ez-hit";
      mark.textContent = m[0];
      frag.appendChild(mark);
      marks.push(mark);
      last = m.index + m[0].length;
      if (!m[0].length) re.lastIndex++;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.replaceWith(frag);
  }
  return marks;
}

export function clearMarks(root: HTMLElement) {
  root.querySelectorAll("mark.ez-hit").forEach((m) => {
    const p = m.parentNode;
    m.replaceWith(document.createTextNode(m.textContent ?? ""));
    p?.normalize();
  });
}

export const PAGE_CSS = `
:host{display:block;color:var(--fg);font-family:var(--ui-font);font-size:var(--font-size);line-height:1.75}
.ez-page{word-wrap:break-word}
.ez-page h1,.ez-page h2,.ez-page h3,.ez-page h4{line-height:1.35;margin:1.4em 0 .6em;font-weight:650;color:var(--fg-strong)}
.ez-page h1{font-size:1.75em;margin-top:.4em}
.ez-page h2{font-size:1.4em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
.ez-page h3{font-size:1.18em}
.ez-page h4{font-size:1.05em}
.ez-page p{margin:.65em 0}
.ez-page a{color:var(--accent);text-decoration:none}
.ez-page a:hover{text-decoration:underline}
.ez-page a:not([href]){color:inherit;text-decoration:none}
.ez-page img{max-width:100%;height:auto}
.ez-page table{border-collapse:collapse;margin:1em 0;font-size:.94em;max-width:100%;display:block;overflow-x:auto;width:max-content}
.ez-page th,.ez-page td{border:1px solid var(--line);padding:6px 10px;vertical-align:top;text-align:left}
.ez-page th{background:var(--soft);font-weight:600}
.ez-page tr:nth-child(even) td{background:color-mix(in srgb,var(--soft) 45%,transparent)}
.ez-page code,.ez-page tt,.ez-page kbd,.ez-page samp,.ez-page [data-ez-mono]{font-family:var(--code-font);font-size:.9em}
.ez-page :not(pre)>code{background:var(--soft);padding:.1em .35em;border-radius:4px}
.ez-page hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}
.ez-page blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--line);color:var(--muted)}
.ez-page ul,.ez-page ol{padding-left:1.6em}
.ez-page dt{font-weight:600}
`;

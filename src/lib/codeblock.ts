import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DIALECTS, LANGS, detectDialect, detectLang, shikiLang, type Dialect } from "./detect";
import { formatSql } from "./format";
import { highlight } from "./highlight";
import type { Settings } from "../settings";

export type BlockOpts = {
  settings: Settings;
  codeTheme: string;
  lang?: string;
  full?: boolean;
};

export type Block = {
  el: HTMLElement;
  update: (o: BlockOpts) => void;
  text: () => string;
  toggleFormat: () => void;
  isSql: () => boolean;
  formatted: () => boolean;
  destroy: () => void;
};

export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent("ez-toast", { detail: msg }));
}

export async function copyText(s: string) {
  try {
    await writeText(s);
  } catch {
    await navigator.clipboard.writeText(s);
  }
  toast("已复制");
}

const ICON = {
  copy: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  lines: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 4h1.5M2 8h1.5M2 12h1.5M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  wrap: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 4h12M2 8h9a2.5 2.5 0 0 1 0 5H8m0 0 1.6-1.6M8 13l1.6 1.6M2 12h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fmt: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3h12M5 6.5h9M5 10h9M2 13.5h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

function btn(cls: string, title: string, html: string) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `ez-btn ${cls}`;
  b.title = title;
  b.innerHTML = html;
  return b;
}

export function mountCodeBlock(host: HTMLElement, source: string, opts: BlockOpts): Block {
  const code = source.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/\t/g, "    ").replace(/^\n+|\s+$/g, "");
  let o = opts;
  let lang = o.lang ?? detectLang(code);
  const detected = lang === "sql" ? detectDialect(code) : null;
  let dialect: Dialect = o.settings.dialect !== "auto" ? o.settings.dialect : (detected ?? o.settings.fallbackDialect);
  let lineNumbers = o.settings.lineNumbers;
  let wrap = o.settings.wrap;
  let formatted: string | null = null;
  let showFormatted = false;
  let seq = 0;

  const root = document.createElement("div");
  root.className = "ez-code" + (o.full ? " ez-full" : "");
  const bar = document.createElement("div");
  bar.className = "ez-bar";
  const select = document.createElement("select");
  select.className = "ez-lang";
  for (const d of DIALECTS) {
    const op = document.createElement("option");
    op.value = `sql:${d.id}`;
    op.textContent = d.id === "sql" ? "SQL" : `SQL · ${d.name}`;
    select.appendChild(op);
  }
  for (const l of LANGS) {
    if (l.id === "sql") continue;
    const op = document.createElement("option");
    op.value = l.id;
    op.textContent = l.name;
    select.appendChild(op);
  }
  const spacer = document.createElement("span");
  spacer.className = "ez-spacer";
  const bFmt = btn("ez-fmt", "格式化 SQL", `${ICON.fmt}<span>格式化</span>`);
  const bLines = btn("ez-lines", "行号", ICON.lines);
  const bWrap = btn("ez-wrap", "自动换行", ICON.wrap);
  const bCopy = btn("ez-copy", "复制", ICON.copy);
  bar.append(select, spacer, bFmt, bLines, bWrap, bCopy);
  const body = document.createElement("div");
  body.className = "ez-body";
  const pre = document.createElement("pre");
  pre.className = "ez-plain";
  pre.textContent = code;
  body.appendChild(pre);
  root.append(bar, body);
  host.replaceWith(root);

  const current = () => (showFormatted && formatted != null ? formatted : code);

  const syncBar = () => {
    select.value = lang === "sql" ? `sql:${dialect}` : lang;
    if (!select.value) select.value = "text";
    bFmt.style.display = lang === "sql" ? "" : "none";
    bFmt.classList.toggle("on", showFormatted);
    bFmt.querySelector("span")!.textContent = showFormatted ? "原文" : "格式化";
    bLines.classList.toggle("on", lineNumbers);
    bWrap.classList.toggle("on", wrap);
    root.classList.toggle("ez-ln", lineNumbers);
    root.classList.toggle("ez-wrapped", wrap);
    root.dataset.lang = lang;
  };

  const render = async () => {
    const my = ++seq;
    syncBar();
    const text = current();
    try {
      const h = await highlight(text, shikiLang(lang, dialect), o.codeTheme);
      if (my !== seq) return;
      body.innerHTML = h.html;
      root.style.setProperty("--cb-bg", h.bg);
      root.style.setProperty("--cb-fg", h.fg);
    } catch {
      if (my !== seq) return;
      body.innerHTML = "";
      const p = document.createElement("pre");
      p.className = "ez-plain";
      p.textContent = text;
      body.appendChild(p);
    }
  };

  const doFormat = () => {
    if (lang !== "sql") return false;
    try {
      formatted = formatSql(code, dialect, o.settings.upperKeywords);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "无法格式化");
      return false;
    }
  };

  const toggleFormat = () => {
    if (lang !== "sql") return;
    if (!showFormatted) {
      if (!doFormat()) return;
      showFormatted = true;
    } else showFormatted = false;
    render();
  };

  select.onchange = () => {
    const v = select.value;
    if (v.startsWith("sql:")) {
      lang = "sql";
      dialect = v.slice(4) as Dialect;
    } else lang = v;
    if (showFormatted) {
      if (!doFormat()) showFormatted = false;
    } else formatted = null;
    render();
  };
  bFmt.onclick = toggleFormat;
  bLines.onclick = () => {
    lineNumbers = !lineNumbers;
    syncBar();
  };
  bWrap.onclick = () => {
    wrap = !wrap;
    syncBar();
  };
  bCopy.onclick = () => copyText(current());

  if (lang === "sql" && o.settings.autoFormat && code.split("\n").length > 0) {
    if (doFormat()) showFormatted = true;
  }
  render();

  return {
    el: root,
    update(n) {
      const themeChanged = n.codeTheme !== o.codeTheme;
      const prev = o.settings;
      o = n;
      if (prev.lineNumbers !== n.settings.lineNumbers) lineNumbers = n.settings.lineNumbers;
      if (prev.wrap !== n.settings.wrap) wrap = n.settings.wrap;
      let again = themeChanged;
      if (prev.dialect !== n.settings.dialect || prev.fallbackDialect !== n.settings.fallbackDialect) {
        dialect = n.settings.dialect !== "auto" ? n.settings.dialect : (detected ?? n.settings.fallbackDialect);
        again = true;
      }
      if (prev.upperKeywords !== n.settings.upperKeywords && showFormatted) {
        doFormat();
        again = true;
      }
      if (again) render();
      else syncBar();
    },
    text: current,
    toggleFormat,
    isSql: () => lang === "sql",
    formatted: () => showFormatted,
    destroy() {
      seq++;
    },
  };
}

export const CODE_CSS = `
.ez-code{--cb-bg:#f6f8fa;--cb-fg:#24292e;position:relative;margin:14px 0;border-radius:10px;background:var(--cb-bg);color:var(--cb-fg);border:1px solid var(--code-border);overflow:hidden;font-family:var(--code-font);font-size:var(--code-size);line-height:1.6;text-align:left;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0}
.ez-code.ez-full{margin:0;border:0;border-radius:0;min-height:100%}
.ez-bar{display:flex;align-items:center;gap:2px;padding:4px 6px 4px 10px;border-bottom:1px solid color-mix(in srgb,var(--cb-fg) 10%,transparent);font-family:var(--ui-font);font-size:12px;opacity:.55;transition:opacity .15s}
.ez-code:hover .ez-bar,.ez-full .ez-bar{opacity:1}
.ez-full .ez-bar{position:sticky;top:0;z-index:2;background:var(--cb-bg)}
.ez-spacer{flex:1}
.ez-lang{appearance:none;-webkit-appearance:none;background:transparent;border:0;color:inherit;font:inherit;font-weight:600;padding:2px 4px;border-radius:5px;cursor:pointer;outline:none}
.ez-lang:hover{background:color-mix(in srgb,var(--cb-fg) 10%,transparent)}
.ez-lang option{color:#222;background:#fff}
.ez-btn{display:inline-flex;align-items:center;gap:4px;height:24px;min-width:24px;justify-content:center;padding:0 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;opacity:.75}
.ez-btn:hover{opacity:1;background:color-mix(in srgb,var(--cb-fg) 10%,transparent)}
.ez-btn.on{opacity:1;color:var(--accent)}
.ez-body{overflow-x:auto}
.ez-body pre{margin:0;padding:12px 16px;background:transparent !important;font:inherit;white-space:pre;overflow:visible;border:0;tab-size:4}
.ez-body code{font:inherit;background:none;padding:0;border:0;counter-reset:ln;display:block}
.ez-wrapped .ez-body pre{white-space:pre-wrap;word-break:break-word}
.ez-body .line{display:inline-block;min-width:100%;}
.ez-wrapped .ez-body .line{display:inline}
.ez-ln .ez-body .line::before{counter-increment:ln;content:counter(ln);display:inline-block;width:3.2em;margin-left:-.6em;margin-right:1em;text-align:right;opacity:.35;user-select:none;-webkit-user-select:none}
.ez-ln.ez-wrapped .ez-body pre{padding-left:4.4em;text-indent:-4.4em}
.ez-ln.ez-wrapped .ez-body .line::before{text-indent:0}
`;

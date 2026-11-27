import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DIALECTS, LANGS, detectDialect, detectLang, shikiLang, type Dialect } from "./detect";
import { formatSql } from "./format";
import { highlight } from "./highlight";
import { SAME_CSS } from "./same";
import { autoFolds, computeFolds, outlineFolds, type Fold } from "./fold";
import type { Settings } from "../settings";

export type BlockOpts = {
  settings: Settings;
  codeTheme: string;
  lang?: string;
  full?: boolean;
  edit?: { saved: string | null; save: (text: string | null) => Promise<void>; name: string };
  onEdit?: () => void;
};

export function hashText(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function normalizeCode(source: string) {
  return source.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/\t/g, "    ").replace(/^\n+|\s+$/g, "");
}

export type Block = {
  el: HTMLElement;
  update: (o: BlockOpts) => void;
  text: () => string;
  toggleFormat: () => void;
  isSql: () => boolean;
  formatted: () => boolean;
  edit: () => void;
  editWith: (text: string) => void;
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
  fold: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4-4 4 4M4 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M10.8 2.7l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
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
  const code = normalizeCode(source);
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
  const bFold = btn("ez-foldall", "折叠 / 展开全部", ICON.fold);
  const bCopy = btn("ez-copy", "复制", ICON.copy);
  const bEdit = btn("ez-edit", "编辑", `${ICON.edit}<span>编辑</span>`);
  const bCopyToggle = btn("ez-copyv", "切换编辑副本 / 原文", "<span>副本</span>");
  if (!o.edit && !o.onEdit) bEdit.style.display = "none";
  bar.append(select, spacer, bCopyToggle, bEdit, bFmt, bFold, bLines, bWrap, bCopy);
  let edited: string | null = o.edit?.saved ?? null;
  let showEdited = edited != null;
  let editing: { destroy: () => void } | null = null;
  const body = document.createElement("div");
  body.className = "ez-body";
  const pre = document.createElement("pre");
  pre.className = "ez-plain";
  pre.textContent = code;
  body.appendChild(pre);
  root.append(bar, body);
  host.replaceWith(root);

  const base = () => (showEdited && edited != null ? edited : code);
  const current = () => (showFormatted && formatted != null ? formatted : base());

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
    bCopyToggle.style.display = edited != null ? "" : "none";
    bCopyToggle.classList.toggle("on", showEdited);
    bCopyToggle.querySelector("span")!.textContent = showEdited ? "副本" : "原文";
  };

  let folds: Fold[] = [];
  let collapsed = new Set<number>();
  let foldedText: string | null = null;
  let lineEls: HTMLElement[] = [];

  const applyFolds = () => {
    for (const el of lineEls) el.classList.remove("ez-hidden");
    body.querySelectorAll(".ez-ft,.ez-fb").forEach((e) => e.remove());
    for (const f of folds) {
      if (!collapsed.has(f.start)) continue;
      for (let k = f.from; k <= f.to && k < lineEls.length; k++) lineEls[k].classList.add("ez-hidden");
    }
    for (const f of folds) {
      const el = lineEls[f.start];
      if (!el || el.classList.contains("ez-hidden")) continue;
      const closed = collapsed.has(f.start);
      const t = document.createElement("span");
      t.className = "ez-ft" + (closed ? " closed" : "");
      t.dataset.start = String(f.start);
      el.prepend(t);
      if (closed) {
        const b = document.createElement("span");
        b.className = "ez-fb";
        b.dataset.start = String(f.start);
        b.textContent = f.label ? `⋯ ${f.label}` : `⋯ ${f.to - f.from + 1} 行`;
        el.append(b);
      }
    }
    bFold.classList.toggle("on", collapsed.size > 0);
  };

  const setupFolds = (text: string) => {
    const codeEl = body.querySelector("code");
    if (!codeEl) {
      lineEls = [];
      folds = [];
      return;
    }
    for (const n of Array.from(codeEl.childNodes)) if (n.nodeType === 3) n.remove();
    lineEls = Array.from(codeEl.children) as HTMLElement[];
    lineEls.forEach((el, i) => (el.dataset.ln = String(i + 1)));
    folds = lineEls.length > 2 && lineEls.length < 40000 ? computeFolds(text, lang) : [];
    if (foldedText !== text) {
      foldedText = text;
      collapsed = new Set(o.settings.autoFold ? autoFolds(folds, text.split("\n")) : []);
    } else {
      const starts = new Set(folds.map((f) => f.start));
      collapsed = new Set([...collapsed].filter((s) => starts.has(s)));
    }
    applyFolds();
  };

  body.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest(".ez-ft,.ez-fb") as HTMLElement | null;
    if (!el) return;
    const st = Number(el.dataset.start);
    if (collapsed.has(st)) collapsed.delete(st);
    else collapsed.add(st);
    applyFolds();
  });
  root.addEventListener("ez-reveal", (e) => {
    const line = e.target as HTMLElement;
    const ln = Number(line.dataset.ln) - 1;
    for (const f of folds) if (collapsed.has(f.start) && f.from <= ln && f.to >= ln) collapsed.delete(f.start);
    applyFolds();
  });
  bFold.onclick = () => {
    collapsed = collapsed.size ? new Set() : new Set(outlineFolds(folds));
    applyFolds();
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
      setupFolds(text);
    } catch {
      if (my !== seq) return;
      body.innerHTML = "";
      const p = document.createElement("pre");
      p.className = "ez-plain";
      p.textContent = text;
      body.appendChild(p);
      lineEls = [];
      folds = [];
    }
  };

  const doFormat = () => {
    if (lang !== "sql") return false;
    try {
      formatted = formatSql(base(), dialect, o.settings.upperKeywords);
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
  bCopyToggle.onclick = () => {
    showEdited = !showEdited;
    showFormatted = false;
    formatted = null;
    render();
  };

  const startEdit = async (initial?: string) => {
    if (o.onEdit && initial == null) {
      o.onEdit();
      return;
    }
    if (!o.edit || editing) return;
    const { createEditor } = await import("./editor");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { api } = await import("../api");
    bar.style.display = "none";
    body.innerHTML = "";
    const box = document.createElement("div");
    box.className = "ez-editor";
    const actions = document.createElement("div");
    actions.className = "ez-edit-bar";
    const mk = (label: string, cls = "") => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ez-btn " + cls;
      b.textContent = label;
      actions.appendChild(b);
      return b;
    };
    const host = document.createElement("div");
    host.className = "ez-editor-host";
    box.append(actions, host);
    body.appendChild(box);
    const finish = () => {
      ed.destroy();
      editing = null;
      bar.style.display = "";
      render();
    };
    const doSave = async () => {
      const t = ed.text().replace(/\s+$/, "");
      edited = t === code ? null : t;
      showEdited = edited != null;
      showFormatted = false;
      formatted = null;
      await o.edit!.save(edited);
      toast(edited != null ? "已保存编辑副本" : "已恢复原文");
      finish();
    };
    const ed = createEditor(host, {
      text: initial ?? current(),
      lang,
      dialect,
      dark: document.documentElement.dataset.theme === "dark",
      wrap,
      onSave: doSave,
      onCancel: finish,
    });
    editing = ed;
    mk("保存 ⌘S", "primary").onclick = doSave;
    mk("取消").onclick = finish;
    if (edited != null) {
      mk("恢复原文").onclick = async () => {
        edited = null;
        showEdited = false;
        await o.edit!.save(null);
        toast("已恢复原文");
        finish();
      };
    }
    const sp = document.createElement("span");
    sp.className = "ez-spacer";
    actions.appendChild(sp);
    mk("导出…").onclick = async () => {
      const p = await save({ defaultPath: o.edit!.name + (lang === "sql" ? ".sql" : ".txt") });
      if (p) {
        await api.fileWrite(p, ed.text(), "UTF-8");
        toast("已导出");
      }
    };
    ed.focus();
  };
  bEdit.onclick = () => startEdit();

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
    edit: () => startEdit(),
    editWith: (t: string) => startEdit(t),
    destroy() {
      seq++;
      editing?.destroy();
    },
  };
}

export const CODE_CSS = `
.ez-code{--cb-bg:#f6f8fa;--cb-fg:#24292e;--gut:1.7em;position:relative;margin:14px 0;border-radius:10px;background:var(--cb-bg);color:var(--cb-fg);border:1px solid var(--code-border);overflow:hidden;font-family:var(--code-font);font-size:var(--code-size);line-height:1.6;text-align:left;font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0}
.ez-code.ez-ln{--gut:4.9em}
.ez-code.ez-full{margin:0;border:0;border-radius:0;min-height:100%}
.ez-bar{display:flex;align-items:center;gap:2px;padding:4px 6px 4px 10px;border-bottom:1px solid color-mix(in srgb,var(--cb-fg) 10%,transparent);font-family:var(--ui-font);font-size:12px;opacity:.55;transition:opacity .15s;user-select:none;-webkit-user-select:none}
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
.ez-body pre{margin:0;padding:12px 16px 12px 0;background:transparent !important;font:inherit;white-space:pre;overflow:visible;border:0;tab-size:4;min-width:100%;width:max-content;box-sizing:border-box}
.ez-body pre.ez-plain{padding-left:16px}
.ez-body code{font:inherit;background:none;padding:0;border:0;display:block}
.ez-body .line{display:block;position:relative;padding-left:var(--gut);min-height:1.6em}
.ez-body .line.ez-hidden{display:none}
.ez-wrapped .ez-body pre{white-space:pre-wrap;word-break:break-word;width:auto}
.ez-ln .ez-body .line::before{content:attr(data-ln);position:absolute;left:0;width:3.1em;text-align:right;opacity:.35;user-select:none;-webkit-user-select:none}
.ez-ft{position:absolute;left:calc(var(--gut) - 1.45em);top:0;width:1.2em;height:1.6em;cursor:pointer;opacity:0;user-select:none;-webkit-user-select:none;display:flex;align-items:center;justify-content:center}
.ez-ft::after{content:"";width:.42em;height:.42em;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translate(-1px,-1px);opacity:.6}
.ez-ft.closed::after{transform:rotate(-45deg);opacity:.9}
.ez-ft.closed,.ez-body:hover .ez-ft{opacity:1}
.ez-ft:hover::after{opacity:1;color:var(--accent)}
.ez-fb{display:inline-block;margin-left:.8em;padding:0 .55em;border-radius:4px;font-size:.85em;line-height:1.45;cursor:pointer;background:color-mix(in srgb,var(--cb-fg) 10%,transparent);opacity:.75;user-select:none;-webkit-user-select:none;font-family:var(--ui-font)}
.ez-fb:hover{opacity:1;color:var(--accent)}
.ez-editor{display:flex;flex-direction:column;font-family:var(--ui-font)}
.ez-edit-bar{display:flex;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid color-mix(in srgb,var(--cb-fg) 12%,transparent);font-size:12px}
.ez-edit-bar .ez-btn{opacity:1;padding:0 9px;border:1px solid color-mix(in srgb,var(--cb-fg) 18%,transparent)}
.ez-edit-bar .ez-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.ez-editor-host{min-height:80px;max-height:70vh;overflow:auto}
.ez-editor-host .cm-editor{background:transparent}
` + SAME_CSS;

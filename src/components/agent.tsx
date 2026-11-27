import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ACTIONS, CONVERT_TARGETS, agentApi, buildPrompt, convertPrompt, nextRunId, onAgent, type AgentInfo, type AgentMsg, type AgentRef } from "../lib/agent";
import { renderMd } from "../lib/md";
import { CODE_CSS, copyText, mountCodeBlock, type Block } from "../lib/codeblock";
import { detectLang } from "../lib/detect";
import { useSettings } from "../settings";
import { hitText } from "../lib/same";
import { showMenu } from "./ContextMenu";
import { IconClose, IconPlus } from "./Icons";

export type SelInfo = { text: string; lang: string; lines?: string; range?: Range; codeEl?: HTMLElement | null };

export function ensureCodeCss() {
  if (document.getElementById("ez-code-css")) return;
  const s = document.createElement("style");
  s.id = "ez-code-css";
  s.textContent = CODE_CSS;
  document.head.appendChild(s);
}

type ComposedSel = Selection & { getComposedRanges?: (...a: unknown[]) => StaticRange[] };

export function selRange(shadow?: ShadowRoot | null): Range | null {
  const sr = shadow as (ShadowRoot & { getSelection?: () => Selection | null }) | null | undefined;
  const own = sr?.getSelection?.();
  if (own && own.rangeCount && !own.isCollapsed) return own.getRangeAt(0);
  const sel = document.getSelection() as ComposedSel | null;
  if (!sel || sel.isCollapsed) return null;
  if (shadow && typeof sel.getComposedRanges === "function") {
    let st: StaticRange | undefined;
    try {
      st = sel.getComposedRanges({ shadowRoots: [shadow] })[0];
    } catch {
      try {
        st = sel.getComposedRanges(shadow)[0];
      } catch {
        st = undefined;
      }
    }
    if (st && !st.collapsed) {
      const r = document.createRange();
      r.setStart(st.startContainer, st.startOffset);
      r.setEnd(st.endContainer, st.endOffset);
      return r;
    }
  }
  return sel.rangeCount ? sel.getRangeAt(0) : null;
}

function rangeText(r: Range) {
  const f = r.cloneContents();
  f.querySelectorAll(".ez-ft,.ez-fb,.ez-bar,style").forEach((e) => e.remove());
  f.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  const blocks = f.querySelectorAll(".line,div,p,li,tr,h1,h2,h3,h4,pre");
  blocks.forEach((b, i) => i < blocks.length - 1 && b.append("\n"));
  if (!blocks.length) return f.textContent ?? "";
  return (f.textContent ?? "").replace(/\n{3,}/g, "\n\n");
}

type Pt = { x: number; y: number; el: Element | null };
let lastDown: Pt | null = null;
let lastUp: Pt | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button === 0) lastDown = { x: e.clientX, y: e.clientY, el: (e.composedPath()[0] as Element) ?? null };
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    (e) => {
      if (e.button === 0) lastUp = { x: e.clientX, y: e.clientY, el: (e.composedPath()[0] as Element) ?? null };
    },
    true,
  );
}

function caret(p: Pt | null): { node: Node; off: number } | null {
  if (!p?.el || p.el.nodeType !== 1) return null;
  const scope = (p.el.closest(".line") ?? p.el) as Element;
  if ((scope.textContent?.length ?? 0) > 4000) return null;
  return hitText(p.x, p.y, scope);
}

function rangeFromPoints(): Range | null {
  const a = caret(lastDown);
  const b = caret(lastUp);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.off);
    r.setEnd(a.node, a.off);
    const r2 = document.createRange();
    r2.setStart(b.node, b.off + 1 <= (b.node.nodeValue?.length ?? 0) ? b.off + 1 : b.off);
    if (r.compareBoundaryPoints(Range.START_TO_START, r2) <= 0) r.setEnd(r2.startContainer, r2.startOffset);
    else {
      r.setStart(b.node, b.off);
      r.setEnd(a.node, Math.min(a.off + 1, a.node.nodeValue?.length ?? a.off));
    }
  } catch {
    return null;
  }
  return r.collapsed ? null : r;
}

export function selectionInfo(shadow?: ShadowRoot | null): SelInfo | null {
  let r = selRange(shadow);
  if (shadow && (!r || !shadow.contains(r.startContainer) || !shadow.contains(r.endContainer))) {
    const p = rangeFromPoints();
    if (p && shadow.contains(p.startContainer)) r = p;
  }
  const sel = document.getSelection();
  let text = r ? rangeText(r) : "";
  if (!text.trim() && sel) text = sel.toString();
  text = text.replace(/\u00a0/g, " ");
  if (text.trim().length < 2) return null;
  let lang = "";
  let lines: string | undefined;
  let codeEl: HTMLElement | null = null;
  if (r) {
    const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const a = el(r.startContainer)?.closest<HTMLElement>(".line");
    const b = el(r.endContainer)?.closest<HTMLElement>(".line");
    codeEl = el(r.commonAncestorContainer)?.closest<HTMLElement>(".ez-code") ?? a?.closest<HTMLElement>(".ez-code") ?? null;
    if (codeEl?.dataset.lang) lang = codeEl.dataset.lang;
    if (a?.dataset.ln && b?.dataset.ln) lines = a.dataset.ln === b.dataset.ln ? `第 ${a.dataset.ln} 行` : `第 ${a.dataset.ln}-${b.dataset.ln} 行`;
  }
  return { text: text.replace(/\s+$/, ""), lang: lang || detectLang(text), lines, range: r?.cloneRange(), codeEl };
}

let refSeq = 1;

export type AgentCtl = ReturnType<typeof useAgent>;

export function useAgent(opts: { source: () => string; fallback: () => SelInfo | null }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<AgentRef[]>([]);
  const [msgs, setMsgs] = useState<AgentMsg[]>([]);
  const [running, setRunning] = useState<number | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const session = useRef<string | null>(null);
  const o = useRef(opts);
  o.current = opts;
  const st = useRef({ settings, refs, running });
  st.current = { settings, refs, running };

  const addRef = useCallback((s: SelInfo) => {
    setRefs((r) => (r.some((x) => x.text === s.text) ? r : [...r, { id: refSeq++, text: s.text, lang: s.lang, lines: s.lines, source: o.current.source() }]));
    setOpen(true);
    setFocusTick((n) => n + 1);
  }, []);

  const removeRef = useCallback((id: number) => setRefs((r) => r.filter((x) => x.id !== id)), []);

  const send = useCallback((text: string, opt: { fallback?: boolean; sel?: SelInfo | null; inline?: boolean } = {}) => {
    const t = text.trim();
    if (!t || st.current.running) return;
    let rs = st.current.refs;
    if (opt.sel) {
      const sr = { id: refSeq++, text: opt.sel.text, lang: opt.sel.lang, lines: opt.sel.lines, source: o.current.source() };
      rs = opt.inline ? [sr] : [...rs.filter((r) => r.text !== sr.text), sr];
    } else if (opt.inline) rs = [];
    if (!rs.length && opt.fallback) {
      const f = o.current.fallback();
      if (f) rs = [{ id: refSeq++, text: f.text, lang: f.lang, lines: f.lines, source: o.current.source() }];
    }
    const first = !session.current;
    const prompt = buildPrompt(t, rs, first, first ? o.current.source() : "", st.current.settings.agentLength !== "detail");
    const id = nextRunId();
    if (!opt.inline) {
      setOpen(true);
      setRefs([]);
    }
    setMsgs((m) => [...m, { role: "user", text: t, refs: rs }, { role: "assistant", text: "" }]);
    setRunning(id);
    const patch = (f: (m: AgentMsg) => AgentMsg) =>
      setMsgs((m) => {
        const c = m.slice();
        c[c.length - 1] = f(c[c.length - 1]);
        return c;
      });
    const off = onAgent(id, (e) => {
      if (e.kind === "delta") patch((m) => ({ ...m, text: m.text + e.text, tool: undefined }));
      else if (e.kind === "final") patch((m) => ({ ...m, text: e.text }));
      else if (e.kind === "tool") patch((m) => ({ ...m, tool: e.text }));
      else if (e.kind === "session") session.current = e.text;
      else if (e.kind === "error") patch((m) => ({ ...m, error: e.text }));
      else if (e.kind === "done") {
        patch((m) => ({ ...m, done: true, tool: undefined }));
        setRunning(null);
        off();
      }
    });
    const s = st.current.settings;
    agentApi.run(id, prompt, s.agentPath, s.agentModel, session.current).catch((err) => {
      patch((m) => ({ ...m, error: String(err), done: true }));
      setRunning(null);
      off();
    });
  }, []);

  const stop = useCallback(() => {
    const id = st.current.running;
    if (id) agentApi.stop(id).catch(() => undefined);
  }, []);

  const reset = useCallback(() => {
    stop();
    session.current = null;
    setMsgs([]);
    setRunning(null);
  }, []);

  const truncate = useCallback((n: number) => {
    stop();
    if (n === 0) session.current = null;
    setMsgs((m) => m.slice(0, n));
    setRunning(null);
  }, []);

  return { open, setOpen, refs, addRef, removeRef, msgs, running, send, stop, reset, truncate, focusTick };
}

export function Answer({ msg }: { msg: AgentMsg }) {
  const { settings, codeTheme } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const blocks = useRef<Block[]>([]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    ensureCodeCss();
    blocks.current.forEach((b) => b.destroy());
    blocks.current = [];
    const codes = renderMd(msg.text, el);
    for (const c of codes) {
      if (msg.done) {
        blocks.current.push(mountCodeBlock(c.el, c.text, { settings, codeTheme, lang: c.lang && c.lang !== "text" ? c.lang : undefined }));
      } else {
        const pre = document.createElement("pre");
        pre.className = "md-pre";
        pre.textContent = c.text;
        c.el.replaceWith(pre);
      }
    }
  }, [msg.text, msg.done]);
  useEffect(() => {
    blocks.current.forEach((b) => b.update({ settings, codeTheme }));
  }, [settings, codeTheme]);
  useEffect(() => () => blocks.current.forEach((b) => b.destroy()), []);
  return (
    <div
      className="ag-md"
      ref={box}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          openUrl(a.href).catch(() => undefined);
        }
      }}
    />
  );
}

function RefChip({ r, onRemove }: { r: AgentRef; onRemove?: () => void }) {
  const [peek, setPeek] = useState(false);
  const n = r.text.split("\n").length;
  return (
    <div className={`ag-ref ${peek ? "peek" : ""}`}>
      <button className="ag-ref-head" onClick={() => setPeek(!peek)} title={r.source}>
        <span className="ag-ref-lang">{r.lang}</span>
        <span className="ag-ref-name">{r.lines ?? r.text.trim().split("\n")[0].slice(0, 40)}</span>
        <span className="ag-ref-n">{n} 行</span>
      </button>
      {onRemove && (
        <button className="ag-ref-x" onClick={onRemove}>
          <IconClose size={10} />
        </button>
      )}
      {peek && <pre className="ag-ref-body">{r.text.length > 4000 ? r.text.slice(0, 4000) + "\n…" : r.text}</pre>}
    </div>
  );
}

const MODELS = [
  { id: "", label: "默认模型" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

export function AgentPanel({ agent, onSettings }: { agent: AgentCtl; onSettings: () => void }) {
  const { settings, set } = useSettings();
  const [input, setInput] = useState("");
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    ensureCodeCss();
    agentApi
      .info(settings.agentPath)
      .then(setInfo)
      .catch(() => setInfo({ path: null, version: null }));
  }, [settings.agentPath]);

  useEffect(() => {
    ta.current?.focus();
  }, [agent.focusTick]);

  useLayoutEffect(() => {
    const l = list.current;
    if (l && stick.current) l.scrollTop = l.scrollHeight;
  }, [agent.msgs]);

  useLayoutEffect(() => {
    const t = ta.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(200, t.scrollHeight) + "px";
  }, [input]);

  const submit = () => {
    if (!input.trim() || agent.running) return;
    stick.current = true;
    agent.send(input);
    setInput("");
  };

  const act = (p: string) => {
    stick.current = true;
    agent.send(p, { fallback: true });
  };

  const missing = info && !info.path;
  const busy = agent.running != null;

  return (
    <div className="agent">
      <div className="ag-head">
        <span className="ag-title">Agent</span>
        <span className={`ag-backend ${missing ? "bad" : ""}`} title={info?.path ?? ""}>
          {missing ? "未找到 Claude Code" : `Claude Code${info?.version ? " " + info.version.split(" ")[0] : ""}`}
        </span>
        <select className="ag-model" value={settings.agentModel} onChange={(e) => set("agentModel", e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="icon-btn sm" title="新对话" onClick={agent.reset} disabled={!agent.msgs.length}>
          <IconPlus />
        </button>
        <button className="icon-btn sm" title="关闭 ⌘J" onClick={() => agent.setOpen(false)}>
          <IconClose size={12} />
        </button>
      </div>
      <div
        className="ag-list"
        ref={list}
        onScroll={(e) => {
          const l = e.currentTarget;
          stick.current = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
        }}
      >
        {missing && (
          <div className="ag-missing">
            <span>没有找到本机的 Claude Code</span>
            <button className="btn" onClick={onSettings}>
              设置路径
            </button>
          </div>
        )}
        {!agent.msgs.length && !missing && (
          <div className="ag-empty">
            {ACTIONS.map((a) => (
              <button key={a.id} className="ag-quick" onClick={() => act(a.prompt)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        {agent.msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ag-user">
              {m.refs && m.refs.length > 0 && (
                <div className="ag-refs">
                  {m.refs.map((r) => (
                    <RefChip key={r.id} r={r} />
                  ))}
                </div>
              )}
              <div className="ag-user-text">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="ag-bot">
              {m.text ? <Answer msg={m} /> : !m.error && <div className="ag-wait"><span /><span /><span /></div>}
              {m.tool && <div className="ag-tool">{m.tool}</div>}
              {m.error && <div className="ag-error">{m.error}</div>}
              {m.done && m.text && (
                <div className="ag-bot-bar">
                  <button onClick={() => copyText(m.text)}>复制</button>
                </div>
              )}
            </div>
          ),
        )}
      </div>
      <div className="ag-compose">
        {agent.refs.length > 0 && (
          <div className="ag-refs">
            {agent.refs.map((r) => (
              <RefChip key={r.id} r={r} onRemove={() => agent.removeRef(r.id)} />
            ))}
          </div>
        )}
        <div className="ag-actions">
          {ACTIONS.slice(0, 4).map((a) => (
            <button key={a.id} className="ag-chip" disabled={busy || !!missing} onClick={() => act(a.prompt)}>
              {a.label}
            </button>
          ))}
          <button
            className="ag-chip"
            disabled={busy || !!missing}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              showMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => undefined }, [
                ...ACTIONS.slice(4).map((a) => ({ label: a.label, action: () => act(a.prompt) })),
                "sep",
                ...CONVERT_TARGETS.map((t) => ({ label: `转为 ${t}`, action: () => act(convertPrompt(t)) })),
              ]);
            }}
          >
            更多
          </button>
        </div>
        <div className="ag-input">
          <textarea
            ref={ta}
            rows={1}
            value={input}
            placeholder={agent.refs.length ? "针对引用提问" : "提问"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && busy) agent.stop();
            }}
          />
          {busy ? (
            <button className="ag-send stop" title="停止" onClick={agent.stop}>
              <span />
            </button>
          ) : (
            <button className="ag-send" title="发送 ↩" disabled={!input.trim() || !!missing} onClick={submit}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


const ICON_SPARK = (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 .9c.5 3.6 1.6 4.8 5.2 5.3-3.6.4-4.7 1.6-5.2 5.2-.5-3.6-1.6-4.8-5.2-5.2C6.4 5.7 7.5 4.5 8 .9z" />
    <path d="M12.9 10.4c.2 1.6.7 2.1 2.3 2.3-1.6.2-2.1.7-2.3 2.3-.2-1.6-.7-2.1-2.3-2.3 1.6-.2 2.1-.7 2.3-2.3z" opacity=".7" />
  </svg>
);

type Hl = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
function setAskHighlight(r: Range | null | undefined) {
  try {
    const hl = (CSS as unknown as { highlights?: Hl }).highlights;
    const H = (window as unknown as { Highlight?: new (r: Range) => unknown }).Highlight;
    if (!hl || !H) return;
    if (r) hl.set("ez-ask", new H(r));
    else hl.delete("ez-ask");
  } catch {
    /* unsupported */
  }
}

function rectOf(sel: SelInfo, fallback: { x: number; y: number }) {
  try {
    const rs = sel.range?.getClientRects();
    if (rs && rs.length) {
      const all = Array.from(rs).filter((r) => r.width > 0 || r.height > 0);
      if (all.length) {
        const top = Math.min(...all.map((r) => r.top));
        const bottom = Math.max(...all.map((r) => r.bottom));
        const left = Math.min(...all.map((r) => r.left));
        return { left, top, bottom };
      }
    }
  } catch {
    /* ignore */
  }
  return { left: fallback.x - 20, top: fallback.y - 10, bottom: fallback.y + 10 };
}

export type SelUI = ReturnType<typeof useSelUI>;

export function useSelUI(getShadow: () => ShadowRoot | null) {
  const [tb, setTb] = useState<{ sel: SelInfo; mouse: { x: number; y: number } } | null>(null);
  const [ask, setAsk] = useState<{ sel: SelInfo; mouse: { x: number; y: number }; start: number; auto?: string } | null>(null);
  const [, setTick] = useState(0);
  const onUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    const mouse = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => {
      const sel = selectionInfo(getShadow());
      if (sel) {
        setAsk(null);
        setAskHighlight(null);
      }
      setTb(sel ? { sel, mouse } : null);
    }, 0);
  }, []);
  const hide = useCallback(() => setTb(null), []);
  const tbRef = useRef(tb);
  tbRef.current = tb;
  const openAsk = useCallback((start: number, auto?: string) => {
    const t = tbRef.current;
    if (!t) return;
    setAsk({ sel: t.sel, mouse: t.mouse, start, auto });
    setAskHighlight(t.sel.range);
    setTb(null);
  }, []);
  const closeAsk = useCallback(() => {
    setAsk(null);
    setAskHighlight(null);
  }, []);
  useEffect(() => {
    if (!tb && !ask) return;
    const down = (e: MouseEvent) => {
      const t = e.composedPath()[0] as HTMLElement;
      if (t?.closest?.(".sel-tb,.ask-wrap,.ctx")) return;
      setTb(null);
      setAsk(null);
      setAskHighlight(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setTb(null);
      setAsk(null);
      setAskHighlight(null);
    };
    const scroll = () => setTick((n) => n + 1);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", scroll);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", scroll);
    };
  }, [tb, ask]);
  useEffect(() => () => setAskHighlight(null), []);
  return { tb, ask, onUp, hide, openAsk, closeAsk };
}

export function SelToolbar({ ui, agent }: { ui: SelUI; agent: AgentCtl }) {
  const t = ui.tb;
  if (!t || ui.ask) return null;
  const r = rectOf(t.sel, t.mouse);
  const above = r.top > 60;
  const style = { left: Math.max(8, Math.min(r.left, window.innerWidth - 330)), top: above ? r.top - 40 : r.bottom + 8 };
  const run = (prompt: string) => {
    const start = agent.msgs.length;
    agent.send(prompt, { sel: t.sel, inline: true });
    ui.openAsk(start, prompt);
  };
  return (
    <div className="sel-tb" style={style} onMouseDown={(e) => e.preventDefault()}>
      <button className="sel-ai" onClick={() => ui.openAsk(agent.msgs.length)} disabled={agent.running != null}>
        {ICON_SPARK}
        问 AI
      </button>
      <span className="sel-sep" />
      <button onClick={() => run(ACTIONS[0].prompt)} disabled={agent.running != null}>
        解释
      </button>
      <button onClick={() => run(ACTIONS[2].prompt)} disabled={agent.running != null}>
        找问题
      </button>
      <span className="sel-sep" />
      <button
        title="引用到侧栏 ⌘L"
        onClick={() => {
          agent.addRef(t.sel);
          ui.hide();
        }}
      >
        引用
      </button>
      <button
        title="复制"
        onClick={() => {
          copyText(t.sel.text);
          ui.hide();
        }}
      >
        复制
      </button>
    </div>
  );
}

const P = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IC: Record<string, React.ReactNode> = {
  explain: P("M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 0-1.5-1.5h-4zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8a1.5 1.5 0 0 1 1.5-1.5h4z"),
  review: P("M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zM11 11l3.5 3.5M5 7h4M7 5v4"),
  optimize: P("M3 13l7-7M9 3.5l.6 1.4 1.4.6-1.4.6L9 7.5l-.6-1.4L7 5.5l1.4-.6zM12.5 7.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4z"),
  comment: P("M3 4h10M3 8h6M3 12h8M12 9.5l2 2-2 2"),
  objects: P("M2.5 3.5h11v9h-11zM2.5 6.5h11M6.5 6.5v6"),
  flow: P("M4 2.5v3M4 5.5h8v3M12 8.5v2M4 5.5v8M10.5 10.5h3v3h-3zM2.5 13.5h3"),
  testdata: P("M8 2.5c3 0 5.5.9 5.5 2s-2.5 2-5.5 2-5.5-.9-5.5-2 2.5-2 5.5-2zM2.5 4.5v7c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-7M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"),
  convert: P("M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"),
  more: P("M3.5 8h.01M8 8h.01M12.5 8h.01"),
  free: P("M2.5 8h9M8.5 4.5 12 8l-3.5 3.5"),
  quote: P("M4 4.5h3v3c0 2-1 3-3 3.5M9.5 4.5h3v3c0 2-1 3-3 3.5"),
  replace: P("M3 8.5l3 3 7-7"),
  copy: P("M5.5 5.5h7v8h-7zM3.5 10.5v-8h6"),
  retry: P("M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"),
  side: P("M2.5 3h11v10h-11zM9.5 3v10"),
  discard: P("M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"),
};

type Item = { id: string; label: string; icon: string; prompt?: string; run?: () => void; danger?: boolean };

function firstCode(md: string) {
  const m = md.match(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\s*\2/);
  return m ? m[3] : null;
}

const PRIMARY = ["explain", "review", "optimize", "comment", "objects"];

export function AskPopover({ ui, agent, onReplace }: { ui: SelUI; agent: AgentCtl; onReplace?: (sel: SelInfo, code: string) => void }) {
  const a = ui.ask;
  const [q, setQ] = useState("");
  const [act, setAct] = useState(0);
  const [more, setMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const stick = useRef(true);
  const prev = useRef<{ open: boolean; busy: boolean }>({ open: false, busy: false });

  const msgs = a ? agent.msgs.slice(a.start) : [];
  const chat = msgs.length > 0;
  const last = msgs[msgs.length - 1];
  const busy = agent.running != null;

  useEffect(() => {
    setQ("");
    setAct(0);
    setMore(false);
    stick.current = true;
    if (a) window.setTimeout(() => input.current?.focus(), 0);
  }, [a?.start, a?.sel]);

  useEffect(() => {
    if (!a) return;
    if (busy) wrap.current?.focus();
    else {
      setAct(0);
      window.setTimeout(() => input.current?.focus(), 0);
    }
  }, [busy]);

  useEffect(() => {
    if (prev.current.open && !a && prev.current.busy) agent.setOpen(true);
    prev.current = { open: !!a, busy };
  }, [a, busy]);

  useLayoutEffect(() => {
    const b = body.current;
    if (b && stick.current) b.scrollTop = b.scrollHeight;
    const w = wrap.current;
    if (w) {
      const bh = body.current ? Math.min(body.current.scrollHeight, window.innerHeight * 0.46, 420) + 1 : 0;
      const ih = (w.querySelector(".ask-in") as HTMLElement | null)?.offsetHeight ?? 44;
      const lh = listEl.current ? Math.min(listEl.current.scrollHeight, 300) + 6 : 0;
      const nat = Math.round(bh + ih + lh);
      if (Math.abs(nat - h) > 2) setH(nat);
    }
  });

  useEffect(() => {
    listEl.current?.querySelector(".ask-item.on")?.scrollIntoView({ block: "nearest" });
  }, [act]);

  const cmds: Item[] = useMemo(
    () => [
      ...ACTIONS.map((x) => ({ id: x.id, label: x.label, icon: x.id, prompt: x.prompt })),
      ...CONVERT_TARGETS.map((t) => ({ id: "cv-" + t, label: `转为 ${t}`, icon: "convert", prompt: convertPrompt(t) })),
    ],
    [],
  );
  const labelOf = (text: string) => cmds.find((c) => c.prompt === text)?.label ?? text;

  if (!a) return null;

  const send = (prompt: string) => {
    if (!prompt.trim() || busy) return;
    stick.current = true;
    if (chat) agent.send(prompt, { inline: true });
    else agent.send(prompt, { sel: a.sel, inline: true });
    setQ("");
    setAct(0);
  };

  const code = !busy && last?.role === "assistant" && last.done ? firstCode(last.text) : null;
  const k = q.trim().toLowerCase();
  let items: Item[];
  if (!chat) {
    if (k) {
      items = [...cmds.filter((c) => c.label.toLowerCase().includes(k)), { id: "free", label: `提问「${q.trim()}」`, icon: "free", prompt: q.trim() }];
    } else {
      const prim = PRIMARY.map((id) => cmds.find((c) => c.id === id)!);
      items = more ? [...prim, ...cmds.filter((c) => !PRIMARY.includes(c.id))] : [...prim, { id: "more", label: "更多", icon: "more", run: () => setMore(true) }];
      items.push({
        id: "quote",
        label: "引用到侧栏",
        icon: "quote",
        run: () => {
          agent.addRef(a.sel);
          ui.closeAsk();
        },
      });
    }
  } else if (!busy && last?.done && !k) {
    const li = agent.msgs.length - 2;
    const lastQ = agent.msgs[li];
    items = [
      ...(code && onReplace
        ? [
            {
              id: "replace",
              label: "替换选中内容",
              icon: "replace",
              run: () => {
                onReplace(a.sel, code);
                ui.closeAsk();
              },
            },
          ]
        : []),
      ...(code ? [{ id: "copycode", label: "复制代码", icon: "copy", run: () => copyText(code) }] : []),
      ...(!code && last.text ? [{ id: "copy", label: "复制回答", icon: "copy", run: () => copyText(last.text) }] : []),
      {
        id: "retry",
        label: "重试",
        icon: "retry",
        run: () => {
          if (!lastQ || lastQ.role !== "user") return;
          stick.current = true;
          agent.truncate(li);
          agent.send(lastQ.text, li === a.start ? { sel: a.sel, inline: true } : { inline: true });
        },
      },
      {
        id: "side",
        label: "转到侧栏",
        icon: "side",
        run: () => {
          agent.setOpen(true);
          ui.closeAsk();
        },
      },
      {
        id: "discard",
        label: "丢弃",
        icon: "discard",
        danger: true,
        run: () => {
          agent.truncate(a.start);
          ui.closeAsk();
        },
      },
    ];
  } else items = [];

  const runItem = (it: Item) => {
    if (it.run) it.run();
    else if (it.prompt) send(it.prompt);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (busy) agent.stop();
      else ui.closeAsk();
      return;
    }
    if (e.target !== input.current) return;
    if (items.length && e.key === "ArrowDown") {
      e.preventDefault();
      setAct((i) => (i + 1) % items.length);
    } else if (items.length && e.key === "ArrowUp") {
      e.preventDefault();
      setAct((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[act]) runItem(items[act]);
      else send(q);
    }
  };

  const r = rectOf(a.sel, a.mouse);
  const W = Math.min(440, window.innerWidth - 16);
  const left = Math.max(8, Math.min(r.left - 4, window.innerWidth - W - 8));
  const H = h || 300;
  const below = window.innerHeight - r.bottom - 14;
  const above = r.top - 14;
  let top: number;
  let maxH: number | undefined;
  if (below >= H) top = r.bottom + 6;
  else if (above >= H) top = r.top - H - 6;
  else if (Math.max(below, above) >= 220) {
    maxH = Math.max(below, above);
    top = below >= above ? r.bottom + 6 : 8 + Math.max(0, above - Math.min(H, maxH));
  } else top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - H - 8));

  const thinking = busy && last?.role === "assistant";

  return (
    <div className="ask-wrap" ref={wrap} tabIndex={-1} style={{ left, top, width: W, maxHeight: maxH }} onKeyDown={onKey}>
      <div className="ask-card">
        {chat && (
          <div
            className="ask-body"
            ref={body}
            onScroll={(e) => {
              const b = e.currentTarget;
              stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 30;
            }}
          >
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ask-q">
                  {labelOf(m.text)}
                  {i === 0 && a.sel.lines && <span>{a.sel.lines}</span>}
                </div>
              ) : (
                <div key={i} className="ask-a">
                  {m.text && <Answer msg={m} />}
                  {m.error && <div className="ag-error">{m.error}</div>}
                </div>
              ),
            )}
          </div>
        )}
        <div className={`ask-in ${thinking ? "busy" : ""}`}>
          <span className="ask-spark">{ICON_SPARK}</span>
          {thinking ? (
            <span className="ask-thinking">{last?.tool ? `正在调用 ${last.tool}` : last?.text ? "AI 正在写" : "AI 正在思考"}</span>
          ) : (
            <input
              ref={input}
              value={q}
              placeholder={chat ? "继续追问…" : "让 AI 处理选中内容…"}
              onChange={(e) => {
                setQ(e.target.value);
                setAct(0);
              }}
              spellCheck={false}
            />
          )}
          {thinking ? (
            <button className="ask-stop" onClick={agent.stop} title="停止 Esc">
              停止 <kbd>Esc</kbd>
            </button>
          ) : (
            <button className="ag-send" disabled={!q.trim()} onClick={() => send(q)} title="发送 ↵">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {items.length > 0 && (
        <div className="ask-list" ref={listEl}>
          {items.map((it, i) => (
            <button
              key={it.id}
              className={`ask-item ${i === act ? "on" : ""} ${it.danger ? "danger" : ""}`}
              onMouseMove={() => i !== act && setAct(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runItem(it)}
            >
              <span className="ask-ic">{IC[it.icon]}</span>
              <span className="ask-label">{it.label}</span>
              {i === act && <kbd>↵</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

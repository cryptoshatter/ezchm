import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ACTIONS, CONVERT_TARGETS, agentApi, buildPrompt, convertPrompt, nextRunId, onAgent, type AgentInfo, type AgentMsg, type AgentRef } from "../lib/agent";
import { renderMd } from "../lib/md";
import { CODE_CSS, copyText, mountCodeBlock, type Block } from "../lib/codeblock";
import { detectLang } from "../lib/detect";
import { useSettings } from "../settings";
import { showMenu } from "./ContextMenu";
import { IconClose, IconPlus } from "./Icons";

export type SelInfo = { text: string; lang: string; lines?: string };

export function ensureCodeCss() {
  if (document.getElementById("ez-code-css")) return;
  const s = document.createElement("style");
  s.id = "ez-code-css";
  s.textContent = CODE_CSS;
  document.head.appendChild(s);
}

export function selectionInfo(shadow?: ShadowRoot | null): SelInfo | null {
  const sr = shadow as (ShadowRoot & { getSelection?: () => Selection | null }) | null | undefined;
  const sel = sr?.getSelection?.() ?? document.getSelection();
  if (!sel || sel.isCollapsed) return null;
  const text = sel.toString().replace(/ /g, " ");
  if (text.trim().length < 2) return null;
  let lang = "";
  let lines: string | undefined;
  try {
    const r = sel.getRangeAt(0);
    const el = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const a = el(r.startContainer)?.closest<HTMLElement>(".line");
    const b = el(r.endContainer)?.closest<HTMLElement>(".line");
    const code = el(r.commonAncestorContainer)?.closest<HTMLElement>(".ez-code");
    if (code?.dataset.lang) lang = code.dataset.lang;
    if (a?.dataset.ln && b?.dataset.ln) lines = a.dataset.ln === b.dataset.ln ? `第 ${a.dataset.ln} 行` : `第 ${a.dataset.ln}-${b.dataset.ln} 行`;
  } catch {
    /* none */
  }
  return { text: text.replace(/\s+$/, ""), lang: lang || detectLang(text), lines };
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

  const send = useCallback((text: string, opt: { fallback?: boolean; sel?: SelInfo | null } = {}) => {
    const t = text.trim();
    if (!t || st.current.running) return;
    let rs = st.current.refs;
    if (opt.sel) rs = [...rs.filter((r) => r.text !== opt.sel!.text), { id: refSeq++, text: opt.sel.text, lang: opt.sel.lang, lines: opt.sel.lines, source: o.current.source() }];
    if (!rs.length && opt.fallback) {
      const f = o.current.fallback();
      if (f) rs = [{ id: refSeq++, text: f.text, lang: f.lang, lines: f.lines, source: o.current.source() }];
    }
    const first = !session.current;
    const prompt = buildPrompt(t, rs, first, first ? o.current.source() : "");
    const id = nextRunId();
    setOpen(true);
    setRefs([]);
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

  return { open, setOpen, refs, addRef, removeRef, msgs, running, send, stop, reset, focusTick };
}

function Answer({ msg }: { msg: AgentMsg }) {
  const { settings, codeTheme } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const blocks = useRef<Block[]>([]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
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

export function AgentBadge({ at, onClick }: { at: { x: number; y: number } | null; onClick: () => void }) {
  if (!at) return null;
  return (
    <button
      className="ag-badge"
      style={{ left: Math.min(at.x, window.innerWidth - 90), top: Math.max(8, at.y) }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5l1.6 4.1 4.4.3-3.4 2.8 1.1 4.3L8 10.6 4.3 13l1.1-4.3L2 5.9l4.4-.3z" />
      </svg>
      Agent
    </button>
  );
}

export function useSelBadge(getShadow: () => ShadowRoot | null) {
  const [badge, setBadge] = useState<{ x: number; y: number; info: SelInfo } | null>(null);
  const onUp = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    window.setTimeout(() => {
      const info = selectionInfo(getShadow());
      setBadge(info ? { x: e.clientX + 8, y: e.clientY + 14, info } : null);
    }, 0);
  }, []);
  const hide = useCallback(() => setBadge(null), []);
  useEffect(() => {
    if (!badge) return;
    const down = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".ag-badge")) setBadge(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setBadge(null);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", hide, { passive: true });
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("wheel", hide);
    };
  }, [badge]);
  return { badge, onUp, hide };
}

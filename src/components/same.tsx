import { useCallback, useEffect, useRef, useState } from "react";
import { clearSame, highlightSame, isIdent, railPositions, selectionText, wordAtPoint, type SameHit } from "../lib/same";
import { IconClose } from "./Icons";

type St = { word: string; hits: SameHit[]; idx: number; rail: { at: number; write: boolean }[] } | null;

export function useSame(getRoot: () => HTMLElement | null, scroller: React.RefObject<HTMLDivElement | null>, getShadow: () => ShadowRoot | null, caseInsensitive: () => boolean) {
  const [st, setSt] = useState<St>(null);
  const cur = useRef<St>(null);
  cur.current = st;

  const clear = useCallback(() => {
    const r = getRoot();
    if (r) clearSame(r);
    setSt(null);
  }, []);

  const apply = useCallback((word: string, focusEl?: Node | null) => {
    const r = getRoot();
    const sc = scroller.current;
    if (!r || !sc) return;
    clearSame(r);
    const hits = highlightSame(r, word, caseInsensitive());
    if (hits.length < 2 && !hits.some((h) => h.write)) {
      clearSame(r);
      setSt(null);
      return;
    }
    let idx = 0;
    if (focusEl) {
      const i = hits.findIndex((h) => h.el.contains(focusEl) || focusEl.contains(h.el));
      if (i >= 0) idx = i;
    }
    hits[idx]?.el.classList.add("cur");
    setSt({ word, hits, idx, rail: railPositions(hits, sc) });
  }, []);

  const onClick = useCallback((e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("a[href],button,select,.ez-bar,.ez-ft,.ez-fb,.cm-editor")) return;
    const sel = selectionText(getShadow()).trim();
    let word = sel && !sel.includes("\n") ? sel : null;
    if (!word && !sel) word = wordAtPoint(e.clientX, e.clientY, getShadow(), (e.composedPath()[0] as Element) ?? t);
    if (!word || !isIdent(word)) {
      if (!sel) clear();
      return;
    }
    const c = cur.current;
    if (c && c.word.toLowerCase() === word.toLowerCase()) {
      const i = c.hits.findIndex((h) => h.el === t || h.el.contains(t));
      if (i >= 0 && i !== c.idx) {
        c.hits[c.idx]?.el.classList.remove("cur");
        c.hits[i].el.classList.add("cur");
        setSt({ ...c, idx: i });
      }
      return;
    }
    apply(word, t);
  }, []);

  const nav = useCallback((d: number) => {
    const c = cur.current;
    if (!c || !c.hits.length) return;
    c.hits[c.idx]?.el.classList.remove("cur");
    const i = (c.idx + d + c.hits.length) % c.hits.length;
    const el = c.hits[i].el;
    const hidden = el.closest(".line.ez-hidden");
    if (hidden) hidden.dispatchEvent(new CustomEvent("ez-reveal", { bubbles: true }));
    el.classList.add("cur");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setSt({ ...c, idx: i, rail: scroller.current ? railPositions(c.hits, scroller.current) : c.rail });
  }, []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!cur.current) return;
      if (e.key === "Escape") clear();
      else if (e.key === "F3" || (e.altKey && e.key === "ArrowDown")) {
        e.preventDefault();
        nav(e.shiftKey ? -1 : 1);
      } else if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        nav(-1);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return { st, onClick, nav, clear, apply };
}

export function SameOverlay({ st, nav, clear, onJump }: { st: St; nav: (d: number) => void; clear: () => void; onJump: (at: number) => void }) {
  if (!st) return null;
  const writes = st.hits.filter((h) => h.write).length;
  return (
    <>
      <div className="same-rail">
        {st.rail.map((r, i) => (
          <span key={i} className={`same-tick ${r.write ? "w" : ""}`} style={{ top: `${r.at * 100}%` }} onClick={() => onJump(r.at)} />
        ))}
      </div>
      <div className="same-pill">
        <span className="same-word">{st.word}</span>
        <span className="same-count">
          {st.idx + 1}/{st.hits.length}
          {writes > 0 && <span className="same-w"> · 赋值 {writes}</span>}
        </span>
        <button onClick={() => nav(-1)} title="上一个 ⌥↑">
          ↑
        </button>
        <button onClick={() => nav(1)} title="下一个 ⌥↓">
          ↓
        </button>
        <button onClick={clear} title="Esc">
          <IconClose size={11} />
        </button>
      </div>
    </>
  );
}

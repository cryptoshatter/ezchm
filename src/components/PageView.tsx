import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errText } from "../api";
import { CODE_CSS, hashText, mountCodeBlock, normalizeCode, toast, type Block } from "../lib/codeblock";
import { spliceText } from "../lib/agent";
import { PAGE_CSS, buildPage, findCodeBlocks, isExternal, markTerms, resolvePath } from "../lib/page";
import { useSettings } from "../settings";
import { useFinder, type Finder } from "./finder";
import { SameOverlay, useSame } from "./same";
import { wordAtPoint, isIdent } from "../lib/same";
import type { SelInfo } from "./agent";

export type PageHandle = Finder & {
  scrollRatio: () => number;
  formatAll: () => void;
  hasSql: () => boolean;
  getShadow: () => ShadowRoot | null;
  fallback: () => SelInfo | null;
  identAt: (x: number, y: number, target?: Element | null) => string | null;
  highlight: (word: string) => void;
  replaceSel: (sel: SelInfo, code: string) => void;
};

type Props = {
  bookId: string;
  item: string;
  entry: { path: string; terms: string[]; restore: number | null };
  onNavigate: (path: string) => void;
  onLoaded: (realPath: string, title: string) => void;
  onScroll: (ratio: number) => void;
  onSelUp?: (e: MouseEvent) => void;
  onCtx?: (e: MouseEvent) => void;
};

const PageView = forwardRef<PageHandle, Props>(function PageView({ bookId, item, entry, onNavigate, onLoaded, onScroll, onSelUp, onCtx }, ref) {
  const { settings, codeTheme } = useSettings();
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const shadow = useRef<ShadowRoot | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const blocks = useRef<Block[]>([]);
  const [error, setError] = useState<string | null>(null);
  const opts = useRef({ settings, codeTheme });
  opts.current = { settings, codeTheme };
  const nav = useRef(onNavigate);
  nav.current = onNavigate;
  const evs = useRef({ onSelUp, onCtx });
  evs.current = { onSelUp, onCtx };
  const current = useRef("");
  const finder = useFinder(() => content.current);
  const same = useSame(
    () => content.current,
    scroller,
    () => shadow.current,
    () => true,
  );

  useEffect(() => {
    if (!host.current || shadow.current) return;
    const sr = host.current.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PAGE_CSS + CODE_CSS;
    const box = document.createElement("div");
    sr.append(style, box);
    shadow.current = sr;
    content.current = box;
    sr.addEventListener("mouseup", (e) => evs.current.onSelUp?.(e as MouseEvent));
    sr.addEventListener("contextmenu", (e) => evs.current.onCtx?.(e as MouseEvent));
    sr.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) {
        same.onClick(e as MouseEvent);
        return;
      }
      const href = a.getAttribute("href") ?? "";
      e.preventDefault();
      if (href.startsWith("#")) {
        scrollToAnchor(href.slice(1));
        return;
      }
      if (isExternal(href)) {
        openUrl(href).catch(() => undefined);
        return;
      }
      const p = resolvePath(current.current, href);
      if (p) nav.current(p);
    });
  }, []);

  const scrollToAnchor = (name: string) => {
    const root = content.current;
    const sc = scroller.current;
    if (!root || !sc || !name) return false;
    const n = decodeURIComponent(name);
    const el = root.querySelector(`[id="${CSS.escape(n)}"], a[name="${CSS.escape(n)}"]`) as HTMLElement | null;
    if (!el) return false;
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    return true;
  };

  useEffect(() => {
    let cancelled = false;
    const box = content.current;
    if (!box) return;
    const { path, terms, restore } = entry;
    const [bare, hash] = path.split("#");
    api
      .chmPage(bookId, bare)
      .then(async (pg) => {
        if (cancelled) return;
        setError(null);
        current.current = pg.path;
        same.clear();
        blocks.current.forEach((b) => b.destroy());
        blocks.current = [];
        box.replaceChildren(buildPage(pg.html, bookId, pg.path, opts.current.settings.originalStyle));
        const page = box.querySelector(".ez-page") as HTMLElement;
        const edits = await api.edits(item, pg.path).catch(() => []);
        if (cancelled) return;
        const name = (pg.path.split("/").pop() ?? "code").replace(/\.[^.]+$/, "");
        findCodeBlocks(page).forEach((c, idx) => {
          const hash = hashText(normalizeCode(c.text));
          const saved = edits.find((e) => e.idx === idx && e.hash === hash)?.text ?? null;
          blocks.current.push(
            mountCodeBlock(c.host, c.text, {
              ...opts.current,
              edit: { saved, name: idx ? `${name}_${idx + 1}` : name, save: (t) => api.saveEdit(item, pg.path, idx, hash, t) },
            }),
          );
        });
        const title = new DOMParser().parseFromString(pg.html, "text/html").title.trim();
        onLoaded(pg.path, title);
        const sc = scroller.current!;
        sc.scrollTop = 0;
        requestAnimationFrame(() => {
          if (cancelled) return;
          if (terms.length) {
            const marks = markTerms(page, terms);
            finder.adopt(marks, terms.join(" "));
          } else if (hash && scrollToAnchor(hash)) {
            return;
          } else if (restore != null && restore > 0) {
            sc.scrollTop = restore * (sc.scrollHeight - sc.clientHeight);
          }
        });
      })
      .catch((e) => {
        if (!cancelled) setError(errText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, entry, settings.originalStyle]);

  useEffect(() => {
    blocks.current.forEach((b) => b.update({ settings, codeTheme }));
  }, [settings, codeTheme]);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const max = sc.scrollHeight - sc.clientHeight;
        onScroll(max > 0 ? sc.scrollTop / max : 0);
      }, 500);
    };
    sc.addEventListener("scroll", on);
    return () => {
      sc.removeEventListener("scroll", on);
      window.clearTimeout(t);
    };
  }, [onScroll]);

  useImperativeHandle(
    ref,
    () => ({
      ...finder,
      scrollRatio: () => {
        const sc = scroller.current;
        if (!sc) return 0;
        const max = sc.scrollHeight - sc.clientHeight;
        return max > 0 ? sc.scrollTop / max : 0;
      },
      formatAll: () => {
        const sql = blocks.current.filter((b) => b.isSql());
        const target = !sql.every((b) => b.formatted());
        sql.forEach((b) => {
          if (b.formatted() !== target) b.toggleFormat();
        });
      },
      hasSql: () => blocks.current.some((b) => b.isSql()),
      getShadow: () => shadow.current,
      fallback: () => {
        const bs = blocks.current;
        if (bs.length === 1) return { text: bs[0].text(), lang: bs[0].el.dataset.lang || "sql" };
        const t = (content.current?.innerText ?? "").trim();
        return t ? { text: t, lang: "text" } : null;
      },
      identAt: (x, y, target) => {
        const w = wordAtPoint(x, y, shadow.current, target);
        return w && isIdent(w) ? w : null;
      },
      highlight: (w) => same.apply(w),
      replaceSel: (sel, code) => {
        const b = blocks.current.find((x) => sel.codeEl && (x.el === sel.codeEl || x.el.contains(sel.codeEl)));
        if (!b) {
          toast("只能替换代码块里的内容");
          return;
        }
        const next = spliceText(b.text(), sel.text, code);
        if (next == null) toast("原文已变化，无法定位选中内容");
        else b.editWith(next);
      },
    }),
    [finder],
  );

  return (
    <>
      <div className="page-scroll" ref={scroller}>
        <div className={`page-wrap w-${settings.pageWidth}`}>
          {error && <div className="page-error">{error}</div>}
          <div ref={host} />
        </div>
      </div>
      <SameOverlay
        st={same.st}
        nav={same.nav}
        clear={same.clear}
        onJump={(at) => {
          const sc = scroller.current;
          if (sc) sc.scrollTo({ top: at * sc.scrollHeight - sc.clientHeight / 2, behavior: "smooth" });
        }}
      />
    </>
  );
});

export default PageView;

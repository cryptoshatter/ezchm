import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errText } from "../api";
import { CODE_CSS, mountCodeBlock, type Block } from "../lib/codeblock";
import { PAGE_CSS, buildPage, findCodeBlocks, isExternal, markTerms, resolvePath } from "../lib/page";
import { useSettings } from "../settings";
import { useFinder, type Finder } from "./finder";

export type PageHandle = Finder & {
  scrollRatio: () => number;
  formatAll: () => void;
  hasSql: () => boolean;
};

type Props = {
  bookId: string;
  entry: { path: string; terms: string[]; restore: number | null };
  onNavigate: (path: string) => void;
  onLoaded: (realPath: string, title: string) => void;
  onScroll: (ratio: number) => void;
};

const PageView = forwardRef<PageHandle, Props>(function PageView({ bookId, entry, onNavigate, onLoaded, onScroll }, ref) {
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
  const current = useRef("");
  const finder = useFinder(() => content.current);

  useEffect(() => {
    if (!host.current || shadow.current) return;
    const sr = host.current.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PAGE_CSS + CODE_CSS;
    const box = document.createElement("div");
    sr.append(style, box);
    shadow.current = sr;
    content.current = box;
    sr.addEventListener("click", (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
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
        blocks.current.forEach((b) => b.destroy());
        blocks.current = [];
        box.replaceChildren(buildPage(pg.html, bookId, pg.path, opts.current.settings.originalStyle));
        const page = box.querySelector(".ez-page") as HTMLElement;
        for (const c of findCodeBlocks(page)) {
          blocks.current.push(mountCodeBlock(c.host, c.text, opts.current));
        }
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
    }),
    [finder],
  );

  return (
    <div className="page-scroll" ref={scroller}>
      <div className={`page-wrap w-${settings.pageWidth}`}>
        {error && <div className="page-error">{error}</div>}
        <div ref={host} />
      </div>
    </div>
  );
});

export default PageView;

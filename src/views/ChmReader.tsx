import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errText, type BookInfo, type Bookmark, type TocNode } from "../api";
import { FindBar, Layout, Tabs, TopBar } from "../components/Shell";
import { BookmarkList, IndexList, SearchPanel, TocTree } from "../components/Panels";
import PageView, { type PageHandle } from "../components/PageView";
import { IconBack, IconBookmarks, IconForward, IconFormat, IconHome, IconIndex, IconSearch, IconStar, IconToc } from "../components/Icons";
import { toast } from "../lib/codeblock";
import { useKeys } from "../keys";

type Tab = "toc" | "index" | "search" | "bookmarks";
type Entry = { path: string; terms: string[]; restore: number | null };

function titles(nodes: TocNode[], m: Map<string, string>) {
  for (const n of nodes) {
    if (n.local) {
      const k = n.local.split("#")[0].toLowerCase();
      if (!m.has(k)) m.set(k, n.name);
    }
    titles(n.children, m);
  }
  return m;
}

export default function ChmReader({ path, onHome, onSettings }: { path: string; onHome: () => void; onSettings: () => void }) {
  const [book, setBook] = useState<BookInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<{ list: Entry[]; i: number }>({ list: [], i: -1 });
  const [tab, setTab] = useState<Tab>("toc");
  const [searchFocus, setSearchFocus] = useState(0);
  const [loaded, setLoaded] = useState<{ path: string; title: string }>({ path: "", title: "" });
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const page = useRef<PageHandle>(null);
  const cur = hist.list[hist.i];

  useEffect(() => {
    let cancel = false;
    setBook(null);
    setError(null);
    (async () => {
      try {
        const b = await api.chmOpen(path);
        const saved = await api.item(path);
        if (cancel) return;
        await api.touch(path, "chm", b.title);
        setBook(b);
        const start = saved?.page ?? b.home;
        setHist({ list: [{ path: start, terms: [], restore: saved?.page ? saved.scroll : null }], i: 0 });
        api.bookmarks(path).then(setMarks);
        getCurrentWindow().setTitle(b.title).catch(() => undefined);
      } catch (e) {
        if (!cancel) setError(errText(e));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [path]);

  const tocTitles = useMemo(() => (book ? titles(book.toc, new Map()) : new Map<string, string>()), [book]);

  const go = useCallback((p: string, terms: string[] = [], restore: number | null = null) => {
    setHist((h) => {
      const list = h.list.slice(0, h.i + 1);
      list.push({ path: p, terms, restore });
      return { list: list.slice(-200), i: Math.min(list.length, 200) - 1 };
    });
  }, []);

  const back = () => setHist((h) => (h.i > 0 ? { ...h, i: h.i - 1 } : h));
  const fwd = () => setHist((h) => (h.i < h.list.length - 1 ? { ...h, i: h.i + 1 } : h));

  const onLoaded = useCallback(
    (real: string, title: string) => {
      const t = tocTitles.get(real.toLowerCase()) || title || real.split("/").pop() || real;
      setLoaded({ path: real, title: t });
      api.progress(path, real, 0).catch(() => undefined);
    },
    [path, tocTitles],
  );

  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const onScroll = useCallback(
    (r: number) => {
      if (loadedRef.current.path) api.progress(path, loadedRef.current.path, r).catch(() => undefined);
    },
    [path],
  );

  const marked = marks.find((m) => m.page.toLowerCase() === loaded.path.toLowerCase());
  const toggleMark = async () => {
    if (!loaded.path) return;
    if (marked) {
      await api.deleteBookmark(marked.id);
    } else {
      await api.addBookmark(path, loaded.path, loaded.title, page.current?.scrollRatio() ?? 0);
      toast("已加书签");
    }
    setMarks(await api.bookmarks(path));
  };

  useKeys({
    "mod+[": back,
    "mod+]": fwd,
    "mod+d": toggleMark,
    "mod+f": () => setFindOpen(true),
    "mod+shift+f": () => {
      setTab("search");
      setSearchFocus((n) => n + 1);
    },
  });

  const sidebar = book && (
    <>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "toc", icon: <IconToc />, title: "目录" },
          { id: "index", icon: <IconIndex />, title: "索引" },
          { id: "search", icon: <IconSearch />, title: "搜索" },
          { id: "bookmarks", icon: <IconBookmarks />, title: "书签" },
        ]}
      />
      <div className="side-body">
        {tab === "toc" && <TocTree nodes={book.toc} current={loaded.path} onOpen={(p) => go(p)} />}
        {tab === "index" && <IndexList items={book.index} onOpen={(p) => go(p)} />}
        {tab === "search" && <SearchPanel bookId={book.id} onOpen={(p, t) => go(p, t)} autoFocus={searchFocus} />}
        {tab === "bookmarks" && (
          <BookmarkList
            items={marks}
            onOpen={(b) => go(b.page, [], b.scroll)}
            onDelete={async (id) => {
              await api.deleteBookmark(id);
              setMarks(await api.bookmarks(path));
            }}
          />
        )}
      </div>
    </>
  );

  return (
    <div className="app-col">
      <TopBar
        onSettings={onSettings}
        left={
          <>
            <button className="icon-btn" title="书架" onClick={onHome}>
              <IconHome />
            </button>
            <button className="icon-btn" title="后退 ⌘[" disabled={hist.i <= 0} onClick={back}>
              <IconBack />
            </button>
            <button className="icon-btn" title="前进 ⌘]" disabled={hist.i >= hist.list.length - 1} onClick={fwd}>
              <IconForward />
            </button>
          </>
        }
        center={
          <div className="tb-title" data-tauri-drag-region>
            <span className="tb-book" data-tauri-drag-region>{book?.title}</span>
            {loaded.title && loaded.title !== book?.title && <span className="tb-page" data-tauri-drag-region>{loaded.title}</span>}
          </div>
        }
        right={
          <>
            <button className="icon-btn" title="格式化本页 SQL" onClick={() => page.current?.formatAll()}>
              <IconFormat />
            </button>
            <button className={`icon-btn ${marked ? "on" : ""}`} title="书签 ⌘D" onClick={toggleMark}>
              <IconStar filled={!!marked} />
            </button>
          </>
        }
      />
      <Layout sidebar={sidebar}>
        {error && <div className="center-msg">{error}</div>}
        {book && cur && (
          <>
            <FindBar
              open={findOpen}
              onClose={() => {
                setFindOpen(false);
                page.current?.clear();
              }}
              find={(q) => page.current!.find(q)}
              next={() => page.current!.next()}
              prev={() => page.current!.prev()}
            />
            <PageView
              ref={page}
              bookId={book.id}
              entry={cur}
              onNavigate={(p) => go(p)}
              onLoaded={onLoaded}
              onScroll={onScroll}
            />
          </>
        )}
      </Layout>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, type BookInfo, type Bookmark, type TocNode } from "../api";
import { FindBar, Layout, Tabs, TopBar } from "../components/Shell";
import { BookmarkList, IndexList, SearchPanel, TocTree } from "../components/Panels";
import PageView, { type PageHandle } from "../components/PageView";
import { IconAgent, IconBack, IconBookmarks, IconForward, IconFormat, IconHome, IconIndex, IconSearch, IconStar, IconToc } from "../components/Icons";
import { copyText, toast } from "../lib/codeblock";
import { AgentBadge, AgentPanel, selectionInfo, useAgent, useSelBadge } from "../components/agent";
import { showMenu } from "../components/ContextMenu";
import { ACTIONS } from "../lib/agent";
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

export default function ChmReader({ path, initialPage, active = true, onTitle, onHome, onSettings }: { path: string; initialPage?: string; active?: boolean; onTitle?: (t: string) => void; onHome: () => void; onSettings: () => void }) {
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
        const start = initialPage ?? saved?.page ?? b.home;
        setHist({ list: [{ path: start, terms: [], restore: !initialPage && saved?.page ? saved.scroll : null }], i: 0 });
        api.bookmarks(path).then(setMarks);
        onTitle?.(b.title);
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
  const shadowOf = () => page.current?.getShadow() ?? null;
  const agent = useAgent({
    source: () => [book?.title, loadedRef.current.title].filter(Boolean).join(" / "),
    fallback: () => page.current?.fallback() ?? null,
  });
  const badge = useSelBadge(shadowOf);
  const quoteSel = () => {
    const s = selectionInfo(shadowOf());
    if (s) agent.addRef(s);
    else agent.setOpen(!agent.open);
    badge.hide();
  };

  const onCtx = useCallback(
    (e: MouseEvent) => {
      const sel = selectionInfo(shadowOf());
      const word = page.current?.identAt(e.clientX, e.clientY, e.composedPath()[0] as Element) ?? null;
      badge.hide();
      showMenu(e, [
        sel && { label: "复制", shortcut: "⌘C", action: () => copyText(sel.text) },
        sel && { label: "引用到 Agent", shortcut: "⌘L", action: () => agent.addRef(sel) },
        sel && { label: "解释选中内容", action: () => agent.send(ACTIONS[0].prompt, { sel }) },
        sel && { label: "检查选中代码", action: () => agent.send(ACTIONS[2].prompt, { sel }) },
        "sep",
        word ? { label: `高光 ${word.length > 24 ? word.slice(0, 24) + "…" : word}`, action: () => page.current?.highlight(word) } : null,
        { label: "页内查找", shortcut: "⌘F", action: () => setFindOpen(true) },
        { label: "格式化本页 SQL", action: () => page.current?.formatAll() },
        "sep",
        { label: "后退", shortcut: "⌘[", disabled: hist.i <= 0, action: back },
        { label: "前进", shortcut: "⌘]", disabled: hist.i >= hist.list.length - 1, action: fwd },
        { label: marked ? "取消书签" : "加入书签", shortcut: "⌘D", action: toggleMark },
        "sep",
        { label: "Agent 面板", shortcut: "⌘J", action: () => agent.setOpen(!agent.open) },
      ]);
    },
    [hist, agent.open, marks, loaded],
  );

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
    "mod+j": () => agent.setOpen(!agent.open),
    "mod+l": quoteSel,
    "mod+shift+f": () => {
      setTab("search");
      setSearchFocus((n) => n + 1);
    },
  }, active);

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
            <button className={`icon-btn ${agent.open ? "active" : ""}`} title="Agent ⌘J" onClick={() => agent.setOpen(!agent.open)}>
              <IconAgent />
            </button>
            <button className="icon-btn" title="格式化本页 SQL" onClick={() => page.current?.formatAll()}>
              <IconFormat />
            </button>
            <button className={`icon-btn ${marked ? "on" : ""}`} title="书签 ⌘D" onClick={toggleMark}>
              <IconStar filled={!!marked} />
            </button>
          </>
        }
      />
      <Layout sidebar={sidebar} aside={agent.open && <AgentPanel agent={agent} onSettings={onSettings} />}>
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
              item={path}
              entry={cur}
              onNavigate={(p) => go(p)}
              onLoaded={onLoaded}
              onScroll={onScroll}
              onSelUp={badge.onUp}
              onCtx={onCtx}
            />
            <AgentBadge
              at={badge.badge}
              onClick={() => {
                if (badge.badge) agent.addRef(badge.badge.info);
                badge.hide();
              }}
            />
          </>
        )}
      </Layout>
    </div>
  );
}

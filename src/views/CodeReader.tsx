import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, baseName, errText, type Bookmark, type TextFile } from "../api";
import { FindBar, Layout, Tabs, TopBar } from "../components/Shell";
import { BookmarkList, FileTree } from "../components/Panels";
import { IconBookmarks, IconFiles, IconFormat, IconHome, IconStar } from "../components/Icons";
import { CODE_CSS, mountCodeBlock, toast, type Block } from "../lib/codeblock";
import { langFromName } from "../lib/detect";
import { useSettings } from "../settings";
import { useFinder } from "../components/finder";
import { useKeys } from "../keys";

type Tab = "files" | "bookmarks";

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  const s = document.createElement("style");
  s.textContent = CODE_CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

export default function CodeReader({ path, kind, onHome, onSettings }: { path: string; kind: "file" | "folder"; onHome: () => void; onSettings: () => void }) {
  const { settings, codeTheme } = useSettings();
  const [file, setFile] = useState<string | null>(kind === "file" ? path : null);
  const [data, setData] = useState<TextFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(kind === "folder" ? "files" : "bookmarks");
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [isSql, setIsSql] = useState(false);
  const restore = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const block = useRef<Block | null>(null);
  const finder = useFinder(() => holder.current?.querySelector(".ez-body") as HTMLElement | null);

  useEffect(() => {
    injectCss();
    (async () => {
      const saved = await api.item(path);
      await api.touch(path, kind, baseName(path));
      api.bookmarks(path).then(setMarks);
      getCurrentWindow().setTitle(baseName(path)).catch(() => undefined);
      if (kind === "folder" && saved?.page) {
        restore.current = saved.scroll;
        setFile(saved.page);
      } else if (kind === "file") restore.current = saved?.scroll ?? null;
    })().catch(() => undefined);
  }, [path, kind]);

  useEffect(() => {
    if (!file) return;
    let cancel = false;
    setError(null);
    api
      .fileRead(file)
      .then((d) => {
        if (cancel) return;
        setData(d);
        if (kind === "folder") api.progress(path, file, 0).catch(() => undefined);
      })
      .catch((e) => !cancel && setError(errText(e)));
    return () => {
      cancel = true;
    };
  }, [file]);

  useEffect(() => {
    const h = holder.current;
    if (!h || !data) return;
    block.current?.destroy();
    const mount = document.createElement("div");
    h.replaceChildren(mount);
    block.current = mountCodeBlock(mount, data.text, { settings, codeTheme, full: true, lang: langFromName(data.name) ?? undefined });
    setIsSql(block.current.isSql());
    const sc = scroller.current!;
    sc.scrollTop = 0;
    const r = restore.current;
    restore.current = null;
    if (r) window.setTimeout(() => (sc.scrollTop = r * (sc.scrollHeight - sc.clientHeight)), 120);
  }, [data]);

  useEffect(() => {
    block.current?.update({ settings, codeTheme, full: true });
  }, [settings, codeTheme]);

  const ratio = () => {
    const sc = scroller.current;
    if (!sc) return 0;
    const max = sc.scrollHeight - sc.clientHeight;
    return max > 0 ? sc.scrollTop / max : 0;
  };

  const fileRef = useRef(file);
  fileRef.current = file;
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => fileRef.current && api.progress(path, fileRef.current, ratio()).catch(() => undefined), 500);
    };
    sc.addEventListener("scroll", on);
    return () => sc.removeEventListener("scroll", on);
  }, [path]);

  const openBookmark = useCallback(
    (b: Bookmark) => {
      if (b.page === file) {
        const sc = scroller.current!;
        sc.scrollTop = b.scroll * (sc.scrollHeight - sc.clientHeight);
      } else {
        restore.current = b.scroll;
        setFile(b.page);
      }
    },
    [file],
  );

  const toggleMark = async () => {
    if (!file) return;
    await api.addBookmark(path, file, `${baseName(file)} · ${Math.round(ratio() * 100)}%`, ratio());
    setMarks(await api.bookmarks(path));
    toast("已加书签");
  };

  useKeys({
    "mod+d": toggleMark,
    "mod+f": () => setFindOpen(true),
  });

  const rel = (p: string) => (kind === "folder" && p.startsWith(path) ? p.slice(path.length + 1) : baseName(p));

  const sidebar = (
    <>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          ...(kind === "folder" ? [{ id: "files" as Tab, icon: <IconFiles />, title: "文件" }] : []),
          { id: "bookmarks", icon: <IconBookmarks />, title: "书签" },
        ]}
      />
      <div className="side-body">
        {tab === "files" && kind === "folder" && <FileTree root={path} current={file ?? ""} onOpen={setFile} />}
        {tab === "bookmarks" && (
          <BookmarkList
            items={marks}
            onOpen={openBookmark}
            label={(b) => rel(b.page)}
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
          <button className="icon-btn" title="书架" onClick={onHome}>
            <IconHome />
          </button>
        }
        center={
          <div className="tb-title" data-tauri-drag-region>
            <span className="tb-book" data-tauri-drag-region>{kind === "folder" ? baseName(path) : data?.name}</span>
            {kind === "folder" && file && <span className="tb-page" data-tauri-drag-region>{rel(file)}</span>}
            {data && data.encoding !== "UTF-8" && <span className="tb-tag">{data.encoding}</span>}
          </div>
        }
        right={
          <>
            {isSql && (
              <button className="icon-btn" title="格式化 SQL" onClick={() => block.current?.toggleFormat()}>
                <IconFormat />
              </button>
            )}
            <button className="icon-btn" title="书签 ⌘D" onClick={toggleMark} disabled={!file}>
              <IconStar />
            </button>
          </>
        }
      />
      <Layout sidebar={sidebar}>
        <FindBar
          open={findOpen}
          onClose={() => {
            setFindOpen(false);
            finder.clear();
          }}
          find={finder.find}
          next={finder.next}
          prev={finder.prev}
        />
        <div className="page-scroll code-scroll" ref={scroller}>
          {error && <div className="center-msg">{error}</div>}
          <div ref={holder} className="code-holder" />
        </div>
      </Layout>
    </div>
  );
}

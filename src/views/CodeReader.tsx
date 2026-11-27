import { useCallback, useEffect, useRef, useState } from "react";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { createEditor, type Editor } from "../lib/editor";
import { detectDialect } from "../lib/detect";
import { api, baseName, errText, type Bookmark, type TextFile } from "../api";
import { FindBar, Layout, Tabs, TopBar } from "../components/Shell";
import { BookmarkList, FileTree } from "../components/Panels";
import { IconAgent, IconBookmarks, IconEdit, IconFiles, IconFormat, IconHome, IconStar } from "../components/Icons";
import { copyText, mountCodeBlock, toast, type Block } from "../lib/codeblock";
import { AgentBadge, AgentPanel, ensureCodeCss, selectionInfo, useAgent, useSelBadge } from "../components/agent";
import { showMenu } from "../components/ContextMenu";
import { ACTIONS } from "../lib/agent";
import { isIdent, wordAtPoint } from "../lib/same";
import { langFromName } from "../lib/detect";
import { useSettings } from "../settings";
import { useFinder } from "../components/finder";
import { useKeys } from "../keys";
import { SameOverlay, useSame } from "../components/same";

type Tab = "files" | "bookmarks";


export default function CodeReader({ path, kind, onHome, onSettings, active = true }: { path: string; kind: "file" | "folder"; onHome: () => void; onSettings: () => void; active?: boolean }) {
  const { settings, codeTheme, dark } = useSettings();
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editor = useRef<Editor | null>(null);
  const editHost = useRef<HTMLDivElement>(null);
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
  const dataRef = useRef(data);
  dataRef.current = data;
  const same = useSame(
    () => holder.current?.querySelector(".ez-body") as HTMLElement | null,
    scroller,
    () => null,
    () => {
      const l = dataRef.current ? langFromName(dataRef.current.name) : null;
      return !l || l === "sql" || l === "text" || l === "vb" || l === "bat";
    },
  );
  useEffect(() => {
    const h = holder.current;
    if (!h) return;
    const on = (e: MouseEvent) => same.onClick(e);
    h.addEventListener("click", on);
    return () => h.removeEventListener("click", on);
  }, []);

  const agent = useAgent({
    source: () => (dataRef.current ? (kind === "folder" ? `${baseName(path)} / ${dataRef.current.name}` : dataRef.current.name) : baseName(path)),
    fallback: () => (dataRef.current ? { text: block.current?.text() ?? dataRef.current.text, lang: langFromName(dataRef.current.name) ?? "text" } : null),
  });
  const badge = useSelBadge(() => null);
  const quoteSel = () => {
    const s = selectionInfo();
    if (s) agent.addRef(s);
    else agent.setOpen(!agent.open);
    badge.hide();
  };

  useEffect(() => {
    ensureCodeCss();
    (async () => {
      const saved = await api.item(path);
      await api.touch(path, kind, baseName(path));
      api.bookmarks(path).then(setMarks);
      if (kind === "folder" && saved?.page) {
        restore.current = saved.scroll;
        setFile(saved.page);
      } else if (kind === "file") restore.current = saved?.scroll ?? null;
    })().catch(() => undefined);
  }, [path, kind]);

  const confirmDiscard = async () => {
    if (!dirty) return true;
    return ask("有未保存的修改，确定放弃吗？", { title: "Ezchm", kind: "warning", okLabel: "放弃修改", cancelLabel: "取消" });
  };

  const switchFile = async (p: string) => {
    if (p === file) return;
    if (!(await confirmDiscard())) return;
    setEditing(false);
    setDirty(false);
    setFile(p);
  };

  const saveFile = async (as = false) => {
    if (!editor.current || !data) return;
    const text = editor.current.text();
    let target = data.path;
    if (as) {
      const p = await save({ defaultPath: data.path });
      if (!p) return;
      target = p;
    }
    try {
      await api.fileWrite(target, text, data.encoding);
      if (target === data.path) {
        setData({ ...data, text, size: text.length });
        setDirty(false);
        editor.current.destroy();
        editor.current = mountEditor(text);
      }
      toast(as ? "已另存" : "已保存");
    } catch (e) {
      toast(errText(e));
    }
  };
  const saveRef = useRef(saveFile);
  saveRef.current = saveFile;

  const mountEditor = (text: string) => {
    const host = editHost.current!;
    host.replaceChildren();
    const lang = langFromName(data!.name) ?? "text";
    return createEditor(host, {
      text,
      lang,
      dialect: settings.dialect !== "auto" ? settings.dialect : (detectDialect(text) ?? settings.fallbackDialect),
      dark,
      wrap: settings.wrap,
      onChange: setDirty,
      onSave: () => saveRef.current(),
      onQuote: () => quoteRef.current(),
    });
  };

  const toggleEdit = async () => {
    if (!data) return;
    if (editing) {
      if (!(await confirmDiscard())) return;
      setDirty(false);
      setEditing(false);
    } else setEditing(true);
  };

  useEffect(() => {
    if (!editing || !data) {
      editor.current?.destroy();
      editor.current = null;
      return;
    }
    editor.current = mountEditor(data.text);
    editor.current.focus();
    return () => {
      editor.current?.destroy();
      editor.current = null;
    };
  }, [editing, data?.path]);

  useEffect(() => {
    editor.current?.setDark(dark);
  }, [dark]);

  useEffect(() => {
    editor.current?.setWrap(settings.wrap);
  }, [settings.wrap]);

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
    same.clear();
    const mount = document.createElement("div");
    h.replaceChildren(mount);
    block.current = mountCodeBlock(mount, data.text, { settings, codeTheme, full: true, lang: langFromName(data.name) ?? undefined, onEdit: () => setEditing(true) });
    setIsSql(block.current.isSql());
    const sc = scroller.current!;
    sc.scrollTop = 0;
    const r = restore.current;
    restore.current = null;
    if (r) window.setTimeout(() => (sc.scrollTop = r * (sc.scrollHeight - sc.clientHeight)), 120);
  }, [data]);

  useEffect(() => {
    block.current?.update({ settings, codeTheme, full: true, onEdit: () => setEditing(true) });
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

  useKeys(
    {
      "mod+d": toggleMark,
      "mod+f": () => !editing && setFindOpen(true),
      "mod+e": toggleEdit,
      "mod+j": () => agent.setOpen(!agent.open),
      "mod+l": () => quoteRef.current(),
    },
    active,
  );
  const quoteRef = useRef(() => {});
  quoteRef.current = () => {
        const v = editor.current?.view;
        if (editing && v) {
          const r = v.state.selection.main;
          const t = r.empty ? "" : v.state.sliceDoc(r.from, r.to);
          if (t.trim()) {
            const a = v.state.doc.lineAt(r.from).number;
            const b = v.state.doc.lineAt(r.to).number;
            agent.addRef({ text: t, lang: langFromName(data?.name ?? "") ?? "text", lines: a === b ? `第 ${a} 行` : `第 ${a}-${b} 行` });
          } else agent.setOpen(!agent.open);
        } else quoteSel();
  };
  useKeys(
    {
      "mod+s": () => editing && saveFile(),
      "mod+shift+s": () => editing && saveFile(true),
    },
    active,
  );

  const onCtx = (e: React.MouseEvent) => {
    const sel = selectionInfo();
    const w = wordAtPoint(e.clientX, e.clientY, null, e.target as Element);
    const word = w && isIdent(w) ? w : null;
    badge.hide();
    showMenu(e, [
      sel && { label: "复制", shortcut: "⌘C", action: () => copyText(sel.text) },
      sel && { label: "引用到 Agent", shortcut: "⌘L", action: () => agent.addRef(sel) },
      sel && { label: "解释选中内容", action: () => agent.send(ACTIONS[0].prompt, { sel }) },
      sel && { label: "检查选中代码", action: () => agent.send(ACTIONS[2].prompt, { sel }) },
      "sep",
      word ? { label: `高光 ${word.length > 24 ? word.slice(0, 24) + "…" : word}`, action: () => same.apply(word) } : null,
      { label: "查找", shortcut: "⌘F", action: () => setFindOpen(true) },
      isSql ? { label: "格式化 SQL", action: () => block.current?.toggleFormat() } : null,
      { label: "编辑", shortcut: "⌘E", action: toggleEdit },
      { label: "复制全部", action: () => copyText(block.current?.text() ?? data?.text ?? "") },
      "sep",
      { label: "加入书签", shortcut: "⌘D", action: toggleMark },
      { label: "Agent 面板", shortcut: "⌘J", action: () => agent.setOpen(!agent.open) },
    ]);
  };

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
        {tab === "files" && kind === "folder" && <FileTree root={path} current={file ?? ""} onOpen={switchFile} />}
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
            {dirty && <span className="tb-dirty" title="未保存">●</span>}
          </div>
        }
        right={
          <>
            {data && (
              <button className={`icon-btn ${editing ? "active" : ""}`} title={editing ? "退出编辑 ⌘E" : "编辑 ⌘E"} onClick={toggleEdit}>
                <IconEdit />
              </button>
            )}
            <button className={`icon-btn ${agent.open ? "active" : ""}`} title="Agent ⌘J" onClick={() => agent.setOpen(!agent.open)}>
              <IconAgent />
            </button>
            {isSql && !editing && (
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
      <Layout sidebar={sidebar} aside={agent.open && <AgentPanel agent={agent} onSettings={onSettings} />}>
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
        <div
          className="page-scroll code-scroll"
          ref={scroller}
          style={{ display: editing ? "none" : undefined }}
          onMouseUp={(e) => badge.onUp(e.nativeEvent)}
          onContextMenu={onCtx}
        >
          {error && <div className="center-msg">{error}</div>}
          <div ref={holder} className="code-holder" />
        </div>
        {!editing && (
          <SameOverlay
            st={same.st}
            nav={same.nav}
            clear={same.clear}
            onJump={(at) => {
              const sc = scroller.current;
              if (sc) sc.scrollTo({ top: at * sc.scrollHeight - sc.clientHeight / 2, behavior: "smooth" });
            }}
          />
        )}
        {!editing && (
          <AgentBadge
            at={badge.badge}
            onClick={() => {
              if (badge.badge) agent.addRef(badge.badge.info);
              badge.hide();
            }}
          />
        )}
        <div className="edit-host" ref={editHost} style={{ display: editing ? undefined : "none" }} />
      </Layout>
    </div>
  );
}

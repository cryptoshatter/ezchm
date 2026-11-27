import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, baseName, errText } from "./api";
import { TabsCtx, type Tab, type View } from "./tabs";
import ContextMenu from "./components/ContextMenu";
import { SettingsProvider, useSettings } from "./settings";
import Library from "./views/Library";
import ChmReader from "./views/ChmReader";
import CodeReader from "./views/CodeReader";
import SettingsDialog from "./components/SettingsDialog";
import Updater from "./components/Updater";
import { Toast } from "./components/Shell";
import { toast } from "./lib/codeblock";
import { useKeys } from "./keys";

const CODE_EXT = ["sql", "prc", "pck", "pkb", "pks", "fnc", "trg", "txt", "cs", "java", "js", "ts", "py", "c", "h", "cpp", "go", "rs", "php", "vb", "ps1", "sh", "bat", "xml", "json", "yml", "yaml", "ini", "md", "log", "html", "css"];

let nextId = 1;
const mk = (view: View): Tab => ({ id: nextId++, view, title: view.kind === "library" ? "书架" : baseName(view.path) });

function restore(raw: string | undefined): { tabs: Tab[]; active: number } {
  try {
    const saved = JSON.parse(raw ?? "") as { views: View[]; active: number };
    const tabs = saved.views.filter((v) => v && v.kind).map(mk);
    if (tabs.length) return { tabs, active: tabs[Math.min(Math.max(saved.active, 0), tabs.length - 1)].id };
  } catch {
    /* fresh */
  }
  const t = mk({ kind: "library" });
  return { tabs: [t], active: t.id };
}

function Main({ initialTabs }: { initialTabs: string | undefined }) {
  const [state, setState] = useState(() => restore(initialTabs));
  const [showSettings, setShowSettings] = useState(false);
  const { settings, set } = useSettings();
  const { tabs, active } = state;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const views = tabs.map((t) => t.view);
    const idx = tabs.findIndex((t) => t.id === active);
    api.setSetting("tabs", JSON.stringify({ views, active: idx })).catch(() => undefined);
    const t = tabs.find((x) => x.id === active);
    getCurrentWindow().setTitle(t ? t.title : "Ezchm").catch(() => undefined);
  }, [tabs, active]);

  const setView = useCallback((id: number, view: View) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...mk(view), id: t.id } : t)) }));
  }, []);

  const place = useCallback((view: View, forceNew = false) => {
    setState((s) => {
      if (view.kind !== "library") {
        const same = s.tabs.find((t) => t.view.kind === view.kind && "path" in t.view && t.view.path === view.path && !(view.kind === "chm" && view.page));
        if (same) return { ...s, active: same.id };
      }
      const cur = s.tabs.find((t) => t.id === s.active);
      if (!forceNew && cur && cur.view.kind === "library") {
        const t = { ...mk(view), id: cur.id };
        return { ...s, tabs: s.tabs.map((x) => (x.id === cur.id ? t : x)) };
      }
      const t = mk(view);
      const i = s.tabs.findIndex((x) => x.id === s.active);
      const tabs2 = [...s.tabs];
      tabs2.splice(i + 1, 0, t);
      return { tabs: tabs2, active: t.id };
    });
  }, []);

  const openPath = useCallback(
    async (path: string, forceNew = false) => {
      try {
        const kind = await api.pathKind(path);
        if (kind === "missing") {
          toast("文件不存在");
          return;
        }
        place({ kind, path }, forceNew);
      } catch (e) {
        toast(errText(e));
      }
    },
    [place],
  );

  const openChm = async () => {
    const p = await open({ multiple: false, filters: [{ name: "CHM", extensions: ["chm"] }] });
    if (typeof p === "string") openPath(p);
  };
  const openFile = async () => {
    const p = await open({ multiple: false, filters: [{ name: "代码", extensions: CODE_EXT }, { name: "全部", extensions: ["*"] }] });
    if (typeof p === "string") place({ kind: "file", path: p });
  };
  const openFolder = async () => {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") place({ kind: "folder", path: p });
  };

  useEffect(() => {
    const take = () =>
      api.takeOpened().then((ps) => {
        ps.forEach((p) => openPath(p));
      });
    take();
    const un1 = listen("ezchm-opened", take);
    const un2 = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") e.payload.paths.forEach((p) => openPath(p));
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [openPath]);

  const close = useCallback((id: number) => {
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return s;
      const rest = s.tabs.filter((t) => t.id !== id);
      if (!rest.length) {
        const t = mk({ kind: "library" });
        return { tabs: [t], active: t.id };
      }
      const act = s.active === id ? rest[Math.min(i, rest.length - 1)].id : s.active;
      return { tabs: rest, active: act };
    });
  }, []);
  const add = useCallback(() => {
    const t = mk({ kind: "library" });
    setState((s) => ({ tabs: [...s.tabs, t], active: t.id }));
  }, []);
  const select = useCallback((id: number) => setState((s) => ({ ...s, active: id })), []);
  const cycle = (d: number) =>
    setState((s) => {
      const i = s.tabs.findIndex((t) => t.id === s.active);
      return { ...s, active: s.tabs[(i + d + s.tabs.length) % s.tabs.length].id };
    });

  const setTitle = useCallback((id: number, title: string) => {
    setState((s) => (s.tabs.some((t) => t.id === id && t.title !== title) ? { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) } : s));
  }, []);

  const keys: Record<string, () => void> = {
    "mod+o": openChm,
    "mod+shift+o": openFolder,
    "mod+t": add,
    "mod+w": () => close(stateRef.current.active),
    "ctrl+tab": () => cycle(1),
    "ctrl+shift+tab": () => cycle(-1),
    "mod+shift+]": () => cycle(1),
    "mod+shift+[": () => cycle(-1),
    "mod+,": () => setShowSettings(true),
    "mod+\\": () => set("sidebarOpen", !settings.sidebarOpen),
    "mod+=": () => set("fontSize", Math.min(26, settings.fontSize + 1)),
    "mod+-": () => set("fontSize", Math.max(11, settings.fontSize - 1)),
    "mod+shift+=": () => set("codeFontSize", Math.min(24, settings.codeFontSize + 1)),
    "mod+shift+-": () => set("codeFontSize", Math.max(10, settings.codeFontSize - 1)),
  };
  for (let n = 1; n <= 9; n++) keys[`mod+${n}`] = () => setState((s) => ({ ...s, active: (n === 9 ? s.tabs[s.tabs.length - 1] : s.tabs[n - 1] ?? s.tabs[s.tabs.length - 1]).id }));
  useKeys(keys);

  const openSettings = () => setShowSettings(true);
  const ctx = useMemo(() => ({ tabs, active, select, close, add, openInNewTab: (v: View) => place(v, true) }), [tabs, active, select, close, add, place]);

  return (
    <TabsCtx.Provider value={ctx}>
      {tabs.map((t) => {
        const on = t.id === active;
        const home = () => setView(t.id, { kind: "library" });
        const v = t.view;
        return (
          <div key={t.id} className="tab-pane" style={{ display: on ? undefined : "none" }}>
            {v.kind === "library" && (
              <Library active={on} onOpen={(p, nt) => openPath(p, nt)} onOpenChm={openChm} onOpenFile={openFile} onOpenFolder={openFolder} onSettings={openSettings} />
            )}
            {v.kind === "chm" && (
              <ChmReader key={v.path} path={v.path} initialPage={v.page} active={on} onTitle={(title) => setTitle(t.id, title)} onHome={home} onSettings={openSettings} />
            )}
            {(v.kind === "file" || v.kind === "folder") && (
              <CodeReader key={v.path} path={v.path} kind={v.kind} active={on} onHome={home} onSettings={openSettings} />
            )}
          </div>
        );
      })}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      <Updater />
      <Toast />
      <ContextMenu />
    </TabsCtx.Provider>
  );
}

function Boot() {
  const [tabs, setTabs] = useState<string | undefined | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((s) => setTabs(s.tabs ?? undefined))
      .catch(() => setTabs(undefined));
  }, []);
  if (tabs === null) return null;
  return <Main initialTabs={tabs} />;
}

export default function App() {
  const [fatal, setFatal] = useState<string | null>(null);
  useEffect(() => {
    api.startupError().then(setFatal).catch(() => undefined);
  }, []);
  if (fatal) {
    return (
      <div className="fatal" data-tauri-drag-region>
        <h2>数据无法加载</h2>
        <p>{fatal}</p>
      </div>
    );
  }
  return (
    <SettingsProvider>
      <Boot />
    </SettingsProvider>
  );
}

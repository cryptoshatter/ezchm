import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, errText } from "./api";
import { SettingsProvider, useSettings } from "./settings";
import Library from "./views/Library";
import ChmReader from "./views/ChmReader";
import CodeReader from "./views/CodeReader";
import SettingsDialog from "./components/SettingsDialog";
import Updater from "./components/Updater";
import { Toast } from "./components/Shell";
import { toast } from "./lib/codeblock";
import { useKeys } from "./keys";

type View = { kind: "library" } | { kind: "chm"; path: string; n: number } | { kind: "file" | "folder"; path: string; n: number };

const CODE_EXT = ["sql", "prc", "pck", "pkb", "pks", "fnc", "trg", "txt", "cs", "java", "js", "ts", "py", "c", "h", "cpp", "go", "rs", "php", "vb", "ps1", "sh", "bat", "xml", "json", "yml", "yaml", "ini", "md", "log", "html", "css"];

function Main() {
  const [view, setView] = useState<View>({ kind: "library" });
  const [showSettings, setShowSettings] = useState(false);
  const { settings, set } = useSettings();

  const openPath = useCallback(async (path: string) => {
    try {
      const kind = await api.pathKind(path);
      if (kind === "missing") {
        toast("文件不存在");
        return;
      }
      setView({ kind, path, n: Date.now() });
    } catch (e) {
      toast(errText(e));
    }
  }, []);

  const openChm = async () => {
    const p = await open({ multiple: false, filters: [{ name: "CHM", extensions: ["chm"] }] });
    if (typeof p === "string") openPath(p);
  };
  const openFile = async () => {
    const p = await open({ multiple: false, filters: [{ name: "代码", extensions: CODE_EXT }, { name: "全部", extensions: ["*"] }] });
    if (typeof p === "string") setView({ kind: "file", path: p, n: Date.now() });
  };
  const openFolder = async () => {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") setView({ kind: "folder", path: p, n: Date.now() });
  };

  useEffect(() => {
    const take = () => api.takeOpened().then((ps) => {
      if (ps.length) openPath(ps[ps.length - 1]);
    });
    take();
    const un1 = listen("ezchm-opened", take);
    const un2 = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) openPath(e.payload.paths[0]);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [openPath]);

  useKeys({
    "mod+o": openChm,
    "mod+shift+o": openFolder,
    "mod+,": () => setShowSettings(true),
    "mod+\\": () => set("sidebarOpen", !settings.sidebarOpen),
    "mod+=": () => set("fontSize", Math.min(26, settings.fontSize + 1)),
    "mod+-": () => set("fontSize", Math.max(11, settings.fontSize - 1)),
    "mod+shift+=": () => set("codeFontSize", Math.min(24, settings.codeFontSize + 1)),
    "mod+shift+-": () => set("codeFontSize", Math.max(10, settings.codeFontSize - 1)),
  });

  const home = () => setView({ kind: "library" });
  const openSettings = () => setShowSettings(true);

  return (
    <>
      {view.kind === "library" && <Library onOpen={openPath} onOpenChm={openChm} onOpenFile={openFile} onOpenFolder={openFolder} onSettings={openSettings} />}
      {view.kind === "chm" && <ChmReader key={view.n} path={view.path} onHome={home} onSettings={openSettings} />}
      {(view.kind === "file" || view.kind === "folder") && <CodeReader key={view.n} path={view.path} kind={view.kind} onHome={home} onSettings={openSettings} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      <Updater />
      <Toast />
    </>
  );
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
      <Main />
    </SettingsProvider>
  );
}

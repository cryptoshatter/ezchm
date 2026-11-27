import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Item } from "../api";
import { TopBar } from "../components/Shell";
import { IconBook, IconClose, IconFile, IconFolder } from "../components/Icons";

function when(s: string) {
  const d = new Date(s);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (d.toDateString() === now.toDateString()) return `今天 ${s.slice(11, 16)}`;
  if (diff < 86400 * 7) return `${Math.max(1, Math.floor(diff / 86400))} 天前`;
  return s.slice(0, 10);
}

export default function Library({
  onOpen,
  onOpenChm,
  onOpenFile,
  onOpenFolder,
  onSettings,
}: {
  onOpen: (path: string) => void;
  onOpenChm: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSettings: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    api.items().then(setItems).catch(() => setItems([]));
    getCurrentWindow().setTitle("Ezchm").catch(() => undefined);
  }, []);

  const books = items?.filter((i) => i.kind === "chm") ?? [];
  const code = items?.filter((i) => i.kind !== "chm") ?? [];

  const remove = async (p: string) => {
    await api.removeItem(p);
    setItems(await api.items());
  };

  const Row = ({ it }: { it: Item }) => (
    <div className="lib-item" onClick={() => onOpen(it.path)} title={it.path}>
      <div className={`lib-icon k-${it.kind}`}>{it.kind === "chm" ? <IconBook /> : it.kind === "folder" ? <IconFolder /> : <IconFile />}</div>
      <div className="lib-main">
        <div className="lib-title">{it.title}</div>
        <div className="lib-path">{it.path}</div>
      </div>
      <div className="lib-meta">
        {it.kind === "chm" && it.page && <div className="lib-bar"><span style={{ width: `${Math.round(it.scroll * 100)}%` }} /></div>}
        <span>{when(it.opened_at)}</span>
      </div>
      <button
        className="icon-btn sm lib-del"
        title="从列表移除"
        onClick={(e) => {
          e.stopPropagation();
          remove(it.path);
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  );

  return (
    <div className="app-col">
      <TopBar onSettings={onSettings} center={<div className="tb-title" data-tauri-drag-region><span className="tb-book" data-tauri-drag-region>Ezchm</span></div>} />
      <div className="library">
        <div className="lib-inner">
          <div className="lib-actions">
            <button className="big-btn primary" onClick={onOpenChm}>
              <IconBook />
              <span>打开 CHM</span>
              <kbd>⌘O</kbd>
            </button>
            <button className="big-btn" onClick={onOpenFile}>
              <IconFile />
              <span>打开代码文件</span>
            </button>
            <button className="big-btn" onClick={onOpenFolder}>
              <IconFolder />
              <span>打开文件夹</span>
            </button>
          </div>
          {books.length > 0 && (
            <section>
              <h3>书架</h3>
              {books.map((it) => (
                <Row key={it.path} it={it} />
              ))}
            </section>
          )}
          {code.length > 0 && (
            <section>
              <h3>代码</h3>
              {code.map((it) => (
                <Row key={it.path} it={it} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

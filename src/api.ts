import { invoke } from "@tauri-apps/api/core";

export type TocNode = { name: string; local: string | null; children: TocNode[] };
export type IndexItem = { name: string; local: string | null; depth: number };
export type BookInfo = { id: string; path: string; title: string; home: string; toc: TocNode[]; index: IndexItem[] };
export type Page = { path: string; html: string };
export type SearchHit = { path: string; title: string; snippet: string; score: number };
export type Item = { path: string; kind: "chm" | "file" | "folder"; title: string; opened_at: string; page: string | null; scroll: number };
export type Bookmark = { id: number; item: string; page: string; title: string; scroll: number; created_at: string };
export type TextFile = { path: string; name: string; text: string; encoding: string; size: number };
export type DirEntry = { name: string; path: string; dir: boolean };
export type CodeEdit = { idx: number; hash: string; text: string; updated_at: string };
export type AppInfo = { version: string; data_dir: string };

export const api = {
  startupError: () => invoke<string | null>("startup_error"),
  appInfo: () => invoke<AppInfo>("app_info"),
  settings: () => invoke<Record<string, string>>("settings_all"),
  setSetting: (key: string, value: string) => invoke<void>("setting_set", { key, value }),
  items: () => invoke<Item[]>("items_list"),
  item: (path: string) => invoke<Item | null>("item_get", { path }),
  touch: (path: string, kind: string, title: string) => invoke<void>("item_touch", { path, kind, title }),
  progress: (path: string, page: string, scroll: number) => invoke<void>("item_progress", { path, page, scroll }),
  removeItem: (path: string) => invoke<void>("item_remove", { path }),
  bookmarks: (item: string) => invoke<Bookmark[]>("bookmarks_list", { item }),
  addBookmark: (item: string, page: string, title: string, scroll: number) =>
    invoke<number>("bookmark_add", { item, page, title, scroll }),
  deleteBookmark: (id: number) => invoke<void>("bookmark_delete", { id }),
  chmOpen: (path: string) => invoke<BookInfo>("chm_open", { path }),
  chmPage: (id: string, path: string) => invoke<Page>("chm_page", { id, path }),
  chmSearch: (id: string, query: string) => invoke<SearchHit[]>("chm_search", { id, query }),
  chmClose: (id: string) => invoke<void>("chm_close", { id }),
  fileRead: (path: string) => invoke<TextFile>("file_read", { path }),
  fileWrite: (path: string, text: string, encoding: string) => invoke<void>("file_write", { path, text, encoding }),
  edits: (item: string, page: string) => invoke<CodeEdit[]>("edits_list", { item, page }),
  saveEdit: (item: string, page: string, idx: number, hash: string, text: string | null) => invoke<void>("edit_save", { item, page, idx, hash, text }),
  dirList: (path: string) => invoke<DirEntry[]>("dir_list", { path }),
  pathKind: (path: string) => invoke<"chm" | "file" | "folder" | "missing">("path_kind", { path }),
  takeOpened: () => invoke<string[]>("take_opened"),
};

export function errText(e: unknown) {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function chmUrl(id: string, path: string) {
  return `chm://localhost/${id}` + path.split("/").map(encodeURIComponent).join("/");
}

export function baseName(p: string) {
  const s = p.replace(/[/\\]+$/, "");
  return s.slice(Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\")) + 1);
}

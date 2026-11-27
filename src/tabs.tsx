import { createContext, useContext } from "react";
import { IconClose, IconPlus } from "./components/Icons";

export type View = { kind: "library" } | { kind: "chm"; path: string; page?: string } | { kind: "file" | "folder"; path: string };
export type Tab = { id: number; view: View; title: string };

type Ctx = {
  tabs: Tab[];
  active: number;
  select: (id: number) => void;
  close: (id: number) => void;
  add: () => void;
  openInNewTab: (v: View) => void;
};

export const TabsCtx = createContext<Ctx | null>(null);

export function useTabs() {
  const c = useContext(TabsCtx);
  if (!c) throw new Error("no tabs");
  return c;
}

export function TabStrip() {
  const { tabs, active, select, close, add } = useTabs();
  if (tabs.length < 2) return null;
  return (
    <div className="tabstrip">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${t.id === active ? "on" : ""}`}
          title={t.view.kind === "library" ? "书架" : t.view.path}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              close(t.id);
            }
          }}
          onClick={() => select(t.id)}
        >
          <span className="tab-title">{t.title}</span>
          <button
            className="tab-x"
            onClick={(e) => {
              e.stopPropagation();
              close(t.id);
            }}
          >
            <IconClose size={11} />
          </button>
        </div>
      ))}
      <button className="tab-add" title="新标签页 ⌘T" onClick={add}>
        <IconPlus />
      </button>
    </div>
  );
}

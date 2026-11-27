import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconClose, IconMoon, IconSettings, IconSidebar, IconSun } from "./Icons";
import { useSettings } from "../settings";
import type { FindState } from "./finder";

export function TopBar({ left, center, right, onSettings }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; onSettings: () => void }) {
  const { settings, set, dark } = useSettings();
  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="tb-left">
        <button className="icon-btn" title="侧栏 ⌘\" onClick={() => set("sidebarOpen", !settings.sidebarOpen)}>
          <IconSidebar />
        </button>
        {left}
      </div>
      <div className="tb-center" data-tauri-drag-region>
        {center}
      </div>
      <div className="tb-right">
        {right}
        <button className="icon-btn" title={dark ? "浅色" : "深色"} onClick={() => set("theme", dark ? "light" : "dark")}>
          {dark ? <IconSun /> : <IconMoon />}
        </button>
        <button className="icon-btn" title="设置 ⌘," onClick={onSettings}>
          <IconSettings />
        </button>
      </div>
    </div>
  );
}

export function Layout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const { settings, set } = useSettings();
  const [width, setWidth] = useState(settings.sidebarWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => setWidth(settings.sidebarWidth), [settings.sidebarWidth]);

  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, w: width };
    let last = width;
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      last = Math.min(560, Math.max(200, drag.current.w + ev.clientX - drag.current.x));
      setWidth(last);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      set("sidebarWidth", last);
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="layout">
      {settings.sidebarOpen && (
        <aside className="sidebar" style={{ width }}>
          {sidebar}
          <div className="resizer" onMouseDown={onDown} />
        </aside>
      )}
      <main className="main">{children}</main>
    </div>
  );
}

export function Tabs<T extends string>({ value, items, onChange }: { value: T; items: { id: T; icon: ReactNode; title: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="side-tabs">
      {items.map((it) => (
        <button key={it.id} className={`side-tab ${value === it.id ? "on" : ""}`} title={it.title} onClick={() => onChange(it.id)}>
          {it.icon}
          <span>{it.title}</span>
        </button>
      ))}
    </div>
  );
}

export function FindBar({ open, onClose, find, next, prev }: { open: boolean; onClose: () => void; find: (q: string) => FindState; next: () => FindState; prev: () => FindState }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<FindState>({ count: 0, index: -1 });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setSt(find(q)), 150);
    return () => window.clearTimeout(t);
  }, [q, open]);

  if (!open) return null;
  return (
    <div className="findbar">
      <input
        ref={input}
        value={q}
        placeholder="页内查找"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setSt(e.shiftKey ? prev() : next());
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="find-count">{q ? (st.count ? `${st.index + 1}/${st.count}` : "0") : ""}</span>
      <button className="icon-btn sm" onClick={() => setSt(prev())}>
        ↑
      </button>
      <button className="icon-btn sm" onClick={() => setSt(next())}>
        ↓
      </button>
      <button className="icon-btn sm" onClick={onClose}>
        <IconClose />
      </button>
    </div>
  );
}

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      window.clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 1800);
    };
    window.addEventListener("ez-toast", on);
    return () => window.removeEventListener("ez-toast", on);
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
}

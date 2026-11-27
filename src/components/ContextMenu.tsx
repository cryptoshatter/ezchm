import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = { label: string; action: () => void; shortcut?: string; disabled?: boolean; danger?: boolean } | "sep" | null | false | undefined;

type State = { x: number; y: number; items: MenuItem[] } | null;

export function showMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation?.();
  window.dispatchEvent(new CustomEvent("ez-menu", { detail: { x: e.clientX, y: e.clientY, items } }));
}

export default function ContextMenu() {
  const [st, setSt] = useState<State>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (e: Event) => setSt((e as CustomEvent<State>).detail);
    const close = () => setSt(null);
    const native = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,.cm-editor")) return;
      e.preventDefault();
    };
    window.addEventListener("ez-menu", on);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("contextmenu", native);
    return () => {
      window.removeEventListener("ez-menu", on);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("contextmenu", native);
    };
  }, []);

  useLayoutEffect(() => {
    if (!st || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const x = Math.min(st.x, window.innerWidth - r.width - 6);
    const y = st.y + r.height > window.innerHeight - 6 ? Math.max(6, st.y - r.height) : st.y;
    setPos({ x: Math.max(6, x), y });
  }, [st]);

  useEffect(() => {
    if (!st) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setSt(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setSt(null);
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", down, true);
      window.addEventListener("keydown", key, true);
      window.addEventListener("wheel", down as never, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", down as never, true);
    };
  }, [st]);

  if (!st) return null;
  const items = st.items.filter(Boolean) as Exclude<MenuItem, null | false | undefined>[];
  const clean = items.filter((it, i) => it !== "sep" || (i > 0 && i < items.length - 1 && items[i - 1] !== "sep"));
  return (
    <div className="ctx" ref={box} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {clean.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item ${it.danger ? "danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              setSt(null);
              it.action();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

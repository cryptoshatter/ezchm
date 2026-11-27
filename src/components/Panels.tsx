import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errText, type Bookmark, type DirEntry, type IndexItem, type SearchHit, type TocNode } from "../api";
import { IconChevron, IconClose } from "./Icons";

const bare = (p: string | null | undefined) => (p ?? "").split("#")[0].toLowerCase();

function findTrail(nodes: TocNode[], target: string, prefix: string, out: string[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const key = prefix ? `${prefix}.${i}` : `${i}`;
    if (bare(nodes[i].local) === target) {
      out.push(key);
      return true;
    }
    if (nodes[i].children.length && findTrail(nodes[i].children, target, key, out)) {
      out.push(key);
      return true;
    }
  }
  return false;
}

type Flat = { name: string; local: string; trail: string };

function flatten(nodes: TocNode[], trail: string[], out: Flat[]) {
  for (const n of nodes) {
    if (n.local) out.push({ name: n.name, local: n.local, trail: trail.join(" › ") });
    if (n.children.length) flatten(n.children, [...trail, n.name], out);
  }
  return out;
}

export function TocTree({ nodes, current, onOpen, onMenu }: { nodes: TocNode[]; current: string; onOpen: (p: string) => void; onMenu?: (e: React.MouseEvent, n: { name: string; local: string | null }) => void }) {
  const [q, setQ] = useState("");
  const flat = useMemo(() => flatten(nodes, [], []), [nodes]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    const parts = s.split(/\s+/);
    return flat.filter((f) => parts.every((p) => f.name.toLowerCase().includes(p) || f.trail.toLowerCase().includes(p))).slice(0, 800);
  }, [q, flat]);
  return (
    <div className="side-col">
      <div className="side-search">
        <input value={q} placeholder="筛选目录" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
      </div>
      {matches ? (
        <div className="side-scroll">
          {matches.map((m, i) => (
            <div key={i} className={`tree-row flat ${bare(m.local) === bare(current) ? "active" : ""}`} onClick={() => onOpen(m.local)} onContextMenu={(e) => onMenu?.(e, m)}>
              <span className="tree-label">
                {m.name}
                {m.trail && <span className="tree-trail">{m.trail}</span>}
              </span>
            </div>
          ))}
          {!matches.length && <div className="side-empty">无匹配</div>}
        </div>
      ) : (
        <Tree nodes={nodes} current={current} onOpen={onOpen} onMenu={onMenu} />
      )}
    </div>
  );
}

function Tree({ nodes, current, onOpen, onMenu }: { nodes: TocNode[]; current: string; onOpen: (p: string) => void; onMenu?: (e: React.MouseEvent, n: { name: string; local: string | null }) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => {
    const init = new Set<string>();
    let list = nodes;
    let key = "";
    while (list.length === 1 && list[0].children.length) {
      key = key ? `${key}.0` : "0";
      init.add(key);
      list = list[0].children;
    }
    return init;
  });
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trail: string[] = [];
    if (!findTrail(nodes, bare(current), "", trail)) return;
    const [self, ...parents] = trail;
    setActive(self);
    setOpen((s) => {
      if (parents.every((p) => s.has(p))) return s;
      const n = new Set(s);
      parents.forEach((p) => n.add(p));
      return n;
    });
  }, [current, nodes]);

  useEffect(() => {
    const el = box.current?.querySelector(".tree-row.active") as HTMLElement | null;
    if (!el || !box.current) return;
    const r = el.getBoundingClientRect();
    const b = box.current.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: "center" });
  }, [active, open]);

  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const render = (list: TocNode[], prefix: string, depth: number): ReactNode =>
    list.map((n, i) => {
      const key = prefix ? `${prefix}.${i}` : `${i}`;
      const has = n.children.length > 0;
      const isOpen = open.has(key);
      return (
        <div key={key}>
          <div
            className={`tree-row ${active === key ? "active" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onContextMenu={(e) => onMenu?.(e, n)}
            onClick={() => {
              if (n.local) onOpen(n.local);
              if (has && (!n.local || !isOpen)) toggle(key);
            }}
          >
            <span
              className="tree-caret"
              onClick={(e) => {
                e.stopPropagation();
                if (has) toggle(key);
              }}
            >
              {has ? <IconChevron open={isOpen} /> : null}
            </span>
            <span className="tree-label">{n.name}</span>
          </div>
          {has && isOpen && render(n.children, key, depth + 1)}
        </div>
      );
    });

  return (
    <div className="side-scroll" ref={box}>
      {render(nodes, "", 0)}
    </div>
  );
}

export function IndexList({ items, onOpen }: { items: IndexItem[]; onOpen: (p: string) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items;
    return list.slice(0, 600);
  }, [q, items]);
  return (
    <div className="side-col">
      <div className="side-search">
        <input value={q} placeholder="筛选索引" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="side-scroll">
        {shown.map((it, i) => (
          <div
            key={i}
            className={`tree-row ${it.local ? "" : "dim"}`}
            style={{ paddingLeft: 12 + (q ? 0 : it.depth) * 14 }}
            onClick={() => it.local && onOpen(it.local)}
          >
            <span className="tree-label">{it.name}</span>
          </div>
        ))}
        {!items.length && <div className="side-empty">没有索引</div>}
      </div>
    </div>
  );
}

function Hl({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  );
}

export function SearchPanel({ bookId, onOpen, autoFocus }: { bookId: string; onOpen: (p: string, terms: string[]) => void; autoFocus: number }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const terms = useMemo(() => q.split(/\s+/).filter(Boolean), [q]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [autoFocus]);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      return;
    }
    let cancel = false;
    const t = window.setTimeout(() => {
      setBusy(true);
      api
        .chmSearch(bookId, q)
        .then((h) => {
          if (!cancel) {
            setHits(h);
            setErr(null);
          }
        })
        .catch((e) => !cancel && setErr(errText(e)))
        .finally(() => !cancel && setBusy(false));
    }, 300);
    return () => {
      cancel = true;
      window.clearTimeout(t);
    };
  }, [q, bookId]);

  return (
    <div className="side-col">
      <div className="side-search">
        <input ref={input} value={q} placeholder="全文搜索" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="side-scroll">
        {busy && !hits && <div className="side-empty">搜索中…</div>}
        {err && <div className="side-empty">{err}</div>}
        {hits && <div className="side-count">{hits.length >= 300 ? "300+" : hits.length} 个结果</div>}
        {hits?.map((h) => (
          <div key={h.path} className="hit" onClick={() => onOpen(h.path, terms)}>
            <div className="hit-title">
              <Hl text={h.title} terms={terms} />
            </div>
            <div className="hit-snippet">
              <Hl text={h.snippet} terms={terms} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BookmarkList({ items, onOpen, onDelete, label }: { items: Bookmark[]; onOpen: (b: Bookmark) => void; onDelete: (id: number) => void; label?: (b: Bookmark) => string }) {
  return (
    <div className="side-scroll">
      {items.map((b) => (
        <div key={b.id} className="bm" onClick={() => onOpen(b)}>
          <div className="bm-main">
            <div className="bm-title">{b.title}</div>
            <div className="bm-sub">{label ? label(b) : b.created_at.replace("T", " ").slice(0, 16)}</div>
          </div>
          <button
            className="icon-btn sm bm-del"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(b.id);
            }}
          >
            <IconClose size={12} />
          </button>
        </div>
      ))}
      {!items.length && <div className="side-empty">还没有书签</div>}
    </div>
  );
}

function DirNode({ entry, depth, current, onOpen }: { entry: DirEntry; depth: number; current: string; onOpen: (p: string) => void }) {
  const [open, setOpen] = useState(current.startsWith(entry.path + "/"));
  const [kids, setKids] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (open && !kids) api.dirList(entry.path).then(setKids).catch(() => setKids([]));
  }, [open]);

  if (!entry.dir) {
    return (
      <div className={`tree-row ${current === entry.path ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onOpen(entry.path)}>
        <span className="tree-caret" />
        <span className="tree-label">{entry.name}</span>
      </div>
    );
  }
  return (
    <div>
      <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen(!open)}>
        <span className="tree-caret">
          <IconChevron open={open} />
        </span>
        <span className="tree-label strong">{entry.name}</span>
      </div>
      {open && kids?.map((k) => <DirNode key={k.path} entry={k} depth={depth + 1} current={current} onOpen={onOpen} />)}
    </div>
  );
}

export function FileTree({ root, current, onOpen }: { root: string; current: string; onOpen: (p: string) => void }) {
  const [kids, setKids] = useState<DirEntry[] | null>(null);
  useEffect(() => {
    api.dirList(root).then(setKids).catch(() => setKids([]));
  }, [root]);
  return (
    <div className="side-scroll">
      {kids?.map((k) => <DirNode key={k.path} entry={k} depth={0} current={current} onOpen={onOpen} />)}
    </div>
  );
}

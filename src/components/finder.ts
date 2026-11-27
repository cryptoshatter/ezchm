import { useMemo, useRef } from "react";
import { clearMarks, markTerms } from "../lib/page";

export type FindState = { count: number; index: number };

export type Finder = {
  find: (q: string) => FindState;
  next: () => FindState;
  prev: () => FindState;
  clear: () => void;
  adopt: (marks: HTMLElement[], q: string) => void;
};

export function useFinder(getRoot: () => HTMLElement | null): Finder {
  const marks = useRef<HTMLElement[]>([]);
  const idx = useRef(-1);
  const get = useRef(getRoot);
  get.current = getRoot;

  return useMemo(() => {
    const focus = (i: number): FindState => {
      const m = marks.current;
      if (!m.length) {
        idx.current = -1;
        return { count: 0, index: -1 };
      }
      const n = ((i % m.length) + m.length) % m.length;
      m[idx.current]?.classList.remove("cur");
      idx.current = n;
      m[n].classList.add("cur");
      m[n].scrollIntoView({ block: "center" });
      return { count: m.length, index: n };
    };
    const clear = () => {
      const r = get.current();
      if (r) clearMarks(r);
      marks.current = [];
      idx.current = -1;
    };
    return {
      find(q) {
        clear();
        const r = get.current();
        if (!r || !q.trim()) return { count: 0, index: -1 };
        marks.current = markTerms(r, [q]);
        return focus(0);
      },
      next: () => focus(idx.current + 1),
      prev: () => focus(idx.current - 1),
      clear,
      adopt(m) {
        marks.current = m;
        idx.current = -1;
        focus(0);
      },
    };
  }, []);
}

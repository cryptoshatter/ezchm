import { useEffect, useRef } from "react";

export function keyName(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  let k = e.key.toLowerCase();
  if (e.code.startsWith("Key")) k = e.code.slice(3).toLowerCase();
  else if (e.code === "BracketLeft") k = "[";
  else if (e.code === "BracketRight") k = "]";
  else if (e.code === "Equal") k = "=";
  else if (e.code === "Minus") k = "-";
  else if (e.code === "Comma") k = ",";
  else if (e.code === "Backslash") k = "\\";
  parts.push(k);
  return parts.join("+");
}

export function useKeys(map: Record<string, () => unknown>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  const on_ = useRef(enabled);
  on_.current = enabled;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!on_.current || e.defaultPrevented) return;
      const fn = ref.current[keyName(e)];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

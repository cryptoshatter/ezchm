import type { Dialect } from "./detect";
import { formatProcedural } from "./sqlfmt";

const SEP: Record<Dialect, RegExp | null> = {
  tsql: /^\s*GO\s*;?\s*$/i,
  plsql: /^\s*\/\s*$/,
  mysql: /^\s*DELIMITER\s+\S+\s*$/i,
  postgresql: null,
  sql: /^\s*GO\s*;?\s*$/i,
};

export function formatSql(code: string, dialect: Dialect, upper: boolean): string {
  const re = SEP[dialect];
  const out: string[] = [];
  let cur: string[] = [];
  const run = () => {
    const s = cur.join("\n");
    cur = [];
    if (s.trim()) out.push(formatProcedural(s, dialect, upper));
  };
  for (const l of code.split(/\r?\n/)) {
    if (re && re.test(l)) {
      run();
      const sep = l.trim();
      out.push(/^go/i.test(sep) ? (upper ? "GO" : "go") : sep);
    } else cur.push(l);
  }
  run();
  let s = "";
  out.forEach((part, i) => {
    const isSep = re ? re.test(part) && !part.includes("\n") : false;
    if (i === 0) s = part;
    else if (isSep) s += "\n" + part;
    else s += "\n\n" + part;
  });
  return s.trim();
}

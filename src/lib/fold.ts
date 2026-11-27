import { tokenize } from "./sqlfmt";

export type FoldKind = "block" | "paren" | "comment" | "decl" | "stmt" | "indent";
export type Fold = { start: number; from: number; to: number; kind: FoldKind; label?: string };

const STMT = /^(select|insert|update|delete|merge|with|create|alter)\b/i;
const CONT = /^(from|where|group|order|having|join|inner|left|right|full|outer|cross|union|except|intersect|set|values|on|and|or|limit|offset|returning|output|when|then|else|into|select|window|connect|start|pivot|unpivot|using|as|is|begin|returns|with)\b/i;
const TERM = /;\s*(--.*)?$/;

const indentOf = (l: string) => {
  let n = 0;
  for (const c of l) {
    if (c === " ") n++;
    else if (c === "\t") n += 4;
    else break;
  }
  return n;
};

function sqlFolds(text: string, lines: string[], plsqlLike: boolean): Fold[] {
  const out: Fold[] = [];
  const toks = tokenize(text);
  const stack: { kind: string; line: number }[] = [];
  const close = (kind: string, endLine: number, startsWithCloser: boolean) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (kind === "*" ? stack[k].kind !== "paren" : stack[k].kind === kind) {
        const s = stack[k];
        stack.length = k;
        const to = startsWithCloser ? endLine - 1 : endLine;
        if (to > s.line) out.push({ start: s.line, from: s.line + 1, to, kind: kind === "paren" ? "paren" : "block" });
        return;
      }
    }
  };
  const lineStartsWith = (ln: number, re: RegExp) => re.test((lines[ln] ?? "").trim());
  let prevLc = -2;
  let lcStart = -1;
  const flushLc = () => {
    if (lcStart >= 0 && prevLc > lcStart) out.push({ start: lcStart, from: lcStart + 1, to: prevLc, kind: "comment" });
    lcStart = -1;
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const ln = t.ln ?? 0;
    if (t.t === "lc") {
      const own = lines[ln]?.trim().startsWith("--");
      if (own && prevLc === ln - 1 && lcStart >= 0) prevLc = ln;
      else {
        flushLc();
        if (own) {
          lcStart = ln;
          prevLc = ln;
        }
      }
      continue;
    }
    if (t.t === "c") {
      if ((t.el ?? ln) > ln) out.push({ start: ln, from: ln + 1, to: t.el!, kind: "comment" });
      continue;
    }
    if (ln > prevLc) flushLc();
    if (t.v === "(") stack.push({ kind: "paren", line: ln });
    else if (t.v === ")") close("paren", ln, lineStartsWith(ln, /^\)/));
    else if (t.t === "w") {
      const w = t.v.toLowerCase();
      const nx = toks[i + 1]?.t === "w" ? toks[i + 1].v.toLowerCase() : "";
      const pv = toks[i - 1]?.t === "w" ? toks[i - 1].v.toLowerCase() : "";
      if (w === "begin" && !/^(tran|transaction|distributed)$/.test(nx)) stack.push({ kind: "begin", line: ln });
      else if (w === "case" && pv !== "end") stack.push({ kind: "case", line: ln });
      else if (plsqlLike && w === "if" && pv !== "end") stack.push({ kind: "if", line: ln });
      else if (plsqlLike && w === "loop" && pv !== "end") {
        const head = stack.length && stack[stack.length - 1].kind === "loophead" ? stack.pop()!.line : ln;
        stack.push({ kind: "loop", line: head });
      } else if (plsqlLike && (w === "for" || w === "while") && /\bloop\b/i.test(lines[ln] ?? "") === false) stack.push({ kind: "loophead", line: ln });
      else if (w === "end") {
        const startsEnd = lineStartsWith(ln, /^end\b/i);
        if (nx === "if" && plsqlLike) close("if", ln, startsEnd);
        else if (nx === "loop" && plsqlLike) close("loop", ln, startsEnd);
        else if (nx === "case") close("case", ln, startsEnd);
        else {
          while (stack.length && stack[stack.length - 1].kind === "loophead") stack.pop();
          close("*", ln, startsEnd);
        }
      }
    }
  }
  flushLc();

  for (let i = 0; i < lines.length; i++) {
    const tl = lines[i].trim();
    if (!STMT.test(tl) || TERM.test(tl)) continue;
    const base = indentOf(lines[i]);
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      const t = l.trim();
      if (!t || indentOf(l) < base) break;
      const prev = lines[j - 1].trim();
      const deeper = indentOf(l) > base;
      const newSet = /^set\s+(@|nocount|xact_abort|ansi_|quoted_|transaction|rowcount|datefirst|dateformat|language|lock_timeout|deadlock)/i.test(t);
      const cont = deeper || (CONT.test(t) && !newSet) || /^[,)+\-*/|=<>]/.test(t) || /[,(=+\-*/|]$/.test(prev) || /^(and|or)\b/i.test(t);
      if (!cont || /^(begin|end|go)\b/i.test(t) && !deeper) break;
      end = j;
      if (TERM.test(t)) break;
    }
    if (end > i) out.push({ start: i, from: i + 1, to: end, kind: "stmt" });
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*declare\s+@/i.test(lines[i])) continue;
    let j = i;
    let n = 1;
    while (j + 1 < lines.length) {
      const t = lines[j + 1].trim();
      if (/^declare\s+@/i.test(t)) n++;
      else if (!(/^[,@]/.test(t) || /,\s*(--.*)?$/.test(lines[j]))) break;
      else if (/^@/.test(t) || /^,\s*@/.test(t)) n++;
      j++;
    }
    const cnt = (lines.slice(i, j + 1).join("\n").match(/@\w+\s+[a-z]/gi) ?? []).length;
    if (j > i) out.push({ start: i, from: i + 1, to: j, kind: "decl", label: `${Math.max(n, cnt)} 个声明` });
    i = j;
  }
  return out;
}

function braceFolds(text: string): Fold[] {
  const out: Fold[] = [];
  const stack: number[] = [];
  let line = 0;
  let q: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") {
      line++;
      if (q === "/") q = null;
      continue;
    }
    if (q) {
      if (q === "*" && c === "*" && text[i + 1] === "/") q = null;
      else if (q !== "/" && q !== "*" && c === q && text[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") q = "/";
    else if (c === "/" && text[i + 1] === "*") q = "*";
    else if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") stack.push(line);
    else if (c === "}") {
      const s = stack.pop();
      if (s !== undefined && line - 1 > s) out.push({ start: s, from: s + 1, to: line - 1, kind: "block" });
    }
  }
  return out;
}

function indentFolds(lines: string[]): Fold[] {
  const out: Fold[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const base = indentOf(lines[i]);
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length || indentOf(lines[j]) <= base) continue;
    let end = j;
    for (let k = j; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (indentOf(lines[k]) <= base) break;
      end = k;
    }
    if (end > i) out.push({ start: i, from: i + 1, to: end, kind: "indent" });
  }
  return out;
}

function commentHeader(lines: string[], lang: string): Fold[] {
  const prefix = lang === "python" || lang === "shellscript" || lang === "powershell" || lang === "yaml" ? /^\s*#/ : /^\s*(\/\/|--|')/;
  let s = -1;
  const out: Fold[] = [];
  for (let i = 0; i <= lines.length; i++) {
    const hit = i < lines.length && prefix.test(lines[i]);
    if (hit && s < 0) s = i;
    if (!hit && s >= 0) {
      if (i - 1 > s) out.push({ start: s, from: s + 1, to: i - 1, kind: "comment" });
      s = -1;
    }
  }
  return out;
}

export function computeFolds(text: string, lang: string): Fold[] {
  const lines = text.split("\n");
  let all: Fold[] = [];
  if (lang === "sql") {
    const plsqlLike = !/^\s*GO\s*$/im.test(text) && /\bend\s+(if|loop)\b|\bthen\b[\s\S]*\belsif\b|:=|\$\$/i.test(text);
    try {
      all = sqlFolds(text, lines, plsqlLike);
    } catch {
      all = [];
    }
  } else if (lang !== "text" && lang !== "markdown") {
    all = braceFolds(text);
    if (lang !== "python" && lang !== "yaml") all = all.concat(commentHeader(lines, lang));
  }
  all = all.concat(indentFolds(lines));
  const byStart = new Map<number, Fold>();
  const rank: Record<FoldKind, number> = { decl: 6, comment: 5, block: 4, stmt: 3, paren: 2, indent: 1 };
  for (const f of all) {
    if (f.to < f.from || f.to >= lines.length) continue;
    const cur = byStart.get(f.start);
    if (!cur || f.to > cur.to || (f.to === cur.to && rank[f.kind] > rank[cur.kind])) byStart.set(f.start, f);
  }
  return [...byStart.values()].filter((f) => f.to - f.from >= 0 && !(f.kind === "indent" && f.to === f.from)).sort((a, b) => a.start - b.start);
}

export function autoFolds(folds: Fold[], lines: string[]): number[] {
  const out: number[] = [];
  for (const f of folds) {
    const n = f.to - f.from + 1;
    if (f.kind === "comment" && f.start <= 2 && n >= 3) out.push(f.start);
    else if (f.kind === "decl" && n >= 4) out.push(f.start);
    else if (f.kind === "comment" && n >= 8) out.push(f.start);
  }
  void lines;
  return out;
}

export function outlineFolds(folds: Fold[]): number[] {
  const depth = (f: Fold) => folds.filter((g) => g !== f && g.start < f.start && g.to >= f.to).length;
  const withDepth = folds.map((f) => ({ f, d: depth(f) }));
  const target = withDepth.some((x) => x.d === 1 && x.f.kind !== "indent") ? 1 : 0;
  return withDepth.filter((x) => x.d === target).map((x) => x.f.start);
}

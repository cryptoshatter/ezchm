import { format } from "sql-formatter";
import type { Dialect } from "./detect";

type Tok = { t: "w" | "id" | "s" | "n" | "op" | "c" | "lc" | "p" | "var"; v: string; nl?: boolean };

const WORD = /[A-Za-z_\u0080-￿#$]/;
const WORDC = /[A-Za-z0-9_\u0080-￿#$]/;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  let sawNl = false;
  const push = (t: Tok["t"], v: string) => {
    out.push({ t, v, nl: sawNl });
    sawNl = false;
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      sawNl = true;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && src[i + 1] === "-") {
      const e = src.indexOf("\n", i);
      push("lc", src.slice(i, e < 0 ? n : e).trimEnd());
      i = e < 0 ? n : e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      push("c", src.slice(i, e < 0 ? n : e + 2));
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'" || ((c === "N" || c === "n" || c === "E" || c === "e") && src[i + 1] === "'")) {
      let j = c === "'" ? i + 1 : i + 2;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      push("s", src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "$" && /^\$\w*\$/.test(src.slice(i))) {
      const tag = /^\$\w*\$/.exec(src.slice(i))![0];
      const e = src.indexOf(tag, i + tag.length);
      push("s", src.slice(i, e < 0 ? n : e + tag.length));
      i = e < 0 ? n : e + tag.length;
      continue;
    }
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < n && src[j] !== close) j++;
      push("id", src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === "@" || (c === ":" && WORD.test(src[i + 1] ?? "") && src[i - 1] !== ":")) {
      let j = i + 1;
      if (src[j] === "@") j++;
      while (j < n && WORDC.test(src[j])) j++;
      push("var", src.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9.eExX]/.test(src[j])) {
        if ((src[j] === "e" || src[j] === "E") && /[+-]/.test(src[j + 1] ?? "")) j++;
        j++;
      }
      push("n", src.slice(i, j));
      i = j;
      continue;
    }
    if (WORD.test(c)) {
      let j = i + 1;
      while (j < n && WORDC.test(src[j])) j++;
      push("w", src.slice(i, j));
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === "<=>") {
      push("op", three);
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>", "!=", ":=", "::", "||", "=>", "+=", "-=", "*=", "/=", "<<", ">>", "!<", "!>"].includes(two)) {
      push("op", two);
      i += 2;
      continue;
    }
    if ("(),;.".includes(c)) {
      push("p", c);
      i++;
      continue;
    }
    push("op", c);
    i++;
  }
  return out;
}

const KW = new Set(
  `add all alter and any as asc authorization backup begin between break browse bulk by cascade case check checkpoint close clustered coalesce collate column commit compute constraint contains continue convert create cross current current_date current_time current_timestamp current_user cursor database dbcc deallocate declare default delete deny desc distinct distributed double drop else end errlvl escape except exec execute exists exit external fetch file fillfactor for foreign freetext from full function goto grant group having holdlock identity identity_insert identitycol if in index inner insert intersect into is join key kill left like lineno load merge national nocheck nocount nonclustered not null nullif of off offsets on open opendatasource openquery openrowset openxml option or order outer over percent pivot plan precision primary print proc procedure public raiserror read readtext reconfigure references replication restore restrict return revert revoke right rollback rowcount rowguidcol rule save schema select session_user set setuser shutdown some statistics system_user table tablesample textsize then to top tran transaction trigger truncate try catch union unique unpivot update updatetext use user values varying view waitfor when where while with writetext throw output inserted deleted returns nolock readuncommitted rowlock updlock xact_abort ansi_nulls quoted_identifier partition rows range unbounded preceding following first next only offset fetch limit
   replace package body elsif loop exception others raise rownum dual sysdate systimestamp type rowtype immediate bulk collect forall record constant pragma autonomous_transaction nocopy out returning cursor notfound found isopen connect start prior level sequence nextval currval language plpgsql perform notice ilike
   int integer bigint smallint tinyint bit decimal numeric money smallmoney float real date datetime datetime2 smalldatetime time datetimeoffset char varchar text nchar nvarchar ntext binary varbinary image uniqueidentifier xml sql_variant varchar2 nvarchar2 number pls_integer binary_integer boolean clob blob nclob long raw timestamp interval serial bigserial jsonb json uuid double unsigned`
    .split(/\s+/)
    .filter(Boolean),
);

const SPACE_PAREN = new Set(
  "in values exists and or on as from join not when then else is all any some by where with into table over returns return select set if while union except intersect using case declare exec execute procedure proc function view trigger default check references key unique primary foreign constraint like between distinct top".split(" "),
);

const TSQL_START = new Set(
  "select insert update delete merge with set declare exec execute return print raiserror throw if while begin end else break continue goto truncate drop create alter open close fetch deallocate commit rollback save waitfor use grant revoke deny".split(" "),
);

const DML = new Set(["select", "insert", "update", "delete", "merge", "with"]);

const lw = (t: Tok | undefined) => (t && t.t === "w" ? t.v.toLowerCase() : "");

function kwCase(t: Tok, upper: boolean) {
  if (t.t !== "w") return t.v;
  return upper && KW.has(t.v.toLowerCase()) ? t.v.toUpperCase() : t.v;
}

export function joinTokens(toks: Tok[], upper: boolean, indent: string): string {
  let out = "";
  let prev: Tok | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const v = kwCase(t, upper);
    if (prev === null) {
      out += v;
    } else {
      let space = true;
      const pv = prev.v;
      if (t.v === "," || t.v === ";" || t.v === ")" || t.v === ".") space = false;
      else if (pv === "(" || pv === ".") space = false;
      else if (t.v === "(" && (prev.t === "w" || prev.t === "id") && !SPACE_PAREN.has(pv.toLowerCase())) space = false;
      else if (t.v === "(" && prev.t === "var") space = true;
      else if (pv === "::" || t.v === "::") space = false;
      else if (t.v === "%" && /^(type|rowtype|found|notfound|isopen|rowcount)$/i.test(toks[i + 1]?.v ?? "")) space = false;
      else if (pv === "%" && /^(type|rowtype|found|notfound|isopen|rowcount)$/i.test(t.v)) space = false;
      else if (prev.t === "op" && (pv === "-" || pv === "+") && t.t === "n") {
        const before = toks[i - 2];
        if (!before || before.v === "(" || before.v === "," || before.t === "op" || /^(then|else|return|when|and|or|select)$/i.test(before.v)) space = false;
      }
      if (prev.t === "lc") out += "\n" + indent;
      else if (t.t === "lc" && t.nl) out += "\n" + indent;
      else if (space) out += " ";
      out += v;
    }
    prev = t;
  }
  return out;
}

function splitTop(toks: Tok[]): Tok[][] {
  const parts: Tok[][] = [[]];
  let d = 0;
  for (const t of toks) {
    if (t.v === "(") d++;
    if (t.v === ")") d--;
    if (t.v === "," && d === 0) {
      parts[parts.length - 1].push(t);
      parts.push([]);
    } else parts[parts.length - 1].push(t);
  }
  return parts.filter((p) => p.length);
}

const LANG: Record<Dialect, "sql" | "tsql" | "plsql" | "mysql" | "postgresql"> = { sql: "sql", tsql: "tsql", plsql: "plsql", mysql: "mysql", postgresql: "postgresql" };

function runFormatter(text: string, dialect: Dialect, upper: boolean): string {
  const opts = {
    keywordCase: upper ? ("upper" as const) : ("preserve" as const),
    dataTypeCase: upper ? ("upper" as const) : ("preserve" as const),
    functionCase: "preserve" as const,
    identifierCase: "preserve" as const,
    tabWidth: 4,
    linesBetweenQueries: 1,
    logicalOperatorNewline: "before" as const,
    expressionWidth: 60,
  };
  let out: string | null = null;
  for (const lang of [LANG[dialect], "tsql", "sql", "plsql", "mysql", "postgresql"] as const) {
    try {
      out = format(text, { ...opts, language: lang });
      break;
    } catch {
      continue;
    }
  }
  if (out == null) throw new Error("无法格式化这段 SQL");
  return out
    .replace(/\n(\s*)WITH\n\s*\(([^()\n]*)\)/gi, (_m, _s, h) => ` ${upper ? "WITH" : "with"} (${h})`)
    .replace(/% (TYPE|ROWTYPE|FOUND|NOTFOUND|ISOPEN|ROWCOUNT)\b/gi, "%$1")
    .replace(/\b(\w+)\s*%\s*(TYPE|ROWTYPE)\b/gi, "$1%$2")
    .replace(/^(SET|set)\n {4}([^\n]*)((?:\n[^\n]*)*)$/, (_m, k, first, rest: string) => `${k} ${first}${rest.replace(/\n {4}/g, "\n")}`);
}

type Block = "begin" | "if" | "loop" | "decl" | "package" | "exception" | "handler" | "case";

class Formatter {
  lines: string[] = [];
  depth = 0;
  oneShot = 0;
  stack: { kind: Block; base: number }[] = [];
  gap = false;
  plsql: boolean;
  constructor(public dialect: Dialect, public upper: boolean) {
    this.plsql = dialect === "plsql";
  }

  ind(extra = 0) {
    return "    ".repeat(Math.max(0, this.depth + this.oneShot + extra));
  }

  kw(s: string) {
    return this.upper ? s.toUpperCase() : s.toLowerCase();
  }

  line(text: string, multi = false) {
    if (multi && this.lines.length && this.lines[this.lines.length - 1] !== "" && !this.lastOpener()) this.lines.push("");
    else if (this.gap && this.lines.length && this.lines[this.lines.length - 1] !== "") this.lines.push("");
    this.gap = multi;
    const ind = this.ind();
    for (const l of text.split("\n")) this.lines.push(l.trim() ? ind + l : "");
  }

  opener(text: string) {
    this.gap = false;
    const ind = this.ind();
    this.lines.push(ind + text);
  }

  lastOpener() {
    const l = (this.lines[this.lines.length - 1] ?? "").trim().toUpperCase();
    return /^(BEGIN|BEGIN TRY|BEGIN CATCH|ELSE|AS|IS|DECLARE|EXCEPTION|LOOP)$/.test(l) || / (THEN|LOOP|IS|AS)$/.test(l) || l.endsWith("(");
  }

  statement(toks: Tok[]) {
    if (!toks.length) return;
    const first = lw(toks[0]);
    const text = joinTokens(toks, this.upper, "");
    if (toks.every((t) => t.t === "lc" || t.t === "c")) {
      this.gap = false;
      for (const t of toks) this.lines.push(this.ind() + t.v);
      this.oneShot = 0;
      return;
    }
    const t0 = toks[0];
    if (t0.t === "s" && t0.v.startsWith("$") && t0.v.includes("\n")) {
      const tag = /^\$\w*\$/.exec(t0.v)![0];
      const inner = t0.v.slice(tag.length, t0.v.length - tag.length);
      let body: string;
      try {
        body = formatProcedural(inner, this.dialect, this.upper);
      } catch {
        body = inner.trim();
      }
      const rest = joinTokens(toks.slice(1), this.upper, "");
      this.gap = false;
      const ind = this.ind();
      this.lines.push(ind + tag);
      body.split("\n").forEach((l) => this.lines.push(l.trim() ? ind + l : ""));
      this.lines.push(ind + tag + (rest ? " " + rest : ""));
      this.oneShot = 0;
      return;
    }
    let out = text;
    let multi = false;
    const hasSub = toks.some((t, i) => t.v === "(" && lw(toks[i + 1]) === "select");
    if (DML.has(first) || ((first === "set" || first === "return" || first === "if" || first === "while") && hasSub)) {
      if (text.length > 70 || hasSub || toks.some((t) => t.t === "lc")) {
        try {
          out = runFormatter(text, this.dialect, this.upper).trim();
          multi = out.includes("\n");
        } catch {
          out = text;
        }
      }
    } else if (first === "declare" && toks.length > 1 && toks[1].t === "var") {
      const parts = splitTop(toks.slice(1));
      if (parts.length > 1) {
        const pad = " ".repeat(8);
        out = this.kw("declare") + " " + parts.map((p, i) => (i ? pad : "") + joinTokens(p, this.upper, pad)).join("\n");
      }
    }
    this.line(out, multi);
    this.oneShot = 0;
  }

  header(toks: Tok[], term: Tok | null) {
    let pi = toks.findIndex((t) => t.v === "(");
    const isProcLike = toks.some((t) => /^(procedure|proc|function)$/i.test(t.v));
    const firstVar = toks.findIndex((t) => t.t === "var");
    const nameEnd = pi >= 0 ? pi : firstVar >= 0 ? firstVar : toks.length;
    const retIdx = toks.findIndex((t, i) => i > nameEnd && /^(returns?|return)$/i.test(t.v));
    let head = joinTokens(toks.slice(0, nameEnd), this.upper, "");
    const lines: string[] = [];
    if (isProcLike && pi >= 0 && pi === nameEnd) {
      let d = 0;
      let close = -1;
      for (let i = pi; i < toks.length; i++) {
        if (toks[i].v === "(") d++;
        if (toks[i].v === ")" && --d === 0) {
          close = i;
          break;
        }
      }
      if (close > pi + 1) {
        const params = splitTop(toks.slice(pi + 1, close));
        lines.push(head + " (");
        params.forEach((p) => lines.push("    " + joinTokens(p, this.upper, "    ")));
        const rest = joinTokens(toks.slice(close + 1), this.upper, "");
        lines.push(")" + (rest ? " " + rest : ""));
      } else lines.push(joinTokens(toks, this.upper, ""));
    } else if (isProcLike && firstVar >= 0 && firstVar === nameEnd) {
      const end = retIdx > 0 ? retIdx : toks.length;
      let paramToks = toks.slice(firstVar, end);
      let withPart: Tok[] = [];
      const wi = paramToks.findIndex((t, i) => lw(t) === "with" && splitTop(paramToks.slice(0, i)).length > 0 && /^(recompile|encryption|execute)$/i.test(paramToks[i + 1]?.v ?? ""));
      if (wi >= 0) {
        withPart = paramToks.slice(wi);
        paramToks = paramToks.slice(0, wi);
      }
      lines.push(head);
      splitTop(paramToks).forEach((p) => lines.push("    " + joinTokens(p, this.upper, "    ")));
      if (retIdx > 0) lines.push(joinTokens(toks.slice(retIdx), this.upper, ""));
      if (withPart.length) lines.push(joinTokens(withPart, this.upper, ""));
    } else {
      head = joinTokens(toks, this.upper, "");
      lines.push(head);
    }
    if (term) {
      const tv = kwCase(term, this.upper);
      if (this.plsql || lw(term) === "is") lines[lines.length - 1] += " " + tv;
      else lines.push(tv);
    }
    if (this.lines.length && this.lines[this.lines.length - 1] !== "") this.lines.push("");
    const ind = this.ind();
    lines.forEach((l) => this.lines.push(ind + l));
    this.gap = false;
    this.oneShot = 0;
  }

  push(kind: Block) {
    this.stack.push({ kind, base: this.depth });
    this.depth++;
  }

  pop(until?: Block[]) {
    while (this.stack.length) {
      const top = this.stack.pop()!;
      this.depth = top.base;
      if (!until || until.includes(top.kind)) return top;
    }
    this.depth = 0;
    return null;
  }

  top() {
    return this.stack[this.stack.length - 1]?.kind;
  }
}

function caseDelta(t: Tok) {
  const w = lw(t);
  return w === "case" ? 1 : 0;
}

export function formatProcedural(src: string, dialect: Dialect, upper: boolean): string {
  const toks = tokenize(src);
  const f = new Formatter(dialect, upper);
  const plsql = dialect === "plsql";
  let buf: Tok[] = [];
  let paren = 0;
  let caseDepth = 0;
  let i = 0;

  const flush = () => {
    f.statement(buf);
    buf = [];
    paren = 0;
    caseDepth = 0;
  };

  const scanTo = (from: number, words: string[], stopAtSemi = true) => {
    let d = 0;
    let cd = 0;
    for (let j = from; j < toks.length; j++) {
      const t = toks[j];
      if (t.v === "(") d++;
      else if (t.v === ")") d--;
      else if (d === 0) {
        const w = lw(t);
        if (w === "case") cd++;
        else if (w === "end" && cd > 0) cd--;
        else if (cd === 0 && words.includes(w)) return j;
        if (stopAtSemi && t.v === ";") return -1;
      }
    }
    return -1;
  };

  const condEnd = (from: number) => {
    let d = 0;
    let cd = 0;
    for (let j = from; j < toks.length; j++) {
      const t = toks[j];
      if (t.v === "(") d++;
      else if (t.v === ")") d--;
      else if (d === 0) {
        const w = lw(t);
        if (w === "case") cd++;
        else if (w === "end" && cd > 0) cd--;
        else if (cd === 0 && TSQL_START.has(w) && j > from) return j;
        if (t.v === ";") return j;
      }
    }
    return toks.length;
  };

  while (i < toks.length) {
    const t = toks[i];
    const w = lw(t);
    const atStart = buf.length === 0 || buf.every((b) => b.t === "lc" || b.t === "c");

    if ((t.t === "lc" || t.t === "c") && buf.length === 0) {
      f.statement([t]);
      i++;
      continue;
    }

    if (t.v === "(") paren++;
    if (t.v === ")") paren = Math.max(0, paren - 1);
    if (paren === 0 && t.t === "w") caseDepth += caseDelta(t);

    if (paren > 0 || (t.v === "(" && paren === 1)) {
      buf.push(t);
      i++;
      continue;
    }

    if (t.v === ";") {
      buf.push(t);
      flush();
      i++;
      continue;
    }

    if (t.t === "op" && t.v === "<" && toks[i + 1]?.v === "<") {
      const close = toks.findIndex((x, j) => j > i && x.v === ">" && toks[j + 1]?.v === ">");
      if (close > 0) {
        flush();
        f.opener(toks.slice(i, close + 2).map((x) => x.v).join(""));
        i = close + 2;
        continue;
      }
    }

    if (t.t !== "w") {
      buf.push(t);
      i++;
      continue;
    }

    if (w === "end" && caseDepth > 0) {
      caseDepth--;
      buf.push(t);
      i++;
      continue;
    }

    if (caseDepth > 0) {
      buf.push(t);
      i++;
      continue;
    }

    const prev = buf[buf.length - 1];
    const firstW = lw(buf.find((b) => b.t === "w"));

    if (w === "create" || w === "alter" || ((w === "procedure" || w === "function") && plsql && atStart)) {
      const isRoutine = /^(or|procedure|proc|function|trigger|package|view|type)$/i.test(toks[i + 1]?.v ?? "") || w !== "create";
      const routineWord = toks.slice(i, i + 5).find((x) => /^(procedure|proc|function|trigger|package)$/i.test(x.v));
      if (isRoutine && routineWord && (atStart || !buf.length)) {
        flush();
        const term = scanTo(i + 1, ["as", "is"]);
        const semi = toks.findIndex((x, j) => j > i && x.v === ";");
        if (term > 0 && (semi < 0 || term < semi || dialect !== "plsql")) {
          f.header(toks.slice(i, term), toks[term]);
          i = term + 1;
          if (plsql || lw(toks[term]) === "is") {
            if (/package/i.test(routineWord.v) && toks.slice(i - 8, i).some((x) => lw(x) === "body")) f.push("package");
            else if (/package/i.test(routineWord.v)) f.push("package");
            else f.push("decl");
          } else if (lw(toks[i]) === "begin" || TSQL_START.has(lw(toks[i]))) {
            f.oneShot = 0;
          }
          continue;
        }
      }
    }

    if (w === "begin") {
      const nx = lw(toks[i + 1]);
      if (nx === "tran" || nx === "transaction" || nx === "distributed") {
        if (!atStart) flush();
        buf.push(t);
        i++;
        continue;
      }
      flush();
      if (f.top() === "decl") f.pop(["decl"]);
      const label = nx === "try" || nx === "catch" ? " " + kwCase(toks[i + 1], upper) : "";
      const base = f.depth + Math.max(0, f.oneShot - 1);
      f.depth = base;
      f.oneShot = 0;
      f.opener(f.kw("begin") + label);
      f.push("begin");
      i += label ? 2 : 1;
      continue;
    }

    if (w === "end") {
      flush();
      const nx = lw(toks[i + 1]);
      let n = 1;
      let text = f.kw("end");
      const blockKind = nx === "if" ? "if" : nx === "loop" ? "loop" : nx === "case" ? "case" : null;
      if (blockKind && f.stack.some((b) => b.kind === blockKind)) {
        f.pop(nx === "if" ? ["if"] : nx === "loop" ? ["loop"] : ["case"]);
        text += " " + kwCase(toks[i + 1], upper);
        n = 2;
      } else if (nx === "try" || nx === "catch") {
        while (f.top() === "handler" || f.top() === "exception") f.pop();
        f.pop(["begin"]);
        text += " " + kwCase(toks[i + 1], upper);
        n = 2;
      } else {
        while (f.top() === "handler" || f.top() === "exception" || f.top() === "if" || f.top() === "loop") f.pop();
        f.pop(["begin", "package"]);
        const nt = toks[i + 1];
        if (nt && (nt.t === "w" || nt.t === "id") && !TSQL_START.has(nx) && nx !== "else" && !nt.nl) {
          text += " " + nt.v;
          n = 2;
        }
      }
      if (toks[i + n]?.v === ";") {
        text += ";";
        n++;
      }
      f.oneShot = 0;
      f.opener(text);
      f.gap = true;
      i += n;
      continue;
    }

    if (w === "exception" && plsql && atStart && f.top() === "begin") {
      flush();
      f.depth--;
      f.opener(f.kw("exception"));
      f.depth++;
      f.push("exception");
      f.depth--;
      i++;
      continue;
    }

    if (w === "when" && plsql && atStart && (f.top() === "exception" || f.top() === "handler")) {
      if (f.top() === "handler") f.pop(["handler"]);
      const th = scanTo(i + 1, ["then"]);
      if (th > 0) {
        f.opener(joinTokens(toks.slice(i, th + 1), upper, ""));
        f.push("handler");
        i = th + 1;
        continue;
      }
    }

    if (w === "if" && atStart) {
      flush();
      const th = scanTo(i + 1, ["then"]);
      if (th > 0 && (plsql || dialect === "mysql" || dialect === "postgresql")) {
        f.opener(joinTokens(toks.slice(i, th + 1), upper, ""));
        f.push("if");
        i = th + 1;
        continue;
      }
      const e = condEnd(i + 1);
      const cond = toks.slice(i, e);
      const condText = cond.some((x, j) => x.v === "(" && lw(cond[j + 1]) === "select") && joinTokens(cond, upper, "").length > 70
        ? runFormatterCond(cond, dialect, upper)
        : joinTokens(cond, upper, "");
      f.line(condText);
      f.oneShot++;
      i = e;
      continue;
    }

    if ((w === "elsif" || w === "elseif") && f.top() === "if") {
      flush();
      const th = scanTo(i + 1, ["then"]);
      f.depth--;
      f.opener(joinTokens(toks.slice(i, th > 0 ? th + 1 : i + 1), upper, ""));
      f.depth++;
      i = th > 0 ? th + 1 : i + 1;
      continue;
    }

    if (w === "else") {
      flush();
      if (f.top() === "if") {
        f.depth--;
        f.opener(f.kw("else"));
        f.depth++;
        i++;
        continue;
      }
      f.oneShot = 0;
      f.opener(f.kw("else"));
      const nx = lw(toks[i + 1]);
      if (nx !== "begin" && nx !== "if") f.oneShot = 1;
      else if (nx === "begin") f.oneShot = 1;
      i++;
      continue;
    }

    if ((w === "while" || w === "for") && atStart) {
      const lp = scanTo(i + 1, ["loop"]);
      if (lp > 0) {
        flush();
        f.opener(joinTokens(toks.slice(i, lp + 1), upper, ""));
        f.push("loop");
        i = lp + 1;
        continue;
      }
      if (w === "while") {
        flush();
        const e = condEnd(i + 1);
        f.line(joinTokens(toks.slice(i, e), upper, ""));
        f.oneShot++;
        i = e;
        continue;
      }
    }

    if (w === "loop" && atStart && plsql) {
      flush();
      f.opener(f.kw("loop"));
      f.push("loop");
      i++;
      continue;
    }

    if (w === "declare" && atStart && toks[i + 1] && toks[i + 1].t !== "var" && plsql) {
      flush();
      f.opener(f.kw("declare"));
      f.push("decl");
      i++;
      continue;
    }

    if (w === "as" && atStart && !plsql && buf.length === 0) {
      f.opener(f.kw("as"));
      i++;
      continue;
    }

    if (!plsql && !atStart && TSQL_START.has(w) && w !== "end" && w !== "else" && w !== "begin") {
      const pv = prev?.v ?? "";
      const pw = lw(prev);
      let cont = pv === "," || pv === "." || pv === "=" || pv === "(" || prev?.t === "op";
      if (w === "select" && (firstW === "insert" || pw === "union" || pw === "all" || pw === "except" || pw === "intersect" || pw === "for" || pw === "as" || firstW === "with" || firstW === "declare" && buf.some((b) => lw(b) === "cursor"))) cont = true;
      if (w === "set" && firstW === "update" && !buf.some((b) => lw(b) === "set")) cont = true;
      if ((w === "exec" || w === "execute") && firstW === "insert") cont = true;
      if (firstW === "merge") cont = true;
      if (w === "with" && (toks[i + 1]?.v === "(" || /^(nolock|recompile|ties|check|rollup|cube|encryption|schemabinding|execute)$/i.test(toks[i + 1]?.v ?? ""))) cont = true;
      if (w === "with" && pw === "rollup") cont = true;
      if ((w === "open" || w === "close") && firstW !== "" && pw !== "" && !/^(go|end)$/i.test(pw)) cont = cont || false;
      if (w === "set" && firstW === "declare") cont = false;
      if (w === "for" || w === "use") cont = true;
      if (pw === "delete" || pw === "insert" || pw === "update" || pw === "into" || pw === "from") cont = true;
      if (!cont) {
        flush();
        continue;
      }
    }

    buf.push(t);
    i++;
  }
  flush();
  return f.lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").trimEnd();
}

function runFormatterCond(cond: Tok[], dialect: Dialect, upper: boolean) {
  const head = kwCase(cond[0], upper);
  const rest = joinTokens(cond.slice(1), upper, "");
  try {
    const f = runFormatter(`SELECT ${rest}`, dialect, upper).replace(/^SELECT\s*/i, "");
    const lines = f.split("\n").map((l) => l.replace(/^ {4}/, ""));
    return `${head} ${lines.join("\n")}`;
  } catch {
    return `${head} ${rest}`;
  }
}

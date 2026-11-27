export type Dialect = "sql" | "tsql" | "plsql" | "mysql" | "postgresql";

export const DIALECTS: { id: Dialect; name: string }[] = [
  { id: "tsql", name: "SQL Server" },
  { id: "plsql", name: "Oracle" },
  { id: "mysql", name: "MySQL" },
  { id: "postgresql", name: "PostgreSQL" },
  { id: "sql", name: "标准 SQL" },
];

export const LANGS: { id: string; name: string }[] = [
  { id: "sql", name: "SQL" },
  { id: "csharp", name: "C#" },
  { id: "java", name: "Java" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "python", name: "Python" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
  { id: "go", name: "Go" },
  { id: "rust", name: "Rust" },
  { id: "php", name: "PHP" },
  { id: "vb", name: "VB" },
  { id: "powershell", name: "PowerShell" },
  { id: "shellscript", name: "Shell" },
  { id: "bat", name: "Batch" },
  { id: "xml", name: "XML" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "json", name: "JSON" },
  { id: "yaml", name: "YAML" },
  { id: "ini", name: "INI" },
  { id: "markdown", name: "Markdown" },
  { id: "text", name: "纯文本" },
];

const EXT: Record<string, string> = {
  sql: "sql", prc: "sql", pck: "sql", pkb: "sql", pks: "sql", fnc: "sql", trg: "sql", vw: "sql", ddl: "sql", tab: "sql", pls: "sql", plb: "sql",
  cs: "csharp", java: "java", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", go: "go", rs: "rust", php: "php",
  vb: "vb", bas: "vb", vbs: "vb", cls: "vb", ps1: "powershell", psm1: "powershell", sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  bat: "bat", cmd: "bat", xml: "xml", config: "xml", csproj: "xml", xsd: "xml", xsl: "xml", html: "html", htm: "html", css: "css",
  json: "json", yml: "yaml", yaml: "yaml", ini: "ini", properties: "ini", toml: "ini", md: "markdown", txt: "text", log: "text",
};

export function langFromName(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT[ext] ?? null;
}

const SQL_STRONG =
  /\b(select\b[\s\S]{1,400}?\bfrom|insert\s+into|update\s+[\w.\[\]"`]+\s+set|delete\s+from|create\s+(or\s+replace\s+)?(procedure|proc|function|table|view|trigger|index|package|sequence|type)|alter\s+(table|procedure|proc|function|view|session)|drop\s+(table|procedure|proc|function|view|index)|declare\s+@|exec(ute)?\s+[\w.@\[]|truncate\s+table|merge\s+into|with\s+\w+\s+as\s*\()/i;

export function detectLang(code: string): string {
  const s = code.slice(0, 6000);
  const t = s.trim();
  if (!t) return "text";
  if (/^<\?xml|^<!doctype html|^<(html|xsl:|configuration|project)\b/i.test(t)) return /^<!doctype html|^<html/i.test(t) ? "html" : "xml";
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      /* not json */
    }
  }
  if (/\busing\s+System\b|\bnamespace\s+[\w.]+\s*\{|\bpublic\s+(partial\s+)?class\s+\w+\s*(:\s*\w+)?\s*\{?\s*$|\bConsole\.Write|\bvar\s+\w+\s*=\s*new\s+\w+/m.test(s) && !/\bimport\s+java\./.test(s)) return "csharp";
  if (/\bimport\s+java\.|\bSystem\.out\.print|\bpublic\s+static\s+void\s+main\s*\(\s*String/.test(s)) return "java";
  if (/^\s*#include\s*[<"]|\bstd::|\bprintf\s*\(|\bint\s+main\s*\(/m.test(s)) return /\bstd::|\bclass\s+\w+|\bcout\b|::/.test(s) ? "cpp" : "c";
  if (SQL_STRONG.test(s)) return "sql";
  if (/^\s*(def|class)\s+\w+.*:\s*$|^\s*(from\s+[\w.]+\s+)?import\s+[\w.]+(\s+as\s+\w+)?\s*$|\bprint\s*\(|\bself\./m.test(s)) return "python";
  if (/^\s*(Dim|Private|Public)\s+\w+\s+As\b|^\s*End\s+(Sub|Function|If)\b|^\s*(Private\s+|Public\s+)?Sub\s+\w+/im.test(s)) return "vb";
  if (/^\s*<\?php/.test(s)) return "php";
  if (/^\s*package\s+\w+\s*$|\bfunc\s+\w+\(|:=/m.test(s) && /\bfunc\b/.test(s)) return "go";
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|\bimpl\b/.test(s)) return "rust";
  if (/\b(const|let)\s+\w+\s*=|=>|\bfunction\s*\w*\s*\(|\bconsole\.\w+\(|\bdocument\.|\brequire\(/.test(s)) return /:\s*(string|number|boolean)\b|\binterface\s+\w+/.test(s) ? "typescript" : "javascript";
  if (/^#!\/bin\/(ba|z)?sh|^\s*(echo|export|cd|sudo|apt|brew|npm|yarn|git)\s/m.test(s)) return "shellscript";
  if (/\b(Get|Set|New|Remove)-[A-Z]\w+|^\s*\$\w+\s*=/m.test(s)) return "powershell";
  if (/^\s*@echo\s+off|^\s*(set|rem|goto)\s/im.test(s)) return "bat";
  if (/^\s*<[a-zA-Z][\w:-]*[\s>][\s\S]*<\/[a-zA-Z][\w:-]*>\s*$/.test(t)) return /<(div|span|p|table|body|head|a)\b/i.test(t) ? "html" : "xml";
  if (/^\s*[.#]?[\w-]+\s*\{[^}]*:\s*[^}]+;/m.test(s)) return "css";
  if (/\b(select|from|where|join|group\s+by|order\s+by|begin|end|declare|varchar|int|null|union)\b/gi.test(s)) {
    const n = (s.match(/\b(select|from|where|join|group\s+by|order\s+by|begin|declare|varchar|nvarchar|union|having|values|exists|between|case\s+when)\b/gi) ?? []).length;
    if (n >= 3) return "sql";
  }
  return "text";
}

export function detectDialect(code: string): Dialect | null {
  const s = code.slice(0, 20000);
  const score: Record<Dialect, number> = { sql: 0, tsql: 0, plsql: 0, mysql: 0, postgresql: 0 };
  const add = (d: Dialect, re: RegExp, w: number) => {
    const m = s.match(re);
    if (m) score[d] += w * Math.min(m.length, 5);
  };
  add("tsql", /^\s*GO\s*;?\s*$/gim, 4);
  add("tsql", /(^|[\s(,=])@@?[A-Za-z_]\w*/g, 1);
  add("tsql", /\[[\w\s.$#]+\]/g, 1);
  add("tsql", /\b(nvarchar|nchar|ntext|uniqueidentifier|datetime2|bit|money|identity\s*\(|getdate\s*\(|isnull\s*\(|newid\s*\(|scope_identity|raiserror|throw\s+5\d{4}|set\s+nocount|begin\s+tran(saction)?|try_convert|sp_executesql|top\s*\(?\s*\d|dbo\.|nolock|output\s+inserted|with\s*\(\s*nolock)/gi, 2);
  add("tsql", /\bcreate\s+proc(edure)?\s+[\w.\[\]]+[\s\S]{0,200}?@\w+/gi, 3);
  add("plsql", /\b(varchar2|nvarchar2|number\s*\(|pls_integer|binary_integer|nvl2?\s*\(|decode\s*\(|sysdate|systimestamp|dbms_\w+|utl_\w+|raise_application_error|elsif|rownum|from\s+dual|bulk\s+collect|forall|execute\s+immediate|connect\s+by|%(row)?type|sqlerrm|sqlcode|create\s+or\s+replace\s+(package|procedure|function|trigger)|is\s*$)/gim, 2);
  add("plsql", /:=/g, 1);
  add("plsql", /^\s*\/\s*$/gm, 3);
  add("plsql", /\bexception\s+when\b/gi, 3);
  add("mysql", /`[^`\n]+`/g, 2);
  add("mysql", /\b(auto_increment|engine\s*=|charset\s*=|unsigned|tinyint|mediumtext|longtext|ifnull\s*\(|group_concat|limit\s+\d+\s*,\s*\d+|on\s+duplicate\s+key|delimiter\s+\S+|sql_calc_found_rows|now\s*\(\s*\))/gi, 2);
  add("mysql", /^\s*delimiter\s+/gim, 4);
  add("postgresql", /\$\w*\$/g, 2);
  add("postgresql", /::\s*[a-z_]+/gi, 2);
  add("postgresql", /\b(serial|bigserial|plpgsql|ilike|returning|jsonb|text\[\]|generate_series|string_agg|coalesce|nextval\s*\(|language\s+plpgsql|raise\s+notice|perform\s)/gi, 2);
  let best: Dialect | null = null;
  let max = 2;
  for (const d of ["tsql", "plsql", "mysql", "postgresql"] as Dialect[]) {
    if (score[d] > max) {
      max = score[d];
      best = d;
    }
  }
  return best;
}

export function shikiLang(lang: string, dialect: Dialect) {
  if (lang === "sql") return dialect === "plsql" ? "plsql" : "sql";
  return lang;
}

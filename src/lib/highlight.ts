import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  sql: () => import("shiki/langs/sql.mjs"),
  plsql: () => import("shiki/langs/plsql.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  vb: () => import("shiki/langs/vb.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  bat: () => import("shiki/langs/bat.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
};

const THEME_LOADERS: Record<string, () => Promise<unknown>> = {
  "github-light": () => import("shiki/themes/github-light.mjs"),
  "one-light": () => import("shiki/themes/one-light.mjs"),
  "light-plus": () => import("shiki/themes/light-plus.mjs"),
  "solarized-light": () => import("shiki/themes/solarized-light.mjs"),
  "catppuccin-latte": () => import("shiki/themes/catppuccin-latte.mjs"),
  "min-light": () => import("shiki/themes/min-light.mjs"),
  "one-dark-pro": () => import("shiki/themes/one-dark-pro.mjs"),
  "github-dark": () => import("shiki/themes/github-dark.mjs"),
  "dark-plus": () => import("shiki/themes/dark-plus.mjs"),
  dracula: () => import("shiki/themes/dracula.mjs"),
  nord: () => import("shiki/themes/nord.mjs"),
  "tokyo-night": () => import("shiki/themes/tokyo-night.mjs"),
  monokai: () => import("shiki/themes/monokai.mjs"),
  "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs"),
};

export const CODE_THEMES_LIGHT = [
  { id: "github-light", name: "GitHub" },
  { id: "one-light", name: "One Light" },
  { id: "light-plus", name: "VS Code" },
  { id: "solarized-light", name: "Solarized" },
  { id: "catppuccin-latte", name: "Catppuccin" },
  { id: "min-light", name: "Min" },
];

export const CODE_THEMES_DARK = [
  { id: "one-dark-pro", name: "One Dark Pro" },
  { id: "github-dark", name: "GitHub Dark" },
  { id: "dark-plus", name: "VS Code Dark" },
  { id: "dracula", name: "Dracula" },
  { id: "nord", name: "Nord" },
  { id: "tokyo-night", name: "Tokyo Night" },
  { id: "monokai", name: "Monokai" },
  { id: "catppuccin-mocha", name: "Catppuccin" },
];

let hl: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();

function core() {
  if (!hl) hl = createHighlighterCore({ themes: [], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) });
  return hl;
}

async function ensure(lang: string, theme: string) {
  const h = await core();
  if (!loadedThemes.has(theme)) {
    const t = THEME_LOADERS[theme] ?? THEME_LOADERS["github-light"];
    await h.loadTheme(t() as never);
    loadedThemes.add(theme);
  }
  if (lang !== "text" && !loadedLangs.has(lang)) {
    const l = LANG_LOADERS[lang];
    if (l) await h.loadLanguage(l() as never);
    loadedLangs.add(lang);
  }
  return h;
}

export type Highlighted = { html: string; bg: string; fg: string };

export async function highlight(code: string, lang: string, theme: string): Promise<Highlighted> {
  const h = await ensure(lang, theme);
  const useLang = lang !== "text" && h.getLoadedLanguages().includes(lang) ? lang : "text";
  const t = h.getTheme(theme);
  const html = h.codeToHtml(code, { lang: useLang, theme });
  return { html, bg: t.bg, fg: t.fg };
}

export async function themeColors(theme: string) {
  const h = await ensure("text", theme);
  const t = h.getTheme(theme);
  return { bg: t.bg, fg: t.fg };
}

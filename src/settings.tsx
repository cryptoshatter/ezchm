import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Dialect } from "./lib/detect";

export type Settings = {
  theme: "system" | "light" | "dark";
  fontSize: number;
  codeFontSize: number;
  codeFont: string;
  codeThemeLight: string;
  codeThemeDark: string;
  lineNumbers: boolean;
  wrap: boolean;
  dialect: "auto" | Dialect;
  fallbackDialect: Dialect;
  upperKeywords: boolean;
  autoFormat: boolean;
  autoFold: boolean;
  originalStyle: boolean;
  pageWidth: "normal" | "wide" | "full";
  sidebarOpen: boolean;
  sidebarWidth: number;
  agentPath: string;
  agentModel: string;
  agentWidth: number;
  agentLength: "brief" | "detail";
};

export const DEFAULTS: Settings = {
  theme: "system",
  fontSize: 15,
  codeFontSize: 13,
  codeFont: "JetBrains Mono",
  codeThemeLight: "github-light",
  codeThemeDark: "one-dark-pro",
  lineNumbers: true,
  wrap: false,
  dialect: "auto",
  fallbackDialect: "tsql",
  upperKeywords: true,
  autoFormat: false,
  autoFold: true,
  originalStyle: false,
  pageWidth: "normal",
  sidebarOpen: true,
  sidebarWidth: 290,
  agentPath: "",
  agentModel: "",
  agentWidth: 400,
  agentLength: "brief",
};

function parse(raw: Record<string, string>): Settings {
  const s: Record<string, unknown> = { ...DEFAULTS };
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULTS)) continue;
    const d = (DEFAULTS as Record<string, unknown>)[k];
    if (typeof d === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) s[k] = n;
    } else if (typeof d === "boolean") s[k] = v === "1";
    else s[k] = v;
  }
  return s as Settings;
}

type Ctx = {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  dark: boolean;
  codeTheme: string;
};

const SettingsCtx = createContext<Ctx | null>(null);

function systemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [sysDark, setSysDark] = useState(systemDark());

  useEffect(() => {
    api
      .settings()
      .then((r) => setSettings(parse(r)))
      .catch(() => undefined)
      .finally(() => setReady(true));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    const raw = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    api.setSetting(key, raw).catch(() => undefined);
  }, []);

  const dark = settings.theme === "dark" || (settings.theme === "system" && sysDark);
  const codeTheme = dark ? settings.codeThemeDark : settings.codeThemeLight;

  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = dark ? "dark" : "light";
    r.style.setProperty("--font-size", `${settings.fontSize}px`);
    r.style.setProperty("--code-size", `${settings.codeFontSize}px`);
    r.style.setProperty("--code-font", `"${settings.codeFont}", "SF Mono", Menlo, Monaco, "PingFang SC", monospace`);
  }, [dark, settings.fontSize, settings.codeFontSize, settings.codeFont]);

  const value = useMemo(() => ({ settings, set, dark, codeTheme }), [settings, set, dark, codeTheme]);
  if (!ready) return null;
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error("no settings");
  return c;
}

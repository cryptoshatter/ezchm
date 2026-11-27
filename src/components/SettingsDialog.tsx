import { useEffect, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errText, type AppInfo } from "../api";
import { useSettings, type Settings } from "../settings";
import { DIALECTS } from "../lib/detect";
import { CODE_THEMES_DARK, CODE_THEMES_LIGHT } from "../lib/highlight";
import { IconClose } from "./Icons";
import { checkUpdate } from "./Updater";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">{label}</div>
      <div className="set-ctrl">{children}</div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${value ? "on" : ""}`} onClick={() => onChange(!value)} role="switch" aria-checked={value} />;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: { id: T; name: string }[]; onChange: (v: T) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

const FONTS = ["JetBrains Mono", "SF Mono", "Menlo", "Monaco", "Courier New"].map((f) => ({ id: f, name: f }));

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings: s, set } = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [upd, setUpd] = useState<string | null>(null);

  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => undefined);
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const S = <K extends keyof Settings>(k: K) => (v: Settings[K]) => set(k, v);

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>设置</span>
          <button className="icon-btn sm" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="modal-body">
          <h4>外观</h4>
          <Row label="主题">
            <Seg value={s.theme} onChange={S("theme")} options={[{ id: "system", name: "跟随系统" }, { id: "light", name: "浅色" }, { id: "dark", name: "深色" }]} />
          </Row>
          <Row label="正文字号">
            <Stepper value={s.fontSize} min={11} max={26} onChange={S("fontSize")} />
          </Row>
          <Row label="页面宽度">
            <Seg value={s.pageWidth} onChange={S("pageWidth")} options={[{ id: "normal", name: "适中" }, { id: "wide", name: "宽" }, { id: "full", name: "铺满" }]} />
          </Row>
          <Row label="保留 CHM 原样式">
            <Switch value={s.originalStyle} onChange={S("originalStyle")} />
          </Row>

          <h4>代码</h4>
          <Row label="字体">
            <Select value={s.codeFont} onChange={S("codeFont")} options={FONTS} />
          </Row>
          <Row label="字号">
            <Stepper value={s.codeFontSize} min={10} max={24} onChange={S("codeFontSize")} />
          </Row>
          <Row label="浅色配色">
            <Select value={s.codeThemeLight} onChange={S("codeThemeLight")} options={CODE_THEMES_LIGHT} />
          </Row>
          <Row label="深色配色">
            <Select value={s.codeThemeDark} onChange={S("codeThemeDark")} options={CODE_THEMES_DARK} />
          </Row>
          <Row label="行号">
            <Switch value={s.lineNumbers} onChange={S("lineNumbers")} />
          </Row>
          <Row label="自动换行">
            <Switch value={s.wrap} onChange={S("wrap")} />
          </Row>

          <h4>SQL</h4>
          <Row label="方言">
            <Select value={s.dialect} onChange={S("dialect")} options={[{ id: "auto", name: "自动识别" }, ...DIALECTS] as { id: Settings["dialect"]; name: string }[]} />
          </Row>
          {s.dialect === "auto" && (
            <Row label="识别不出时">
              <Select value={s.fallbackDialect} onChange={S("fallbackDialect")} options={DIALECTS} />
            </Row>
          )}
          <Row label="关键字大写">
            <Switch value={s.upperKeywords} onChange={S("upperKeywords")} />
          </Row>
          <Row label="打开时自动格式化">
            <Switch value={s.autoFormat} onChange={S("autoFormat")} />
          </Row>

          <h4>关于</h4>
          <Row label="版本">
            <span className="muted">{info?.version}</span>
            <button
              className="btn sm"
              onClick={async () => {
                setUpd("检查中…");
                try {
                  const found = await checkUpdate(true);
                  setUpd(found ? `发现 ${found}` : "已是最新");
                } catch (e) {
                  setUpd(errText(e));
                }
              }}
            >
              检查更新
            </button>
            {upd && <span className="muted">{upd}</span>}
          </Row>
          <Row label="数据">
            <button className="btn sm" onClick={() => info && revealItemInDir(info.data_dir + "/data.db").catch(() => undefined)}>
              在访达中显示
            </button>
          </Row>
        </div>
      </div>
    </div>
  );
}

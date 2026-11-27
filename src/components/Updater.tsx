import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { errText } from "../api";

type State = { kind: "idle" } | { kind: "ready"; update: Update } | { kind: "loading"; pct: number | null } | { kind: "error"; msg: string };

export async function checkUpdate(announce: boolean) {
  const u = await check({ timeout: 20000 });
  if (u && announce) window.dispatchEvent(new CustomEvent("ez-update", { detail: u }));
  return u?.version ?? null;
}

export default function Updater() {
  const [st, setSt] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const run = () =>
      check({ timeout: 20000 })
        .then((u) => u && setSt((s) => (s.kind === "idle" ? { kind: "ready", update: u } : s)))
        .catch(() => undefined);
    const first = window.setTimeout(run, 5000);
    const every = window.setInterval(run, 6 * 3600 * 1000);
    const manual = (e: Event) => setSt({ kind: "ready", update: (e as CustomEvent<Update>).detail });
    window.addEventListener("ez-update", manual);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.removeEventListener("ez-update", manual);
    };
  }, []);

  if (st.kind === "idle") return null;

  const install = async (u: Update) => {
    let total = 0;
    let got = 0;
    setSt({ kind: "loading", pct: null });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setSt({ kind: "loading", pct: total ? Math.round((got / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (e) {
      setSt({ kind: "error", msg: errText(e) });
    }
  };

  return (
    <div className="updater">
      {st.kind === "ready" && (
        <>
          <div className="strong">新版本 {st.update.version}</div>
          <div className="row-btns">
            <button className="btn primary sm" onClick={() => install(st.update)}>
              更新
            </button>
            <button className="btn sm" onClick={() => setSt({ kind: "idle" })}>
              稍后
            </button>
          </div>
        </>
      )}
      {st.kind === "loading" && <div>更新中{st.pct != null ? ` ${st.pct}%` : "…"}</div>}
      {st.kind === "error" && (
        <>
          <div className="red">更新失败：{st.msg}</div>
          <button className="btn sm" onClick={() => setSt({ kind: "idle" })}>
            关闭
          </button>
        </>
      )}
    </div>
  );
}

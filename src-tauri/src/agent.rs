use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default, Clone)]
pub struct Runs(Arc<Mutex<HashMap<u64, Arc<Mutex<Child>>>>>);

#[derive(Serialize, Clone)]
struct Ev {
    id: u64,
    kind: &'static str,
    text: String,
}

#[derive(Serialize)]
pub struct AgentInfo {
    path: Option<String>,
    version: Option<String>,
}

fn candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(h) = dirs::home_dir() {
        v.push(h.join(".local/bin/claude"));
        v.push(h.join(".claude/local/claude"));
        v.push(h.join(".npm-global/bin/claude"));
        v.push(h.join(".volta/bin/claude"));
        v.push(h.join(".bun/bin/claude"));
    }
    v.push(PathBuf::from("/opt/homebrew/bin/claude"));
    v.push(PathBuf::from("/usr/local/bin/claude"));
    v
}

fn locate(custom: &str) -> Option<String> {
    let c = custom.trim();
    if !c.is_empty() {
        return Some(c.to_string());
    }
    for p in candidates() {
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    let out = Command::new("/bin/zsh").args(["-lc", "command -v claude"]).stdin(Stdio::null()).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && s.starts_with('/')).then_some(s)
}

fn shell(bin: &str, script: &str, envs: &[(&str, &str)], dir: &PathBuf) -> Command {
    let mut cmd = Command::new("/bin/zsh");
    cmd.args(["-lc", script]).env("EZ_BIN", bin).current_dir(dir);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd
}

fn workdir() -> PathBuf {
    let d = dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Ezchm").join("agent");
    let _ = std::fs::create_dir_all(&d);
    d
}

#[tauri::command]
pub async fn agent_info(path: String) -> Result<AgentInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(bin) = locate(&path) else {
            return AgentInfo { path: None, version: None };
        };
        let version = shell(&bin, "exec \"$EZ_BIN\" --version", &[], &workdir())
            .stdin(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
        AgentInfo { path: Some(bin), version }
    })
    .await
    .map_err(|e| e.to_string())
}

fn emit(app: &AppHandle, id: u64, kind: &'static str, text: impl Into<String>) {
    let _ = app.emit("ezchm-agent", Ev { id, kind, text: text.into() });
}

fn handle_line(app: &AppHandle, id: u64, line: &str, streamed: &mut bool, final_text: &mut Option<String>) {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return };
    match v.get("type").and_then(|t| t.as_str()) {
        Some("system") => {
            if let Some(s) = v.get("session_id").and_then(|x| x.as_str()) {
                emit(app, id, "session", s);
            }
        }
        Some("stream_event") => {
            let ev = &v["event"];
            if ev["type"] == "message_start" && *streamed {
                emit(app, id, "delta", "\n\n");
            } else if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                if let Some(t) = ev["delta"]["text"].as_str() {
                    *streamed = true;
                    emit(app, id, "delta", t);
                }
            } else if ev["type"] == "content_block_start" && ev["content_block"]["type"] == "tool_use" {
                if let Some(n) = ev["content_block"]["name"].as_str() {
                    emit(app, id, "tool", n);
                }
            }
        }
        Some("assistant") => {
            if *streamed {
                return;
            }
            if let Some(arr) = v["message"]["content"].as_array() {
                for c in arr {
                    if c["type"] == "text" {
                        if let Some(t) = c["text"].as_str() {
                            emit(app, id, "delta", t);
                        }
                    }
                }
            }
        }
        Some("result") => {
            if let Some(s) = v.get("session_id").and_then(|x| x.as_str()) {
                emit(app, id, "session", s);
            }
            let text = v.get("result").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false) {
                emit(app, id, "error", if text.is_empty() { "Claude Code 返回了错误".to_string() } else { text });
                *final_text = Some(String::new());
            } else {
                *final_text = Some(text);
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn agent_run(app: AppHandle, runs: State<'_, Runs>, id: u64, prompt: String, path: String, model: String, session: Option<String>) -> Result<(), String> {
    let bin = locate(&path).ok_or("没有找到本机的 Claude Code。安装后重开 Ezchm，或在设置里填写 claude 的路径。")?;
    let mut script = String::from("exec \"$EZ_BIN\" -p --output-format stream-json --verbose --include-partial-messages");
    if !model.trim().is_empty() {
        script.push_str(" --model \"$EZ_MODEL\"");
    }
    if session.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
        script.push_str(" --resume \"$EZ_SESSION\"");
    }
    let sess = session.unwrap_or_default();
    let mut child = shell(&bin, &script, &[("EZ_MODEL", model.trim()), ("EZ_SESSION", &sess)], &workdir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动失败：{}", e))?;
    let mut stdin = child.stdin.take().ok_or("无法写入")?;
    let stdout = child.stdout.take().ok_or("无法读取")?;
    let mut stderr = child.stderr.take().ok_or("无法读取")?;
    let child = Arc::new(Mutex::new(child));
    runs.0.lock().map_err(|e| e.to_string())?.insert(id, child.clone());
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });
    let err_buf = Arc::new(Mutex::new(String::new()));
    let eb = err_buf.clone();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        if let Ok(mut b) = eb.lock() {
            *b = s;
        }
    });
    let map = runs.0.clone();
    std::thread::spawn(move || {
        let mut streamed = false;
        let mut final_text: Option<String> = None;
        let mut raw = String::new();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let t = line.trim();
            if t.is_empty() {
                continue;
            }
            if !t.starts_with('{') && raw.len() < 4000 {
                raw.push_str(t);
                raw.push('\n');
            }
            handle_line(&app, id, t, &mut streamed, &mut final_text);
        }
        let status = child.lock().ok().and_then(|mut c| c.wait().ok());
        let killed = map.lock().ok().map(|mut m| m.remove(&id).is_none()).unwrap_or(false);
        std::thread::sleep(std::time::Duration::from_millis(30));
        if killed {
            emit(&app, id, "done", "");
            return;
        }
        match final_text {
            Some(t) => {
                if !streamed && !t.is_empty() {
                    emit(&app, id, "final", t);
                }
                emit(&app, id, "done", "");
            }
            None => {
                let e = err_buf.lock().map(|s| s.trim().to_string()).unwrap_or_default();
                let msg = if !e.is_empty() { e } else if !raw.trim().is_empty() { raw.trim().to_string() } else { format!("Claude Code 意外退出（{}）", status.map(|s| s.to_string()).unwrap_or_default()) };
                emit(&app, id, "error", msg.chars().take(600).collect::<String>());
                emit(&app, id, "done", "");
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn agent_stop(runs: State<'_, Runs>, id: u64) -> Result<(), String> {
    let c = runs.0.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(c) = c {
        if let Ok(mut c) = c.lock() {
            let _ = c.kill();
        }
    }
    Ok(())
}

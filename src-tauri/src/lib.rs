mod agent;
mod chm;
mod db;
mod files;
mod text;

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::http::{Response, StatusCode};
use tauri::{Manager, State};

pub struct AppState {
    conn: Mutex<rusqlite::Connection>,
    data_dir: PathBuf,
}

#[derive(Default)]
pub struct Books {
    next: AtomicU64,
    by_id: Mutex<HashMap<String, Arc<chm::Book>>>,
    by_path: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct Pending(Mutex<Vec<String>>);

struct StartupError(Option<String>);

fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".ezchm"))
        .join("Ezchm")
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn startup_error(state: State<'_, StartupError>) -> Option<String> {
    state.0.clone()
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    data_dir: String,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
fn settings_all(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    db::settings(&*state.conn.lock().map_err(err)?).map_err(err)
}

#[tauri::command]
fn setting_set(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    db::set_setting(&*state.conn.lock().map_err(err)?, &key, &value).map_err(err)
}

#[tauri::command]
fn items_list(state: State<'_, AppState>) -> Result<Vec<db::Item>, String> {
    db::items(&*state.conn.lock().map_err(err)?).map_err(err)
}

#[tauri::command]
fn item_get(state: State<'_, AppState>, path: String) -> Result<Option<db::Item>, String> {
    db::item(&*state.conn.lock().map_err(err)?, &path).map_err(err)
}

#[tauri::command]
fn item_touch(state: State<'_, AppState>, path: String, kind: String, title: String) -> Result<(), String> {
    db::touch(&*state.conn.lock().map_err(err)?, &path, &kind, &title).map_err(err)
}

#[tauri::command]
fn item_progress(state: State<'_, AppState>, path: String, page: String, scroll: f64) -> Result<(), String> {
    db::progress(&*state.conn.lock().map_err(err)?, &path, &page, scroll).map_err(err)
}

#[tauri::command]
fn item_remove(state: State<'_, AppState>, path: String) -> Result<(), String> {
    db::remove_item(&*state.conn.lock().map_err(err)?, &path).map_err(err)
}

#[tauri::command]
fn bookmarks_list(state: State<'_, AppState>, item: String) -> Result<Vec<db::Bookmark>, String> {
    db::bookmarks(&*state.conn.lock().map_err(err)?, &item).map_err(err)
}

#[tauri::command]
fn bookmark_add(state: State<'_, AppState>, item: String, page: String, title: String, scroll: f64) -> Result<i64, String> {
    db::add_bookmark(&*state.conn.lock().map_err(err)?, &item, &page, &title, scroll).map_err(err)
}

#[tauri::command]
fn bookmark_delete(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    db::delete_bookmark(&*state.conn.lock().map_err(err)?, id).map_err(err)
}

#[derive(Serialize)]
struct BookInfo {
    id: String,
    path: String,
    title: String,
    home: String,
    toc: Vec<chm::TocNode>,
    index: Vec<chm::IndexItem>,
}

fn get_book(books: &Books, id: &str) -> Result<Arc<chm::Book>, String> {
    books
        .by_id
        .lock()
        .map_err(err)?
        .get(id)
        .cloned()
        .ok_or_else(|| "文件已关闭".to_string())
}

#[tauri::command(async)]
fn chm_open(books: State<'_, Books>, path: String) -> Result<BookInfo, String> {
    let existing = books.by_path.lock().map_err(err)?.get(&path).cloned();
    let (id, book) = match existing.and_then(|id| get_book(&books, &id).ok().map(|b| (id, b))) {
        Some(x) => x,
        None => {
            let book = Arc::new(chm::Book::open(Path::new(&path))?);
            let id = format!("b{}", books.next.fetch_add(1, Ordering::SeqCst) + 1);
            books.by_id.lock().map_err(err)?.insert(id.clone(), book.clone());
            books.by_path.lock().map_err(err)?.insert(path.clone(), id.clone());
            (id, book)
        }
    };
    let warm = book.clone();
    std::thread::spawn(move || {
        warm.search_docs();
    });
    Ok(BookInfo {
        id,
        path,
        title: book.title.clone(),
        home: book.home.clone(),
        toc: book.toc.clone(),
        index: book.index.clone(),
    })
}

#[derive(Serialize)]
struct Page {
    path: String,
    html: String,
}

#[tauri::command(async)]
fn chm_page(books: State<'_, Books>, id: String, path: String) -> Result<Page, String> {
    let book = get_book(&books, &id)?;
    let p = chm::norm(&path);
    let bare = p.split('#').next().unwrap_or("").to_string();
    let real = book.resolve(&bare).ok_or_else(|| format!("找不到页面 {}", bare))?;
    let html = book.read_text(&real).ok_or_else(|| format!("读取失败 {}", real))?;
    Ok(Page { path: real, html })
}

#[tauri::command(async)]
fn chm_search(books: State<'_, Books>, id: String, query: String) -> Result<Vec<chm::SearchHit>, String> {
    let book = get_book(&books, &id)?;
    let docs = book.search_docs();
    let mut titles = HashMap::new();
    chm::flatten_titles(&book.toc, &mut titles);
    Ok(chm::search(&docs, &titles, &query, 300))
}

#[tauri::command]
fn chm_close(books: State<'_, Books>, id: String) -> Result<(), String> {
    books.by_id.lock().map_err(err)?.remove(&id);
    books.by_path.lock().map_err(err)?.retain(|_, v| v != &id);
    Ok(())
}

#[tauri::command(async)]
fn file_read(path: String) -> Result<files::TextFile, String> {
    files::read_text(&path)
}

#[tauri::command(async)]
fn file_write(path: String, text: String, encoding: String) -> Result<(), String> {
    files::write_text(&path, &text, &encoding)
}

#[tauri::command]
fn edits_list(state: State<'_, AppState>, item: String, page: String) -> Result<Vec<db::CodeEdit>, String> {
    db::edits(&*state.conn.lock().map_err(err)?, &item, &page).map_err(err)
}

#[tauri::command]
fn edit_save(state: State<'_, AppState>, item: String, page: String, idx: i64, hash: String, text: Option<String>) -> Result<(), String> {
    db::save_edit(&*state.conn.lock().map_err(err)?, &item, &page, idx, &hash, text.as_deref()).map_err(err)
}

#[tauri::command(async)]
fn dir_list(path: String) -> Result<Vec<files::DirEntry>, String> {
    files::list_dir(&path)
}

#[tauri::command]
fn path_kind(path: String) -> String {
    let p = Path::new(&path);
    if p.is_dir() {
        "folder".into()
    } else if path.to_lowercase().ends_with(".chm") {
        "chm".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "missing".into()
    }
}

#[tauri::command]
fn take_opened(pending: State<'_, Pending>) -> Vec<String> {
    pending.0.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

fn mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "htm" | "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "text/javascript",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn serve(app: &tauri::AppHandle, uri_path: &str) -> Response<Vec<u8>> {
    let decoded = percent_encoding::percent_decode_str(uri_path).decode_utf8_lossy().into_owned();
    let trimmed = decoded.trim_start_matches('/');
    let (id, rest) = match trimmed.find('/') {
        Some(i) => (&trimmed[..i], &trimmed[i..]),
        None => (trimmed, "/"),
    };
    let books = app.state::<Books>();
    let found = get_book(&books, id).ok().and_then(|b| {
        let p = chm::norm(rest);
        let real = b.resolve(&p)?;
        let mut bytes = b.read_raw(&real)?;
        if real.to_ascii_lowercase().ends_with(".css") {
            bytes = b.decode(&bytes).into_bytes();
        }
        Some((real, bytes))
    });
    match found {
        Some((p, bytes)) => Response::builder()
            .header("Content-Type", mime(&p))
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "max-age=3600")
            .body(bytes)
            .unwrap(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = data_dir();
    let (conn, startup) = match db::open(&dir) {
        Ok(c) => (c, None),
        Err(e) => (rusqlite::Connection::open_in_memory().expect("memory db"), Some(e)),
    };
    if startup.is_none() {
        let _ = db::daily_backup(&conn, &dir);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState { conn: Mutex::new(conn), data_dir: dir })
        .manage(Books::default())
        .manage(Pending::default())
        .manage(agent::Runs::default())
        .manage(StartupError(startup))
        .register_asynchronous_uri_scheme_protocol("chm", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(serve(&app, &path)));
        })
        .invoke_handler(tauri::generate_handler![
            startup_error,
            app_info,
            settings_all,
            setting_set,
            items_list,
            item_get,
            item_touch,
            item_progress,
            item_remove,
            bookmarks_list,
            bookmark_add,
            bookmark_delete,
            chm_open,
            chm_page,
            chm_search,
            chm_close,
            file_read,
            file_write,
            edits_list,
            edit_save,
            dir_list,
            path_kind,
            take_opened,
            agent::agent_info,
            agent::agent_run,
            agent::agent_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            use tauri::Emitter;
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            if let Ok(mut v) = _handle.state::<Pending>().0.lock() {
                v.extend(paths);
            }
            let _ = _handle.emit("ezchm-opened", ());
        }
    });
}

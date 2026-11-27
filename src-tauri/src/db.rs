use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const MIGRATIONS: &[&str] = &[
    r#"
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE items (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    added_at TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    page TEXT,
    scroll REAL NOT NULL DEFAULT 0
);
CREATE INDEX items_opened ON items(opened_at);
CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    page TEXT NOT NULL,
    title TEXT NOT NULL,
    scroll REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX bookmarks_item ON bookmarks(item);
"#,
];

pub const DB_FILE: &str = "data.db";

pub fn now() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn backup_dir(data: &Path) -> PathBuf {
    data.join("backups")
}

fn vacuum_into(conn: &Connection, target: &Path) -> rusqlite::Result<()> {
    if target.exists() {
        let _ = fs::remove_file(target);
    }
    conn.execute("VACUUM INTO ?1", params![target.to_string_lossy()])?;
    Ok(())
}

pub fn open(data: &Path) -> Result<Connection, String> {
    fs::create_dir_all(backup_dir(data)).map_err(|e| e.to_string())?;
    let conn = Connection::open(data.join(DB_FILE)).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .map_err(|e| e.to_string())?;
    migrate(&conn, data)?;
    Ok(conn)
}

fn migrate(conn: &Connection, data: &Path) -> Result<(), String> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let target = MIGRATIONS.len() as i64;
    if current > target {
        return Err(format!("数据版本 {} 比当前应用支持的 {} 新，请安装最新版 Ezchm", current, target));
    }
    if current == target {
        return Ok(());
    }
    if current > 0 {
        let stamp = Local::now().format("%Y%m%d-%H%M%S");
        let file = backup_dir(data).join(format!("pre-migrate-v{}-{}.db", current, stamp));
        vacuum_into(conn, &file).map_err(|e| format!("迁移前备份失败：{}", e))?;
        prune(&backup_dir(data), "pre-migrate-", 20);
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let v = i as i64 + 1;
        conn.execute_batch(&format!("BEGIN IMMEDIATE;\n{}\nPRAGMA user_version = {};\nCOMMIT;", sql, v))
            .map_err(|e| {
                let _ = conn.execute_batch("ROLLBACK;");
                format!("数据迁移到 v{} 失败，已回滚：{}", v, e)
            })?;
    }
    Ok(())
}

pub fn daily_backup(conn: &Connection, data: &Path) -> Result<(), String> {
    let dir = backup_dir(data);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("daily-{}.db", Local::now().format("%Y-%m-%d")));
    if file.exists() {
        return Ok(());
    }
    vacuum_into(conn, &file).map_err(|e| e.to_string())?;
    prune(&dir, "daily-", 14);
    Ok(())
}

fn prune(dir: &Path, prefix: &str, keep: usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(prefix) && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    while files.len() > keep {
        let f = files.remove(0);
        let _ = fs::remove_file(f);
    }
}

pub fn settings(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut st = conn.prepare("SELECT key, value FROM settings")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Item {
    pub path: String,
    pub kind: String,
    pub title: String,
    pub opened_at: String,
    pub page: Option<String>,
    pub scroll: f64,
}

pub fn items(conn: &Connection) -> rusqlite::Result<Vec<Item>> {
    let mut st = conn.prepare("SELECT path, kind, title, opened_at, page, scroll FROM items ORDER BY opened_at DESC LIMIT 200")?;
    let rows = st.query_map([], |r| {
        Ok(Item {
            path: r.get(0)?,
            kind: r.get(1)?,
            title: r.get(2)?,
            opened_at: r.get(3)?,
            page: r.get(4)?,
            scroll: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn item(conn: &Connection, path: &str) -> rusqlite::Result<Option<Item>> {
    conn.query_row(
        "SELECT path, kind, title, opened_at, page, scroll FROM items WHERE path = ?1",
        params![path],
        |r| {
            Ok(Item {
                path: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                opened_at: r.get(3)?,
                page: r.get(4)?,
                scroll: r.get(5)?,
            })
        },
    )
    .optional()
}

pub fn touch(conn: &Connection, path: &str, kind: &str, title: &str) -> rusqlite::Result<()> {
    let t = now();
    conn.execute(
        "INSERT INTO items(path, kind, title, added_at, opened_at) VALUES(?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at, title = excluded.title, kind = excluded.kind",
        params![path, kind, title, t],
    )?;
    Ok(())
}

pub fn progress(conn: &Connection, path: &str, page: &str, scroll: f64) -> rusqlite::Result<()> {
    conn.execute("UPDATE items SET page = ?2, scroll = ?3 WHERE path = ?1", params![path, page, scroll])?;
    Ok(())
}

pub fn remove_item(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM items WHERE path = ?1", params![path])?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Bookmark {
    pub id: i64,
    pub item: String,
    pub page: String,
    pub title: String,
    pub scroll: f64,
    pub created_at: String,
}

pub fn bookmarks(conn: &Connection, item: &str) -> rusqlite::Result<Vec<Bookmark>> {
    let mut st = conn.prepare(
        "SELECT id, item, page, title, scroll, created_at FROM bookmarks WHERE item = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = st.query_map(params![item], |r| {
        Ok(Bookmark {
            id: r.get(0)?,
            item: r.get(1)?,
            page: r.get(2)?,
            title: r.get(3)?,
            scroll: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn add_bookmark(conn: &Connection, item: &str, page: &str, title: &str, scroll: f64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO bookmarks(item, page, title, scroll, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![item, page, title, scroll, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_bookmark(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_reopens() {
        let dir = std::env::temp_dir().join(format!("ezchm-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        {
            let c = open(&dir).unwrap();
            touch(&c, "/a.chm", "chm", "A").unwrap();
            progress(&c, "/a.chm", "/x.htm", 0.5).unwrap();
            add_bookmark(&c, "/a.chm", "/x.htm", "X", 0.2).unwrap();
            set_setting(&c, "theme", "dark").unwrap();
        }
        let c = open(&dir).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
        assert_eq!(item(&c, "/a.chm").unwrap().unwrap().page.as_deref(), Some("/x.htm"));
        assert_eq!(bookmarks(&c, "/a.chm").unwrap().len(), 1);
        assert_eq!(settings(&c).unwrap().get("theme").map(|s| s.as_str()), Some("dark"));
        daily_backup(&c, &dir).unwrap();
        assert!(fs::read_dir(backup_dir(&dir)).unwrap().count() >= 1);
        let _ = fs::remove_dir_all(&dir);
    }
}

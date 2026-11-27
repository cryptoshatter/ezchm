use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct TextFile {
    pub path: String,
    pub name: String,
    pub text: String,
    pub encoding: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub dir: bool,
}

const MAX: u64 = 20 * 1024 * 1024;

pub fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(&bytes[3..]).into_owned(), "UTF-8".into());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (encoding_rs::UTF_16LE.decode(bytes).0.into_owned(), "UTF-16LE".into());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (encoding_rs::UTF_16BE.decode(bytes).0.into_owned(), "UTF-16BE".into());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_string(), "UTF-8".into());
    }
    let mut d = chardetng::EncodingDetector::new();
    d.feed(bytes, true);
    let enc = d.guess(Some(b"cn"), true);
    (enc.decode(bytes).0.into_owned(), enc.name().to_string())
}

pub fn read_text(path: &str) -> Result<TextFile, String> {
    let p = Path::new(path);
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > MAX {
        return Err("文件太大".into());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).filter(|b| **b == 0).count() > 0 && !bytes.starts_with(&[0xFF, 0xFE]) && !bytes.starts_with(&[0xFE, 0xFF]) {
        return Err("这不是文本文件".into());
    }
    let (text, encoding) = decode(&bytes);
    Ok(TextFile {
        path: path.to_string(),
        name: p.file_name().and_then(|n| n.to_str()).unwrap_or(path).to_string(),
        text,
        encoding,
        size: meta.len(),
    })
}

pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let mut out: Vec<DirEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(DirEntry { path: e.path().to_string_lossy().into_owned(), name, dir })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

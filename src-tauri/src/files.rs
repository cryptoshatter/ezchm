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
        return (String::from_utf8_lossy(&bytes[3..]).into_owned(), "UTF-8 BOM".into());
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

pub fn write_text(path: &str, text: &str, encoding: &str) -> Result<(), String> {
    let bytes: Vec<u8> = match encoding {
        "UTF-8" | "" => text.as_bytes().to_vec(),
        "UTF-8 BOM" => {
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend_from_slice(text.as_bytes());
            v
        }
        "UTF-16LE" => {
            let mut v = vec![0xFF, 0xFE];
            for u in text.encode_utf16() {
                v.extend_from_slice(&u.to_le_bytes());
            }
            v
        }
        "UTF-16BE" => {
            let mut v = vec![0xFE, 0xFF];
            for u in text.encode_utf16() {
                v.extend_from_slice(&u.to_be_bytes());
            }
            v
        }
        label => {
            let enc = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8);
            let (out, _, bad) = enc.encode(text);
            if bad {
                return Err(format!("有字符无法用 {} 编码保存", label));
            }
            out.into_owned()
        }
    };
    let p = Path::new(path);
    let tmp = p.with_file_name(format!(".{}.ezchm-tmp", p.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(p) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_gbk() {
        let dir = std::env::temp_dir().join(format!("ezchm-f-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.sql");
        let (gbk, _, _) = encoding_rs::GBK.encode("SELECT '中文注释' FROM t");
        fs::write(&f, &gbk).unwrap();
        let t = read_text(f.to_str().unwrap()).unwrap();
        assert_eq!(t.text, "SELECT '中文注释' FROM t");
        write_text(f.to_str().unwrap(), "SELECT '改过' FROM t", &t.encoding).unwrap();
        let back = read_text(f.to_str().unwrap()).unwrap();
        assert_eq!(back.text, "SELECT '改过' FROM t");
        assert_eq!(back.encoding, t.encoding);
        let _ = fs::remove_dir_all(&dir);
    }
}

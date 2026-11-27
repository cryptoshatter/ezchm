use chmlib::{ChmFile, Continuation, Filter};
use encoding_rs::Encoding;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::text;

struct Raw(ChmFile);
unsafe impl Send for Raw {}

pub struct Book {
    raw: Mutex<Raw>,
    pub title: String,
    pub home: String,
    pub toc: Vec<TocNode>,
    pub index: Vec<IndexItem>,
    pub files: Vec<String>,
    lower: HashMap<String, String>,
    pub encoding: &'static Encoding,
    pub search: Mutex<Option<Arc<Vec<SearchDoc>>>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct TocNode {
    pub name: String,
    pub local: Option<String>,
    pub children: Vec<TocNode>,
}

#[derive(Serialize, Clone, Debug)]
pub struct IndexItem {
    pub name: String,
    pub local: Option<String>,
    pub depth: u32,
}

pub struct SearchDoc {
    pub path: String,
    pub title: String,
    pub text: String,
    pub lower: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: u32,
}

pub fn is_html(p: &str) -> bool {
    let l = p.to_ascii_lowercase();
    l.ends_with(".htm") || l.ends_with(".html") || l.ends_with(".xhtml") || l.ends_with(".shtml")
}

fn lcid_encoding(lcid: u32) -> &'static Encoding {
    let lang = lcid & 0x3ff;
    let name = match lang {
        0x04 => match lcid {
            0x0404 | 0x0c04 | 0x1404 => "big5",
            _ => "gb18030",
        },
        0x11 => "shift_jis",
        0x12 => "euc-kr",
        0x19 | 0x22 | 0x23 | 0x02 | 0x1c | 0x2f => "windows-1251",
        0x05 | 0x0e | 0x15 | 0x18 | 0x1a | 0x1b | 0x24 => "windows-1250",
        0x08 => "windows-1253",
        0x1f => "windows-1254",
        0x0d => "windows-1255",
        0x01 | 0x20 | 0x29 => "windows-1256",
        0x25 | 0x26 | 0x27 => "windows-1257",
        0x2a => "windows-1258",
        0x1e => "windows-874",
        _ => "windows-1252",
    };
    Encoding::for_label(name.as_bytes()).unwrap_or(encoding_rs::WINDOWS_1252)
}

fn guess_encoding(bytes: &[u8]) -> &'static Encoding {
    let mut d = chardetng::EncodingDetector::new();
    d.feed(bytes, true);
    d.guess(None, true)
}

impl Book {
    pub fn open(path: &Path) -> Result<Book, String> {
        let mut file = ChmFile::open(path).map_err(|_| "无法打开这个 CHM 文件".to_string())?;
        let mut files = Vec::new();
        let _ = file.for_each(Filter::NORMAL | Filter::FILES, |_, unit| {
            if let Some(p) = unit.path() {
                if let Some(s) = p.to_str() {
                    files.push(s.to_string());
                }
            }
            Continuation::Continue
        });
        let lower = files.iter().map(|f| (f.to_lowercase(), f.clone())).collect::<HashMap<_, _>>();
        let mut book = Book {
            raw: Mutex::new(Raw(file)),
            title: String::new(),
            home: String::new(),
            toc: Vec::new(),
            index: Vec::new(),
            files,
            lower,
            encoding: encoding_rs::WINDOWS_1252,
            search: Mutex::new(None),
        };
        book.load_meta(path);
        Ok(book)
    }

    fn load_meta(&mut self, path: &Path) {
        let mut hhc = None;
        let mut hhk = None;
        let mut home = None;
        let mut title_raw: Option<Vec<u8>> = None;
        let mut lcid = None;
        if let Some(sys) = self.read_raw("/#SYSTEM") {
            let mut i = 4usize;
            while i + 4 <= sys.len() {
                let code = u16::from_le_bytes([sys[i], sys[i + 1]]);
                let len = u16::from_le_bytes([sys[i + 2], sys[i + 3]]) as usize;
                i += 4;
                if i + len > sys.len() {
                    break;
                }
                let data = &sys[i..i + len];
                let cstr = || {
                    let end = data.iter().position(|b| *b == 0).unwrap_or(data.len());
                    data[..end].to_vec()
                };
                match code {
                    0 => hhc = Some(cstr()),
                    1 => hhk = Some(cstr()),
                    2 => home = Some(cstr()),
                    3 => title_raw = Some(cstr()),
                    4 if len >= 4 => lcid = Some(u32::from_le_bytes([data[0], data[1], data[2], data[3]])),
                    _ => {}
                }
                i += len;
            }
        }
        let enc = match lcid {
            Some(l) => lcid_encoding(l),
            None => {
                let sample = self.files.iter().find(|f| f.to_lowercase().ends_with(".hhc")).cloned();
                match sample.and_then(|s| self.read_raw(&s)) {
                    Some(b) => guess_encoding(&b),
                    None => encoding_rs::WINDOWS_1252,
                }
            }
        };
        self.encoding = enc;
        let dec = |b: Vec<u8>| -> String {
            match std::str::from_utf8(&b) {
                Ok(s) => s.to_string(),
                Err(_) => enc.decode(&b).0.into_owned(),
            }
        };
        self.title = title_raw
            .map(dec)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| path.file_stem().and_then(|s| s.to_str()).unwrap_or("CHM").to_string());

        let hhc_path = hhc
            .map(dec)
            .map(|s| norm(&s))
            .filter(|s| self.resolve(s).is_some())
            .or_else(|| self.files.iter().find(|f| f.to_lowercase().ends_with(".hhc")).cloned());
        let hhk_path = hhk
            .map(dec)
            .map(|s| norm(&s))
            .filter(|s| self.resolve(s).is_some())
            .or_else(|| self.files.iter().find(|f| f.to_lowercase().ends_with(".hhk")).cloned());

        if let Some(p) = hhc_path {
            if let Some(s) = self.read_text(&p) {
                self.toc = parse_toc(&s);
            }
        }
        if let Some(p) = hhk_path {
            if let Some(s) = self.read_text(&p) {
                self.index = parse_index(&s);
            }
        }
        if self.toc.is_empty() {
            let mut pages: Vec<&String> = self.files.iter().filter(|f| is_html(f)).collect();
            pages.sort();
            self.toc = pages
                .into_iter()
                .map(|p| TocNode {
                    name: p.trim_start_matches('/').to_string(),
                    local: Some(p.clone()),
                    children: vec![],
                })
                .collect();
        }
        self.home = home
            .map(dec)
            .map(|s| norm(&s))
            .filter(|s| self.resolve(s.split('#').next().unwrap_or("")).is_some())
            .or_else(|| first_local(&self.toc))
            .or_else(|| self.files.iter().find(|f| is_html(f)).cloned())
            .unwrap_or_else(|| "/".into());
    }

    pub fn resolve(&self, p: &str) -> Option<String> {
        if self.lower.contains_key(&p.to_lowercase()) {
            return self.lower.get(&p.to_lowercase()).cloned();
        }
        None
    }

    pub fn read_raw(&self, p: &str) -> Option<Vec<u8>> {
        let real = self.resolve(p).unwrap_or_else(|| p.to_string());
        let mut g = self.raw.lock().ok()?;
        let unit = g.0.find(&real)?;
        let len = unit.length() as usize;
        let mut buf = vec![0u8; len];
        let mut got = 0usize;
        while got < len {
            let n = g.0.read(&unit, got as u64, &mut buf[got..]).ok()?;
            if n == 0 {
                break;
            }
            got += n;
        }
        buf.truncate(got);
        Some(buf)
    }

    pub fn decode(&self, bytes: &[u8]) -> String {
        if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            return String::from_utf8_lossy(&bytes[3..]).into_owned();
        }
        if bytes.starts_with(&[0xFF, 0xFE]) {
            return encoding_rs::UTF_16LE.decode(bytes).0.into_owned();
        }
        let head = &bytes[..bytes.len().min(4096)];
        if let Some(label) = text::meta_charset(head) {
            if let Some(e) = Encoding::for_label(label.as_bytes()) {
                if e != encoding_rs::UTF_8 || std::str::from_utf8(bytes).is_ok() {
                    return e.decode(bytes).0.into_owned();
                }
            }
        }
        if let Ok(s) = std::str::from_utf8(bytes) {
            return s.to_string();
        }
        self.encoding.decode(bytes).0.into_owned()
    }

    pub fn read_text(&self, p: &str) -> Option<String> {
        self.read_raw(p).map(|b| self.decode(&b))
    }

    pub fn search_docs(&self) -> Arc<Vec<SearchDoc>> {
        if let Some(d) = self.search.lock().ok().and_then(|g| g.clone()) {
            return d;
        }
        let mut docs = Vec::new();
        for f in self.files.iter().filter(|f| is_html(f)) {
            if let Some(html) = self.read_text(f) {
                let title = text::html_title(&html).unwrap_or_default();
                let body = text::html_to_text(&html);
                let lower = body.to_lowercase();
                docs.push(SearchDoc { path: f.clone(), title, text: body, lower });
            }
        }
        let docs = Arc::new(docs);
        if let Ok(mut g) = self.search.lock() {
            *g = Some(docs.clone());
        }
        docs
    }
}

pub fn search(docs: &[SearchDoc], titles: &HashMap<String, String>, query: &str, limit: usize) -> Vec<SearchHit> {
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).filter(|t| !t.is_empty()).collect();
    if terms.is_empty() {
        return vec![];
    }
    let mut hits = Vec::new();
    for d in docs {
        let title = titles.get(&d.path.to_lowercase()).cloned().unwrap_or_else(|| d.title.clone());
        let tl = title.to_lowercase();
        let mut score = 0u32;
        let mut first = None;
        let mut ok = true;
        for t in &terms {
            let c = d.lower.matches(t.as_str()).count() as u32;
            let in_title = tl.contains(t.as_str());
            if c == 0 && !in_title {
                ok = false;
                break;
            }
            score += c.min(50) + if in_title { 100 } else { 0 };
            if first.is_none() {
                first = d.lower.find(t.as_str());
            }
        }
        if !ok {
            continue;
        }
        let snippet = snippet(d, first);
        hits.push(SearchHit {
            path: d.path.clone(),
            title: if title.is_empty() { d.path.trim_start_matches('/').to_string() } else { title },
            snippet,
            score,
        });
    }
    hits.sort_by(|a, b| b.score.cmp(&a.score));
    hits.truncate(limit);
    hits
}

fn snippet(d: &SearchDoc, pos: Option<usize>) -> String {
    let src = if d.lower.len() == d.text.len() { &d.text } else { &d.lower };
    let pos = pos.unwrap_or(0).min(src.len());
    let mut start = pos.saturating_sub(60);
    while start > 0 && !src.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (pos + 140).min(src.len());
    while end < src.len() && !src.is_char_boundary(end) {
        end += 1;
    }
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.push_str(&src[start..end]);
    if end < src.len() {
        s.push('…');
    }
    s
}

pub fn flatten_titles(nodes: &[TocNode], out: &mut HashMap<String, String>) {
    for n in nodes {
        if let Some(l) = &n.local {
            let key = l.split('#').next().unwrap_or("").to_lowercase();
            out.entry(key).or_insert_with(|| n.name.clone());
        }
        flatten_titles(&n.children, out);
    }
}

fn first_local(nodes: &[TocNode]) -> Option<String> {
    for n in nodes {
        if n.local.is_some() {
            return n.local.clone();
        }
        if let Some(l) = first_local(&n.children) {
            return Some(l);
        }
    }
    None
}

pub fn norm(local: &str) -> String {
    let mut s = local.trim().replace('\\', "/");
    if let Some(i) = s.find("::") {
        s = s[i + 2..].to_string();
    }
    for p in ["mk:@MSITStore:", "ms-its:", "its:"] {
        if s.to_ascii_lowercase().starts_with(&p.to_ascii_lowercase()) {
            s = s[p.len()..].to_string();
        }
    }
    let s = percent_encoding::percent_decode_str(&s).decode_utf8_lossy().into_owned();
    let mut parts: Vec<&str> = Vec::new();
    let (path, frag) = match s.find('#') {
        Some(i) => (&s[..i], &s[i..]),
        None => (s.as_str(), ""),
    };
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            x => parts.push(x),
        }
    }
    format!("/{}{}", parts.join("/"), frag)
}

struct Entry {
    name: Option<String>,
    local: Option<String>,
}

enum Tok {
    Ul,
    EndUl,
    Item(Entry),
}

fn tokenize(src: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut cur: Option<Entry> = None;
    let b = src.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'<' {
            i += 1;
            continue;
        }
        let end = match src[i..].find('>') {
            Some(e) => i + e,
            None => break,
        };
        let tag = &src[i + 1..end];
        let name: String = tag
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '/' || *c == '!')
            .collect::<String>()
            .to_ascii_lowercase();
        match name.as_str() {
            "ul" | "ol" => out.push(Tok::Ul),
            "/ul" | "/ol" => out.push(Tok::EndUl),
            "object" => cur = Some(Entry { name: None, local: None }),
            "param" => {
                if let Some(e) = cur.as_mut() {
                    let attrs = text::attrs(tag);
                    let n = attrs.get("name").map(|s| s.to_ascii_lowercase());
                    let v = attrs.get("value").cloned();
                    match (n.as_deref(), v) {
                        (Some("name"), Some(v)) if e.name.is_none() => e.name = Some(text::unescape(&v)),
                        (Some("local"), Some(v)) if e.local.is_none() && !v.trim().is_empty() => {
                            e.local = Some(norm(&text::unescape(&v)))
                        }
                        _ => {}
                    }
                }
            }
            "/object" => {
                if let Some(e) = cur.take() {
                    if e.name.is_some() || e.local.is_some() {
                        out.push(Tok::Item(e));
                    }
                }
            }
            _ => {}
        }
        i = end + 1;
    }
    out
}

pub fn parse_toc(src: &str) -> Vec<TocNode> {
    let mut stack: Vec<Vec<TocNode>> = vec![vec![]];
    let mut depth_started = false;
    for t in tokenize(src) {
        match t {
            Tok::Ul => {
                if !depth_started {
                    depth_started = true;
                    continue;
                }
                stack.push(vec![]);
            }
            Tok::EndUl => {
                if stack.len() > 1 {
                    let kids = stack.pop().unwrap();
                    attach(stack.last_mut().unwrap(), kids);
                }
            }
            Tok::Item(e) => {
                let node = TocNode {
                    name: e.name.unwrap_or_else(|| e.local.clone().unwrap_or_default()),
                    local: e.local,
                    children: vec![],
                };
                stack.last_mut().unwrap().push(node);
            }
        }
    }
    while stack.len() > 1 {
        let kids = stack.pop().unwrap();
        attach(stack.last_mut().unwrap(), kids);
    }
    stack.pop().unwrap_or_default()
}

fn attach(parent: &mut Vec<TocNode>, kids: Vec<TocNode>) {
    match parent.last_mut() {
        Some(last) => last.children.extend(kids),
        None => parent.extend(kids),
    }
}

pub fn parse_index(src: &str) -> Vec<IndexItem> {
    let mut out = Vec::new();
    let mut depth: i32 = -1;
    for t in tokenize(src) {
        match t {
            Tok::Ul => depth += 1,
            Tok::EndUl => depth -= 1,
            Tok::Item(e) => {
                if let Some(name) = e.name {
                    out.push(IndexItem { name, local: e.local, depth: depth.max(0) as u32 });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toc_tree() {
        let src = r#"<HTML><BODY><OBJECT type="text/site properties"></OBJECT>
<UL>
 <LI><OBJECT type="text/sitemap"><param name="Name" value="第一章"><param name="Local" value="ch1\index.htm"></OBJECT>
 <UL>
  <LI><OBJECT type="text/sitemap"><param name="Name" value="1.1 &amp; 小节"><param name="Local" value="ch1/s1.htm#a"></OBJECT>
 </UL>
 <LI><OBJECT type="text/sitemap"><param name="Name" value="第二章"><param name="Local" value="ms-its:x.chm::/ch2/../ch2.htm"></OBJECT>
</UL></BODY></HTML>"#;
        let t = parse_toc(src);
        assert_eq!(t.len(), 2);
        assert_eq!(t[0].local.as_deref(), Some("/ch1/index.htm"));
        assert_eq!(t[0].children[0].name, "1.1 & 小节");
        assert_eq!(t[0].children[0].local.as_deref(), Some("/ch1/s1.htm#a"));
        assert_eq!(t[1].local.as_deref(), Some("/ch2.htm"));
        let idx = parse_index(src);
        assert_eq!(idx.len(), 3);
        assert_eq!(idx[1].depth, 1);
    }
}


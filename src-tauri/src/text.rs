use std::collections::HashMap;

pub fn attrs(tag: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let s = tag.as_bytes();
    let mut i = 0;
    while i < s.len() && !s[i].is_ascii_whitespace() {
        i += 1;
    }
    while i < s.len() {
        while i < s.len() && (s[i].is_ascii_whitespace() || s[i] == b'/') {
            i += 1;
        }
        let ks = i;
        while i < s.len() && !s[i].is_ascii_whitespace() && s[i] != b'=' && s[i] != b'/' {
            i += 1;
        }
        if ks == i {
            i += 1;
            continue;
        }
        let key = tag[ks..i].to_ascii_lowercase();
        while i < s.len() && s[i].is_ascii_whitespace() {
            i += 1;
        }
        if i < s.len() && s[i] == b'=' {
            i += 1;
            while i < s.len() && s[i].is_ascii_whitespace() {
                i += 1;
            }
            let val;
            if i < s.len() && (s[i] == b'"' || s[i] == b'\'') {
                let q = s[i];
                i += 1;
                let vs = i;
                while i < s.len() && s[i] != q {
                    i += 1;
                }
                val = tag[vs..i].to_string();
                i += 1;
            } else {
                let vs = i;
                while i < s.len() && !s[i].is_ascii_whitespace() {
                    i += 1;
                }
                val = tag[vs..i].to_string();
            }
            out.insert(key, val);
        } else {
            out.insert(key, String::new());
        }
    }
    out
}

pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest[..rest.len().min(12)].find(';');
        match end {
            Some(e) => {
                let ent = &rest[1..e];
                let rep = match ent {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    "copy" => Some('©'),
                    "reg" => Some('®'),
                    _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                        u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32)
                    }
                    _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
                    _ => None,
                };
                match rep {
                    Some(c) => {
                        out.push(c);
                        rest = &rest[e + 1..];
                    }
                    None => {
                        out.push('&');
                        rest = &rest[1..];
                    }
                }
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn meta_charset(head: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(head).to_ascii_lowercase();
    let i = s.find("charset")?;
    let rest = s[i + 7..].trim_start();
    let rest = rest.strip_prefix('=')?.trim_start();
    let rest = rest.trim_start_matches(['"', '\'']);
    let label: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

pub fn html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let s = lower.find("<title")?;
    let gt = lower[s..].find('>')? + s + 1;
    let e = lower[gt..].find("</title")? + gt;
    let t = unescape(html[gt..e].trim());
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

pub fn html_to_text(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<body").unwrap_or(0);
    let b = html.as_bytes();
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = start;
    let mut last = start;
    while i < b.len() {
        if b[i] == b'<' {
            out.push_str(&unescape(&html[last..i]));
            let skip = ["script", "style", "head"]
                .iter()
                .find(|t| {
                    lower[i + 1..].starts_with(*t)
                        && matches!(b.get(i + 1 + t.len()), Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r'))
                });
            if let Some(t) = skip {
                let close = format!("</{}", t);
                i = match lower[i..].find(&close) {
                    Some(e) => i + e,
                    None => b.len(),
                };
            }
            if lower[i..].starts_with("<!--") {
                i = lower[i..].find("-->").map(|e| i + e + 3).unwrap_or(b.len());
                last = i;
                continue;
            }
            match lower[i..].find('>') {
                Some(e) => i += e + 1,
                None => i = b.len(),
            }
            out.push(' ');
            last = i;
        } else {
            i += 1;
        }
    }
    if last < b.len() {
        out.push_str(&unescape(&html[last..]));
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips() {
        let h = "<html><head><title> A &amp; B </title><style>x{}</style></head><body><p>SELECT *&nbsp;FROM t</p><script>var a=1</script><!-- c -->中文</body></html>";
        assert_eq!(html_title(h).as_deref(), Some("A & B"));
        assert_eq!(html_to_text(h), "SELECT * FROM t 中文");
        assert_eq!(meta_charset(b"<meta http-equiv=Content-Type content=\"text/html; charset=gb2312\">").as_deref(), Some("gb2312"));
        let a = attrs("param name=\"Local\" value='a b.htm'");
        assert_eq!(a.get("value").map(|s| s.as_str()), Some("a b.htm"));
    }
}

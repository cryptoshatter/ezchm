const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

export type MdCode = { el: HTMLElement; lang: string; text: string };

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function renderMd(src: string, into: HTMLElement): MdCode[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  const codes: { lang: string; text: string }[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const l = lines[i];
    const f = l.match(/^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/);
    if (f) {
      flush();
      const close = f[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++]);
      i++;
      codes.push({ lang: f[2].toLowerCase(), text: body.join("\n") });
      html.push(`<div class="md-code" data-i="${codes.length - 1}"></div>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const n = Math.min(4, h[1].length + 1);
      html.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      flush();
      html.push("<hr>");
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(
        `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          const sub = m[1].length >= 2;
          items.push(`<li${sub ? ' class="sub"' : ""}>${inline(m[3])}</li>`);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, ` ${inline(lines[i].trim())}</li>`);
          i++;
        } else break;
      }
      html.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*>/.test(l)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      html.push(`<blockquote>${q.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (!l.trim()) {
      flush();
      i++;
      continue;
    }
    para.push(l);
    i++;
  }
  flush();
  into.innerHTML = html.join("");
  return Array.from(into.querySelectorAll<HTMLElement>(".md-code")).map((el) => ({ el, ...codes[Number(el.dataset.i)] }));
}

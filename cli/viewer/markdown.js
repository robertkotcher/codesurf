// A small, safe markdown renderer for answers. Everything is escaped first;
// only https: and cs: (code reference) links are produced.
const escape = (text) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function inline(text) {
  const codes = [];
  let out = escape(text).replace(/`([^`]+)`/g, (_, code) => { codes.push(code); return `\u0000${codes.length - 1}\u0000`; });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const raw = href.replace(/&amp;/g, "&");
    if (raw.startsWith("cs:")) return `<a href="#" class="code-ref" data-ref="${escape(raw.slice(3))}">${label}</a>`;
    if (/^https:\/\//.test(raw)) return `<a href="${escape(raw)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function markdown(source) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [], list = null;
  const flush = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
    if (list) { html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\S*)/);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      html.push(`<pre><code data-language="${escape(fence[1] || "")}">${escape(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    const bullet = line.match(/^\s*[-*]\s+(.*)/), numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (!line.trim()) flush();
    else if (heading) { flush(); html.push(`<h4>${inline(heading[2])}</h4>`); }
    else if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (paragraph.length || (list && list.tag !== tag)) flush();
      list ||= { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
    } else if (list && /^\s+/.test(line)) list.items[list.items.length - 1] += " " + line.trim();
    else { if (list) flush(); paragraph.push(line.trim()); }
  }
  flush();
  return html.join("");
}

/** Parse a cs: reference such as "src/a.ts#L10-L20" or "src/a.ts:10". */
export function parseRef(ref) {
  const match = ref.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?|:(\d+)(?:-(\d+))?)?$/);
  const first = Number(match[2] || match[4] || 0), last = Number(match[3] || match[5] || first);
  return { path: match[1], lines: first ? [first, Math.max(first, last)] : null };
}

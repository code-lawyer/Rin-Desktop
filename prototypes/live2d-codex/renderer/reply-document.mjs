import { marked } from 'marked';

export function webLink(href) {
  try { const url = new URL(href); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

// Only the lexer is used. Model HTML never enters an HTML parser or innerHTML.
export function renderReply(host, source, onLink = () => {}) {
  const doc = host.ownerDocument;
  const node = (tag, text) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const text = (parent, value) => parent.append(doc.createTextNode(value ?? ''));
  function inline(parent, tokens) {
    for (const token of tokens ?? []) {
      let child;
      if (['strong', 'em', 'del'].includes(token.type)) { child = node(token.type); inline(child, token.tokens); }
      else if (token.type === 'codespan') child = node('code', token.text);
      else if (token.type === 'br') child = node('br');
      else if (token.type === 'link') {
        const url = webLink(token.href);
        child = node(url ? 'a' : 'span'); child.title = token.title ?? token.href;
        child.className = url ? 'reply-link' : 'reply-reference'; inline(child, token.tokens);
        if (url) { child.href = url; child.addEventListener('click', event => { event.preventDefault(); onLink(url); }); }
      } else if (token.type === 'image') { child = node('span', token.text || token.href); child.title = token.href; child.className = 'reply-reference'; }
      else if (token.tokens) { inline(parent, token.tokens); continue; }
      else { text(parent, token.type === 'html' ? token.raw : token.text ?? token.raw); continue; }
      parent.append(child);
    }
  }
  function blocks(parent, tokens) {
    for (const token of tokens ?? []) {
      let child;
      if (token.type === 'space' || token.type === 'def') continue;
      if (token.type === 'code') { child = node('pre'); child.className = 'code-block'; child.append(node('code', token.text)); }
      else if (token.type === 'paragraph' || token.type === 'heading') { child = node(token.type === 'heading' ? `h${Math.min(token.depth, 4)}` : 'p'); inline(child, token.tokens); }
      else if (token.type === 'blockquote') { child = node('blockquote'); blocks(child, token.tokens); }
      else if (token.type === 'list') {
        child = node(token.ordered ? 'ol' : 'ul'); if (token.ordered && token.start !== 1) child.start = token.start;
        for (const item of token.items) {
          const li = node('li');
          if (item.task) { const check = node('input'); check.type = 'checkbox'; check.disabled = true; check.checked = item.checked; check.setAttribute('aria-label', item.checked ? '已完成' : '未完成'); li.append(check); }
          blocks(li, item.tokens); child.append(li);
        }
      } else if (token.type === 'table') {
        child = node('div'); child.className = 'table-scroll'; const table = node('table'), head = node('thead'), row = node('tr'), body = node('tbody');
        for (const cell of token.header) { const th = node('th'); inline(th, cell.tokens); row.append(th); }
        head.append(row); table.append(head);
        for (const cells of token.rows) { const tr = node('tr'); for (const cell of cells) { const td = node('td'); inline(td, cell.tokens); tr.append(td); } body.append(tr); }
        table.append(body); child.append(table);
      } else if (token.type === 'hr') child = node('hr');
      else if (token.type === 'text' && token.tokens) { inline(parent, token.tokens); continue; }
      else { text(parent, token.type === 'html' ? token.raw : token.text ?? token.raw); continue; }
      parent.append(child);
    }
  }
  const content = doc.createDocumentFragment();
  blocks(content, marked.lexer(source, { gfm: true, breaks: true }));
  host.replaceChildren(content);
}

// Rich Messages (Bot API 10.1+) — exact port of Python rich.py
// All helpers build plain JSON-serialisable payloads.

import { api } from 'sdk';

export const MAX_BLOCKS = 500;
export const MAX_NESTING = 16;
export const MAX_BUTTONS_PER_BLOCK = 8;

// ── RichText builders ─────────────────────────────────────────────
export const bold = (text) => ({ type: 'bold', text });
export const italic = (text) => ({ type: 'italic', text });
export const underline = (text) => ({ type: 'underline', text });
export const strike = (text) => ({ type: 'strikethrough', text });
export const code = (text) => ({ type: 'code', text });
export const link = (text, url) => ({ type: 'url', text, url });
export const customEmoji = (emojiId, alternative) => ({
  type: 'custom_emoji', custom_emoji_id: String(emojiId), alternative_text: alternative || '',
});

export function iconRich(iconHtml, fallback = '') {
  if (!iconHtml || !iconHtml.includes('tg-emoji')) return null;
  try {
    const emojiId = iconHtml.split('emoji-id="', 2)[1].split('"', 1)[0];
    const alt = iconHtml.split('>', 2)[1].rsplit('</', 1)[0];
    return customEmoji(emojiId, fallback || alt);
  } catch (e) {
    return null;
  }
}

// ── HTML → RichText ───────────────────────────────────────────────
const WRAP_TAGS = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline',
  s: 'strikethrough', strike: 'strikethrough', del: 'strikethrough',
  code: 'code', pre: 'code',
};
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export function stripHtml(text) {
  return decodeEntities(String(text || '').replace(/<[^>]+>/g, ''));
}

export function htmlToRich(text) {
  if (!text) return '';
  const root = [];
  const stack = [root];
  let pos = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    const run = text.slice(pos, m.index);
    if (run) stack[stack.length - 1].push(decodeEntities(run));
    pos = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (closing) { if (stack.length > 1) stack.pop(); continue; }
    if (tag === 'tg-emoji') {
      const eid = attrs.match(/emoji-id="(\d+)"/);
      const end = text.indexOf('</tg-emoji>', pos);
      const inner = end !== -1 ? text.slice(pos, end) : '';
      if (end !== -1) pos = end + '</tg-emoji>'.length;
      if (eid) stack[stack.length - 1].push(customEmoji(eid[1], inner));
      else if (inner) stack[stack.length - 1].push(inner);
      continue;
    }
    if (tag === 'a') {
      const href = attrs.match(/href="([^"]+)"/);
      const node = { __url__: href ? href[1] : '' };
      stack[stack.length - 1].push(node);
      stack.push(node.__kids__ = []);
      continue;
    }
    if (tag === 'blockquote') { stack.push(stack[stack.length - 1]); continue; }
    const kind = WRAP_TAGS[tag];
    if (!kind) { stack.push(stack[stack.length - 1]); continue; }
    const node = { __kind__: kind };
    stack[stack.length - 1].push(node);
    stack.push(node.__kids__ = []);
  }
  const tail = text.slice(pos);
  if (tail) stack[stack.length - 1].push(decodeEntities(tail));
  return renderRich(root);
}

function renderRich(nodes) {
  const out = [];
  for (const node of nodes) {
    if (typeof node === 'string') out.push(node);
    else if ('__url__' in node) {
      const inner = renderRich(node.__kids__ || []) || '';
      out.push({ type: 'url', text: inner, url: node.__url__ });
    } else if ('__kind__' in node) {
      const inner = renderRich(node.__kids__ || []) || '';
      out.push({ type: node.__kind__, text: inner });
    } else out.push(node);
  }
  return out.length === 1 ? out[0] : out;
}

// ── RichBlock builders ────────────────────────────────────────────
export const heading = (text, size = 2) => ({ type: 'heading', text, size: Math.max(1, Math.min(Number(size), 6)) });
export const paragraph = (text) => ({ type: 'paragraph', text });
export const divider = () => ({ type: 'divider' });
export const footer = (text) => ({ type: 'footer', text });
export const blockquote = (blocks, credit) => ({
  type: 'blockquote', blocks: [...blocks], ...(credit ? { credit } : {}),
});
export const details = (summary, blocks, isOpen = false) => ({
  type: 'details', summary, blocks: [...blocks], ...(isOpen ? { is_open: true } : {}),
});
export const listBlock = (items) => ({ type: 'list', items: items.map(b => ({ blocks: [...b] })) });
export function cell(text, { header = false, align = 'left', colspan } = {}) {
  const node = { text, align, valign: 'middle' };
  if (header) node.is_header = true;
  if (colspan) node.colspan = Number(colspan);
  return node;
}
export function table(rows, opts = {}) {
  if (!rows.length) throw new Error('table needs at least one row');
  const width = Math.max(...rows.map(r => r.length));
  if (width > 20) throw new Error(`table has ${width} columns (max 20)`);
  const node = { type: 'table', cells: rows.map(r => [...r]), is_bordered: true, is_striped: true, is_compact: true };
  if (opts.caption !== undefined) node.caption = opts.caption;
  return node;
}

export function button(text, { callback_data, url, style, icon } = {}) {
  if (!callback_data && !url) throw new Error('rich button needs callback_data or url');
  let label = text;
  if (icon) {
    const iconNode = iconRich(icon);
    if (iconNode) {
      const rest = Array.isArray(text) ? [...text] : [text];
      if (rest.length && typeof rest[0] === 'string') rest[0] = ` ${rest[0]}`;
      else rest.unshift(' ');
      label = [iconNode, ...rest];
    }
  }
  const node = { text: label };
  if (['primary', 'success', 'danger', 'link'].includes(style)) node.style = style;
  if (url) node.url = url; else node.callback_data = callback_data;
  if ((callback_data || '').length > 64) throw new Error(`callback_data too long: ${callback_data}`);
  return node;
}

export function buttonsBlock(buttons, align = 'center') {
  const list = [...buttons];
  if (list.length < 1 || list.length > MAX_BUTTONS_PER_BLOCK) {
    throw new Error(`buttons block needs 1-${MAX_BUTTONS_PER_BLOCK} buttons`);
  }
  return { type: 'buttons', buttons: list, align };
}

export function validate(blocks) {
  if (blocks.length > MAX_BLOCKS) throw new Error(`${blocks.length} blocks (max ${MAX_BLOCKS})`);
}

export function unstyle(blocks) {
  return blocks.map(blk => {
    if (blk.type === 'buttons') {
      return { ...blk, buttons: blk.buttons.map(btn => {
        const copy = { ...btn }; delete copy.style; return copy;
      }) };
    }
    return blk;
  });
}

export function hasStyledButtons(blocks) {
  return blocks.some(blk => blk.type === 'buttons' && blk.buttons.some(btn => 'style' in btn));
}

// ── Send / edit helpers (raise on failure, like Python) ───────────
export async function sendRich(chatId, blocks, opts = {}) {
  validate(blocks);
  const payload = { blocks: [...blocks], skip_entity_detection: true };
  const params = { chat_id: chatId, rich_message: payload };
  if (opts.reply_markup !== undefined) params.reply_markup = opts.reply_markup;
  if (opts.disable_notification !== undefined) params.disable_notification = opts.disable_notification;
  return await api.sendRichMessage(params);
}

export async function editRich(chatId, messageId, blocks, opts = {}) {
  validate(blocks);
  const payload = { blocks: [...blocks], skip_entity_detection: true };
  const params = { chat_id: chatId, message_id: messageId, rich_message: payload };
  if (opts.reply_markup !== undefined) params.reply_markup = opts.reply_markup;
  return await api.editMessageText(params);
}

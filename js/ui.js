// DOM + formatting helpers shared by all views. Everything is built with
// textContent / attributes (never innerHTML with API data) to avoid XSS.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  library: '<path d="M5 4v16M10 4v16M15.5 5.5l4.5 14"/>',
  queue: '<path d="M3 6h13M3 12h13M3 18h8M17 15v6l4.5-3z"/>',
  now: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<path d="M6.5 4.5h3.5v15H6.5zM14 4.5h3.5v15H14z"/>',
  next: '<path d="M5 5l10 7-10 7zM18 5v14"/>',
  prev: '<path d="M19 5L9 12l10 7zM6 5v14"/>',
  shuffle: '<path d="M3 6h3c4 0 5 12 9 12h4M3 18h3c1.5 0 2.5-1.5 3.5-3.5M13.5 8.5C14.5 7 15.5 6 18 6h1M17 3l3 3-3 3M17 15l3 3-3 3"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  repeat1: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11 10l1.5-1v6"/>',
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.8 4.5 4.5 0 0 1 20 9.5c0 6.1-8 11-8 11z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  note: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
};
const FILLED = new Set(['play', 'pause', 'next', 'prev']);

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.dataset.icon = name;
  const filled = FILLED.has(name);
  // ICONS holds only static, trusted markup.
  span.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" ` +
    `fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" ` +
    `stroke-width="${filled ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function setIcon(btn, name, size) {
  const cur = btn.firstElementChild;
  if (cur && cur.dataset.icon === name) return;
  btn.replaceChildren(icon(name, size));
}

export function fmtTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// Spotify returns images largest-first; choose the smallest one that is >= min px.
export function pickImg(images, min = 300) {
  if (!images || !images.length) return '';
  const sorted = [...images].filter(i => i && i.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find(i => (i.width || 0) >= min) || sorted[sorted.length - 1] || {}).url || '';
}

export function setArt(wrap, url) {
  if (!wrap) return;
  let img = wrap.querySelector('img');
  if (!url) {
    img?.remove();
    wrap.dataset.src = '';
    return;
  }
  if (wrap.dataset.src === url) return;
  wrap.dataset.src = url;
  if (!img) {
    img = h('img', { alt: '', referrerpolicy: 'no-referrer', onError: () => img.remove() });
    wrap.append(img);
  }
  img.src = url;
}

export function artImg(url, cls = '') {
  const wrap = h('div', { class: 'art ' + cls }, h('span', { class: 'art-fallback' }, icon('note', 20)));
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onError: () => img.remove() });
    wrap.append(img);
  }
  return wrap;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function toast(msg, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  while (host.children.length >= 4) host.firstChild.remove();
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  host.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, 4200);
}

export function decodeHtml(s) {
  if (!s) return '';
  return new DOMParser().parseFromString(s, 'text/html').body.textContent || '';
}

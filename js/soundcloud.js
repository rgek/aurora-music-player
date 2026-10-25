// SoundCloud: driven through the official Widget API (the public API no longer
// issues new app keys), so Aurora can control the embedded player like a native one.
let widget = null;
let apiPromise = null;
let handler = () => {};

export const onEvent = fn => (handler = fn);
export const isOpen = () => !!widget;

function loadApi() {
  apiPromise ||= new Promise((resolve, reject) => {
    if (window.SC?.Widget) return resolve();
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.onload = resolve;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load the SoundCloud player.'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

export const isSoundCloudUrl = u => {
  try {
    const host = new URL(u).hostname;
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
};

export const bigArt = url => (url ? url.replace('-large.', '-t500x500.') : '');

function options(color) {
  return {
    color,
    auto_play: true,
    hide_related: true,
    show_comments: false,
    show_user: true,
    show_reposts: false,
    show_teaser: false,
    visual: false,
  };
}

function bind() {
  const E = window.SC.Widget.Events;
  widget.bind(E.READY, () =>
    widget.getCurrentSound(sound => widget.getSounds(list => handler({ type: 'ready', sound, count: list?.length || 1 }))),
  );
  widget.bind(E.PLAY, () => widget.getCurrentSound(sound => handler({ type: 'play', sound })));
  widget.bind(E.PAUSE, () => handler({ type: 'pause' }));
  widget.bind(E.FINISH, () => handler({ type: 'finish' }));
  widget.bind(E.PLAY_PROGRESS, e => handler({ type: 'progress', position: e.currentPosition }));
  widget.bind(E.ERROR, () => handler({ type: 'error' }));
}

export async function open(url, host, { color = '#ff375f', volume = 0.7 } = {}) {
  await loadApi();
  const opts = options(color);
  if (!widget) {
    const params = new URLSearchParams({ url, ...Object.fromEntries(Object.entries(opts).map(([k, v]) => [k, String(v)])) });
    const iframe = document.createElement('iframe');
    iframe.className = 'sc-frame';
    iframe.title = 'SoundCloud player';
    iframe.allow = 'autoplay';
    iframe.width = '100%';
    iframe.height = '300';
    iframe.src = 'https://w.soundcloud.com/player/?' + params;
    host.replaceChildren(iframe);
    widget = window.SC.Widget(iframe);
    bind();
    widget.bind(window.SC.Widget.Events.READY, () => widget.setVolume(volume * 100));
  } else {
    widget.load(url, opts);
  }
}

export const toggle = () => widget?.toggle();
export const pause = () => widget?.pause();
export const next = () => widget?.next();
export const prev = () => widget?.prev();
export const seek = ms => widget?.seekTo(ms);
export const setVolume = v => widget?.setVolume(v * 100);

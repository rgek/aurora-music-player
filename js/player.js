// The unified player: one "now playing" model fed by either Spotify (Web Playback SDK)
// or SoundCloud (Widget API), a persistent player bar, likes, and media-key support.
import * as store from './store.js';
import * as sp from './spotify.js';
import * as sc from './soundcloud.js';
import { h, icon, setIcon, setArt, fmtTime, pickImg, toast } from './ui.js';

export const hooks = {}; // set by app/views: onStatus, onScReady, onSpTrack
export const spStatus = { state: 'off', kind: '', message: '' };
export const spProfile = { name: '' };

export const now = {
  source: null, // 'spotify' | 'soundcloud'
  uri: '',
  title: '',
  artist: '',
  album: '',
  art: '',
  duration: 0,
  position: 0,
  paused: true,
  shuffle: false,
  repeat: 0, // 0 off, 1 context, 2 track
  stamp: 0,
};

let barEl = null;
let seeking = false;
let seekPos = 0;
let lastUri = '';
let lastPaused = null;
let volBeforeMute = 0.7;

const $$ = sel => document.querySelectorAll(sel);

/* -------------------------------------------------------------- model */

export function livePos() {
  if (now.paused) return now.position;
  const p = now.position + (performance.now() - now.stamp);
  return now.duration ? Math.min(p, now.duration) : p;
}

export function setNow(patch) {
  if (!('position' in patch) && !now.paused) patch = { ...patch, position: livePos() };
  Object.assign(now, patch, { stamp: performance.now() });
  renderPlayer();
}

export function setSpStatus(patch) {
  Object.assign(spStatus, { kind: '', message: '' }, patch);
  hooks.onStatus?.();
}

/* ---------------------------------------------------------- Spotify side */

export function onSpState(state) {
  if (!state) {
    if (now.source === 'spotify') setNow({ paused: true });
    return;
  }
  const t = state.track_window?.current_track;
  if (!t) return;
  // Don't let an idle Spotify device steal the bar while SoundCloud is playing.
  if (state.paused && now.source && now.source !== 'spotify') return;
  setNow({
    source: 'spotify',
    uri: t.uri,
    title: t.name,
    artist: (t.artists || []).map(a => a.name).join(', '),
    album: t.album?.name || '',
    art: pickImg(t.album?.images, 300),
    duration: state.duration,
    position: state.position,
    paused: state.paused,
    shuffle: state.shuffle,
    repeat: state.repeat_mode,
  });
  if (!state.paused) sc.pause();
  hooks.onSpTrack?.(t);
}

export async function startSpotify() {
  if (!sp.loggedIn()) return;
  setSpStatus({ state: 'connecting' });
  try {
    await sp.initPlayer({
      volume: store.get().volume,
      onState: onSpState,
      onStatus: p => {
        if (p.warning) return toast(p.warning);
        setSpStatus(p);
      },
    });
  } catch (e) {
    setSpStatus({ state: 'error', kind: 'init', message: e.message });
  }
  try {
    const me = await sp.api('/me');
    spProfile.name = me?.display_name || '';
    if (me?.display_name && !store.get().name) store.set({ name: me.display_name.split(' ')[0] });
    hooks.onStatus?.();
  } catch (e) {
    if (e.status === 403) {
      setSpStatus({
        state: 'error',
        kind: 'user',
        message: "Spotify won't let this account use your app yet. Add this account's email under User management in your Spotify developer dashboard.",
      });
    }
  }
}

export function disconnectSpotify() {
  sp.logout();
  likes.clear();
  spProfile.name = '';
  if (now.source === 'spotify') setNow({ source: null, uri: '', title: '', artist: '', album: '', art: '', duration: 0, position: 0, paused: true });
  setSpStatus({ state: 'off' });
}

export function needLogin() {
  toast('Connect Spotify first to do that.', 'error');
  location.hash = '#/settings';
}

export async function playSp(opts) {
  if (!sp.loggedIn()) return needLogin();
  sp.activate(); // keep inside the click gesture so browsers allow audio
  try {
    await sp.play(opts);
  } catch (e) {
    toast(e.reason === 'PREMIUM_REQUIRED' ? 'Spotify Premium is required to play music inside Aurora.' : e.message, 'error');
  }
}

/* -------------------------------------------------------- SoundCloud side */

sc.onEvent(ev => {
  switch (ev.type) {
    case 'play': {
      const s = ev.sound || {};
      const uri = s.permalink_url || '';
      sp.pause();
      setNow({
        source: 'soundcloud',
        uri,
        title: s.title || 'SoundCloud',
        artist: s.user?.username || '',
        album: 'SoundCloud',
        art: sc.bigArt(s.artwork_url || s.user?.avatar_url),
        duration: s.duration || 0,
        position: uri === now.uri ? now.position : 0,
        paused: false,
        shuffle: false,
        repeat: 0,
      });
      break;
    }
    case 'progress':
      if (now.source === 'soundcloud' && !now.paused) Object.assign(now, { position: ev.position, stamp: performance.now() });
      break;
    case 'pause':
      if (now.source === 'soundcloud') setNow({ paused: true });
      break;
    case 'finish':
      if (now.source === 'soundcloud') setNow({ paused: true, position: 0 });
      break;
    case 'ready':
      hooks.onScReady?.(ev);
      break;
    case 'error':
      toast('SoundCloud could not play that link. It may be private or not embeddable.', 'error');
      break;
  }
});

/* ---------------------------------------------------------------- controls */

export const controls = {
  toggle() {
    if (now.source === 'spotify') {
      sp.activate();
      Promise.resolve(sp.toggle()).catch(() => {});
    } else if (now.source === 'soundcloud') sc.toggle();
    else toast('Choose something to play first.');
  },
  next() {
    if (now.source === 'spotify') Promise.resolve(sp.next()).catch(() => {});
    else if (now.source === 'soundcloud') sc.next();
  },
  prev() {
    if (now.source === 'spotify') Promise.resolve(sp.prev()).catch(() => {});
    else if (now.source === 'soundcloud') sc.prev();
  },
  seek(ms) {
    if (now.source === 'spotify') Promise.resolve(sp.seek(ms)).catch(() => {});
    else if (now.source === 'soundcloud') sc.seek(ms);
    setNow({ position: ms });
  },
  shuffle() {
    if (now.source !== 'spotify') return;
    const on = !now.shuffle;
    setNow({ shuffle: on });
    sp.setShuffle(on).catch(e => {
      setNow({ shuffle: !on });
      toast(e.message, 'error');
    });
  },
  repeat() {
    if (now.source !== 'spotify') return;
    const prev = now.repeat;
    const next = (prev + 1) % 3;
    setNow({ repeat: next });
    sp.setRepeat(['off', 'context', 'track'][next]).catch(e => {
      setNow({ repeat: prev });
      toast(e.message, 'error');
    });
  },
  volume(v) {
    store.set({ volume: v });
    sp.setVolume(v);
    sc.setVolume(v);
    renderVolume();
  },
  mute() {
    const v = store.get().volume;
    if (v > 0) {
      volBeforeMute = v;
      controls.volume(0);
    } else controls.volume(volBeforeMute || 0.7);
  },
};

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, f) => {
    try {
      navigator.mediaSession.setActionHandler(a, f);
    } catch {
      /* unsupported action */
    }
  };
  set('play', () => now.paused && controls.toggle());
  set('pause', () => !now.paused && controls.toggle());
  set('nexttrack', controls.next);
  set('previoustrack', controls.prev);
  set('seekto', d => d.seekTime != null && controls.seek(d.seekTime * 1000));
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !now.title) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: now.title,
      artist: now.artist,
      album: now.album,
      artwork: now.art ? [{ src: now.art, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.playbackState = now.paused ? 'paused' : 'playing';
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ likes */

export const likes = new Map(); // uri -> boolean

export async function ensureLikes(uris) {
  if (!sp.loggedIn()) return;
  const need = [...new Set(uris)].filter(u => u && u.startsWith('spotify:track:') && !likes.has(u));
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    try {
      const res = await sp.api('/me/library/contains', { query: { uris: chunk.join(',') } });
      chunk.forEach((u, j) => likes.set(u, !!res?.[j]));
    } catch {
      break; // hearts simply stay empty if this lookup isn't available
    }
  }
  syncLikeButtons();
}

export function syncLikeButtons() {
  $$('[data-like]').forEach(b => {
    const on = likes.get(b.dataset.like) === true;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $$('[data-np-like]').forEach(b => {
    const show = now.source === 'spotify' && !!now.uri;
    b.hidden = !show;
    const on = show && likes.get(now.uri) === true;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

export async function toggleLike(uri) {
  if (!sp.loggedIn()) return needLogin();
  const was = likes.get(uri) === true;
  likes.set(uri, !was);
  syncLikeButtons();
  try {
    await sp.api('/me/library', { method: was ? 'DELETE' : 'PUT', query: { uris: uri } });
    toast(was ? 'Removed from Liked Songs' : 'Saved to Liked Songs', 'ok');
    hooks.onLibraryChange?.();
  } catch (e) {
    likes.set(uri, was);
    syncLikeButtons();
    toast('Could not update your library: ' + e.message, 'error');
  }
}

export function markPlaying() {
  $$('.row[data-uri]').forEach(r => r.classList.toggle('playing', !!now.uri && r.dataset.uri === now.uri));
}

/* ------------------------------------------------------------ rendering */

const sourceLabel = () => (now.source === 'spotify' ? 'Spotify' : now.source === 'soundcloud' ? 'SoundCloud' : 'Aurora');

function ctlRow(big) {
  const sz = big ? 22 : 18;
  const btn = (title, name, fn, data) =>
    h('button', { class: 'iconbtn', title, 'aria-label': title, dataset: data, onClick: fn }, icon(name, sz));
  return h(
    'div',
    { class: 'ctl' + (big ? ' big' : '') },
    btn('Shuffle', 'shuffle', () => controls.shuffle(), { npShuffle: '' }),
    btn('Previous', 'prev', () => controls.prev(), { npPrev: '' }),
    h('button', { class: 'playbtn', title: 'Play / pause', 'aria-label': 'Play or pause', dataset: { npToggle: '' }, onClick: () => controls.toggle() }, icon('play', big ? 26 : 20)),
    btn('Next', 'next', () => controls.next(), { npNext: '' }),
    btn('Repeat', 'repeat', () => controls.repeat(), { npRepeat: '' }),
  );
}

export function seekRow() {
  return h(
    'div',
    { class: 'seekrow' },
    h('span', { dataset: { np: 'pos' } }, '0:00'),
    h('input', { class: 'seek', type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Seek', disabled: true }),
    h('span', { dataset: { np: 'dur' } }, '0:00'),
  );
}

export function volumeRow() {
  return h(
    'div',
    { class: 'volrow' },
    h('button', { class: 'iconbtn', dataset: { npMute: '' }, title: 'Mute', 'aria-label': 'Mute', onClick: () => controls.mute() }, icon('volume', 18)),
    h('input', { class: 'vol', type: 'range', min: '0', max: '100', value: String(Math.round(store.get().volume * 100)), 'aria-label': 'Volume' }),
  );
}

export function likeNowBtn() {
  return h(
    'button',
    { class: 'iconbtn like', hidden: true, title: 'Save to Liked Songs', 'aria-label': 'Like', dataset: { npLike: '' }, onClick: () => now.uri && toggleLike(now.uri) },
    icon('heart', 20),
  );
}

export function nowControls(big) {
  return ctlRow(big);
}

export function npArt(cls) {
  const wrap = h('div', { class: 'art ' + cls, dataset: { npArt: '' } }, h('span', { class: 'art-fallback' }, icon('note', 22)));
  return wrap;
}

export function initPlayerUi(el) {
  barEl = el;
  el.replaceChildren(
    h(
      'div',
      { class: 'pb-track' },
      h('a', { class: 'pb-link', href: '#/now', title: 'Open Now Playing' }, npArt('pb-art'), h('div', { class: 'pb-meta' }, h('div', { class: 'pb-title', dataset: { np: 'title' } }, 'Nothing playing'), h('div', { class: 'pb-artist', dataset: { np: 'artist' } }, 'Pick something to start'))),
      likeNowBtn(),
    ),
    h('div', { class: 'pb-center' }, ctlRow(false), seekRow()),
    h('div', { class: 'pb-right' }, h('span', { class: 'srcpill', dataset: { np: 'source' } }, 'Aurora'), volumeRow()),
    h('div', { class: 'mini-progress' }, h('i')),
  );

  // Delegated slider handling so the bar and the Now Playing page share logic.
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches?.('.seek')) {
      seeking = true;
      seekPos = (Number(t.value) / 1000) * (now.duration || 0);
      updateProgress();
    } else if (t.matches?.('.vol')) controls.volume(Number(t.value) / 100);
  });
  document.addEventListener('change', e => {
    if (e.target.matches?.('.seek') && seeking) {
      seeking = false;
      controls.seek(seekPos);
    }
  });

  setupMediaSession();
  setInterval(updateProgress, 250);
  // Re-sync Spotify's position every few seconds to cancel interpolation drift.
  setInterval(async () => {
    if (now.source === 'spotify' && !now.paused && !seeking) {
      const s = await sp.getState().catch(() => null);
      if (s && !s.paused) setNow({ position: s.position, duration: s.duration });
    }
  }, 5000);
  renderPlayer();
  renderVolume();
}

export function updateProgress() {
  const dur = now.duration || 0;
  const pos = seeking ? seekPos : livePos();
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
  $$('.seek').forEach(r => {
    if (!seeking) r.value = dur ? String(Math.round((pos / dur) * 1000)) : '0';
    r.style.setProperty('--p', pct + '%');
    r.disabled = !dur;
  });
  $$('[data-np=pos]').forEach(e => (e.textContent = fmtTime(pos)));
  $$('[data-np=dur]').forEach(e => (e.textContent = fmtTime(dur)));
  barEl?.style.setProperty('--p', pct + '%');
}

export function renderVolume() {
  const v = store.get().volume;
  $$('.vol').forEach(r => {
    r.value = String(Math.round(v * 100));
    r.style.setProperty('--p', v * 100 + '%');
  });
  $$('[data-np-mute]').forEach(b => setIcon(b, v === 0 ? 'mute' : 'volume', 18));
}

export function renderPlayer() {
  const has = !!now.title;
  $$('[data-np=title]').forEach(e => (e.textContent = has ? now.title : 'Nothing playing'));
  $$('[data-np=artist]').forEach(e => (e.textContent = has ? now.artist : 'Pick something to start'));
  $$('[data-np=album]').forEach(e => (e.textContent = has ? now.album : ''));
  $$('[data-np=source]').forEach(e => (e.textContent = sourceLabel()));
  $$('[data-np-art]').forEach(w => setArt(w, now.art));
  $$('[data-np-toggle]').forEach(b => setIcon(b, now.paused ? 'play' : 'pause', b.closest('.big') ? 26 : 20));
  const spot = now.source === 'spotify';
  $$('[data-np-shuffle]').forEach(b => {
    b.classList.toggle('on', spot && now.shuffle);
    b.disabled = !spot;
  });
  $$('[data-np-repeat]').forEach(b => {
    b.classList.toggle('on', spot && now.repeat > 0);
    b.disabled = !spot;
    setIcon(b, spot && now.repeat === 2 ? 'repeat1' : 'repeat', b.closest('.big') ? 22 : 18);
  });
  barEl?.classList.toggle('empty', !has);
  syncLikeButtons();
  const changed = now.uri !== lastUri;
  if (changed) {
    lastUri = now.uri;
    markPlaying();
    if (spot) ensureLikes([now.uri]);
  }
  if (has && (changed || now.paused !== lastPaused)) updateMediaSession();
  lastPaused = now.paused;
  document.title = has && !now.paused ? `${now.title} · ${now.artist} — Aurora` : 'Aurora — unified music player';
  updateProgress();
}

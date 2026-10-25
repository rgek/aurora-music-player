// Every screen of the app. Each view receives an empty root element to fill.
import * as store from './store.js';
import * as sp from './spotify.js';
import * as sc from './soundcloud.js';
import { h, icon, fmtTime, pickImg, artImg, debounce, toast, decodeHtml } from './ui.js';
import {
  now, hooks, spStatus, spProfile, likes, playSp, needLogin, ensureLikes, toggleLike, markPlaying,
  disconnectSpotify, setSpStatus, startSpotify, npArt, nowControls, seekRow, volumeRow, likeNowBtn, renderPlayer, renderVolume,
} from './player.js';

export const views = {};

/* ---------------------------------------------------------------- helpers */

const skeleton = (n = 4) => h('div', {}, Array.from({ length: n }, () => h('div', { class: 'sk' })));
const emptyState = (title, text, action) => h('div', { class: 'empty-state' }, h('b', {}, title), text ? h('div', {}, text) : null, action || null);

function pageHead(eyebrow, title, right) {
  return h('header', { class: 'pagehead' }, h('div', {}, h('div', { class: 'eyebrow' }, eyebrow), h('h1', {}, title)), right || null);
}

function section(title, sub) {
  const body = h('div');
  return { body, el: h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h3', {}, title), sub ? h('small', {}, sub) : null), body) };
}

function connectCta() {
  const hasId = !!store.get().clientId.trim();
  return h(
    'div',
    { class: 'cta glass' },
    h(
      'div',
      {},
      h('b', {}, hasId ? 'Connect your Spotify account' : 'Set up Spotify'),
      h('p', {}, hasId ? 'Sign in once to browse your playlists, search and play inside Aurora. Playback needs Spotify Premium.' : 'Aurora connects with your own free Spotify developer Client ID. It takes about two minutes.'),
    ),
    hasId
      ? h('button', { class: 'btn accent', onClick: () => sp.login().catch(e => toast(e.message, 'error')) }, 'Connect Spotify')
      : h('a', { class: 'btn accent', href: '#/settings' }, 'Set up Spotify'),
  );
}

function requireSpotify(root) {
  if (sp.loggedIn()) return true;
  root.append(connectCta());
  return false;
}

function inlineError(e, retry) {
  if (e?.status === 401) return connectCta();
  return h(
    'div',
    { class: 'empty-state' },
    h('b', {}, "That didn't load"),
    h('div', {}, e?.message || 'Something went wrong.'),
    retry ? h('button', { class: 'btn ghost sm', style: { marginTop: '14px' }, onClick: retry }, 'Try again') : null,
  );
}

async function fill(body, loader, make, emptyText) {
  body.replaceChildren(skeleton(3));
  try {
    const data = await loader();
    body.replaceChildren(make(data) || emptyState(emptyText || 'Nothing here yet'));
  } catch (e) {
    body.replaceChildren(inlineError(e, () => fill(body, loader, make, emptyText)));
  }
}

function artistLinks(artists) {
  const out = [];
  (artists || []).forEach((a, i) => {
    if (i) out.push(', ');
    out.push(a.id ? h('a', { href: '#/artist/' + a.id }, a.name) : a.name);
  });
  return out;
}

export function normTrack(t) {
  if (!t || t.is_local || !t.uri) return null;
  if (t.type === 'episode') {
    const show = t.show?.name || 'Podcast';
    return { uri: t.uri, id: t.id, name: t.name, artists: [{ name: show }], album: { name: show, images: t.images || t.show?.images || [] }, duration_ms: t.duration_ms };
  }
  return { uri: t.uri, id: t.id, name: t.name, artists: t.artists || [], album: t.album || {}, duration_ms: t.duration_ms };
}

async function queueAdd(t) {
  if (!sp.loggedIn()) return needLogin();
  try {
    await sp.addToQueue(t.uri);
    toast('Added to queue: ' + t.name, 'ok');
  } catch (e) {
    toast(e.status === 404 ? 'Start playing something first, then add to the queue.' : e.message, 'error');
  }
}

function trackRow(t, { onPlay, showAlbum = true }) {
  const album = t.album || {};
  const row = h(
    'div',
    { class: 'row', tabindex: '0', role: 'button', dataset: { uri: t.uri }, 'aria-label': 'Play ' + t.name },
    h('div', { class: 'row-lead' }, artImg(pickImg(album.images, 64), '')),
    h('div', { style: { minWidth: 0 } }, h('div', { class: 'row-title' }, t.name), h('div', { class: 'row-sub' }, artistLinks(t.artists))),
    showAlbum ? h('div', { class: 'row-album' }, album.id ? h('a', { href: '#/album/' + album.id }, album.name) : album.name || '') : h('div'),
    h('button', { class: 'iconbtn like', dataset: { like: t.uri }, title: 'Save to Liked Songs', 'aria-label': 'Like', onClick: e => { e.stopPropagation(); toggleLike(t.uri); } }, icon('heart', 18)),
    h('button', { class: 'iconbtn', title: 'Add to queue', 'aria-label': 'Add to queue', onClick: e => { e.stopPropagation(); queueAdd(t); } }, icon('plus', 18)),
    h('div', { class: 'row-time' }, fmtTime(t.duration_ms)),
  );
  row.addEventListener('click', e => {
    if (!e.target.closest('a,button')) onPlay();
  });
  row.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
      e.preventDefault();
      onPlay();
    }
  });
  return row;
}

// A growable list of tracks. With ctx (a playlist/album URI) plays within that context;
// otherwise queues the visible tracks starting at the clicked one.
function makeTrackList({ ctx = null, showAlbum = true } = {}) {
  const el = h('div', { class: 'tracks' });
  const all = [];
  function add(tracks) {
    const start = all.length;
    tracks.forEach((t, k) => {
      all.push(t);
      const i = start + k;
      el.append(
        trackRow(t, {
          showAlbum,
          onPlay: () => (ctx ? playSp({ context: ctx, offset: { uri: t.uri } }) : playSp({ uris: all.slice(i, i + 100).map(x => x.uri) })),
        }),
      );
    });
    ensureLikes(tracks.map(t => t.uri));
    markPlaying();
  }
  return { el, add, all };
}

// Track list that loads further pages on demand.
function pagedTracks({ ctx, fetchPage, map, markLiked, explainError }) {
  const list = makeTrackList({ ctx });
  const note = h('div');
  const more = h('button', { class: 'btn ghost', style: { display: 'none', margin: '14px auto 0' } }, 'Load more');
  const wrap = h('div', {}, list.el, note, more);
  let offset = 0;
  async function load() {
    more.disabled = true;
    note.replaceChildren();
    try {
      const d = await fetchPage(offset);
      const items = d?.items || [];
      const tracks = items.map(map).filter(Boolean);
      if (markLiked) tracks.forEach(t => likes.set(t.uri, true));
      list.add(tracks);
      offset += items.length;
      more.style.display = items.length && offset < (d.total ?? 0) ? 'flex' : 'none';
      if (!list.all.length) note.replaceChildren(emptyState('No songs here yet'));
    } catch (e) {
      note.replaceChildren(explainError?.(e) || inlineError(e, load));
    }
    more.disabled = false;
  }
  more.addEventListener('click', load);
  load();
  return wrap;
}

function card({ href, img, title, sub, round, onPlay }) {
  const media = h('div', { class: 'card-media' }, h('a', { href, tabindex: '-1', 'aria-hidden': 'true' }, artImg(img, '')));
  if (onPlay) {
    media.append(h('button', { class: 'card-play', title: 'Play', 'aria-label': 'Play ' + title, onClick: e => { e.preventDefault(); e.stopPropagation(); onPlay(); } }, icon('play', 18)));
  }
  return h('div', { class: 'card' + (round ? ' round' : '') }, media, h('a', { class: 'card-link', href }, h('div', { class: 'card-title' }, title), sub ? h('div', { class: 'card-sub' }, sub) : null));
}

const playlistCard = p => card({ href: '#/playlist/' + p.id, img: pickImg(p.images, 300), title: p.name, sub: p.owner?.display_name ? 'By ' + p.owner.display_name : 'Playlist', onPlay: () => playSp({ context: p.uri }) });
const albumCard = a => card({ href: '#/album/' + a.id, img: pickImg(a.images, 300), title: a.name, sub: [a.release_date?.slice(0, 4), (a.artists || []).map(x => x.name).join(', ')].filter(Boolean).join(' · '), onPlay: () => playSp({ context: a.uri }) });
const artistCard = a => card({ href: '#/artist/' + a.id, img: pickImg(a.images, 300), title: a.name, sub: 'Artist', round: true, onPlay: () => playSp({ context: a.uri }) });

function detailHeader({ img, type, title, sub, desc, round, onPlay, onShuffle, extra }) {
  return h(
    'div',
    { class: 'detail glass' + (round ? ' round' : '') },
    artImg(img, ''),
    h(
      'div',
      { style: { minWidth: 0 } },
      h('span', { class: 'pill' }, type),
      h('h1', {}, title),
      sub ? h('p', {}, sub) : null,
      desc ? h('p', { style: { marginTop: '6px', fontSize: '14px' } }, desc) : null,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn accent', onClick: onPlay }, icon('play', 16), 'Play'),
        onShuffle ? h('button', { class: 'btn ghost', onClick: onShuffle }, icon('shuffle', 16), 'Shuffle') : null,
        extra || null,
      ),
    ),
  );
}

async function playShuffled(opts) {
  if (!sp.loggedIn()) return needLogin();
  sp.activate();
  await sp.deviceReady().catch(() => {});
  await sp.setShuffle(true).catch(() => {});
  playSp(opts);
}

/* ------------------------------------------------------------------- Home */

views.home = async root => {
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const name = store.get().name;
  root.append(pageHead(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), `${greet}${name ? ', ' + name : ''}.`));

  if (!sp.loggedIn()) {
    root.append(
      connectCta(),
      h(
        'div',
        { class: 'cta glass', style: { marginTop: '18px' } },
        h('div', {}, h('b', {}, 'Have a link? Play it right now'), h('p', {}, 'Paste any SoundCloud track or set, or a Spotify link, and Aurora plays it. No account needed for SoundCloud.')),
        h('a', { class: 'btn ghost', href: '#/sources' }, 'Open a link'),
      ),
    );
    return;
  }

  const recent = section('Recently played');
  const top = section('Your top tracks', 'Last 4 weeks');
  const lists = section('Your playlists');
  root.append(recent.el, top.el, lists.el);

  fill(
    recent.body,
    () => sp.api('/me/player/recently-played', { query: { limit: 30 } }),
    d => {
      const seen = new Set();
      const tracks = (d?.items || []).map(i => normTrack(i.track)).filter(t => t && !seen.has(t.uri) && seen.add(t.uri));
      if (!tracks.length) return null;
      const l = makeTrackList();
      l.add(tracks.slice(0, 8));
      return l.el;
    },
    'Play something and it will show up here',
  );
  fill(
    top.body,
    () => sp.api('/me/top/tracks', { query: { limit: 10, time_range: 'short_term' } }),
    d => {
      const tracks = (d?.items || []).map(normTrack).filter(Boolean);
      if (!tracks.length) return null;
      const l = makeTrackList();
      l.add(tracks);
      return l.el;
    },
    'Listen a bit more and your favourites will appear here',
  );
  fill(
    lists.body,
    () => sp.api('/me/playlists', { query: { limit: 12 } }),
    d => {
      const items = (d?.items || []).filter(Boolean);
      return items.length ? h('div', { class: 'cards' }, items.map(playlistCard)) : null;
    },
    'No playlists yet',
  );
};

/* ----------------------------------------------------------------- Search */

views.search = async root => {
  root.append(pageHead('Spotify', 'Search'));
  if (!requireSpotify(root)) return;

  const input = h('input', { class: 'field search-input', type: 'search', placeholder: 'Songs, artists, albums, playlists', value: store.get().lastSearch || '', autocomplete: 'off', 'aria-label': 'Search Spotify' });
  const out = h('div');
  root.append(h('div', { class: 'searchbar' }, input), out);
  let seq = 0;

  async function run(q) {
    q = q.trim();
    store.set({ lastSearch: q });
    const mine = ++seq;
    if (!q) return out.replaceChildren(emptyState('Search Spotify', 'Find songs, artists, albums and playlists. For SoundCloud, paste a link on the Links page.'));
    out.replaceChildren(skeleton(5));
    try {
      const r = await sp.api('/search', { query: { q, type: 'track,artist,album,playlist', limit: 10 } });
      if (mine !== seq) return;
      render(r, q);
    } catch (e) {
      if (mine === seq) out.replaceChildren(inlineError(e, () => run(q)));
    }
  }

  function render(r, q) {
    const nodes = [];
    const tracks = (r.tracks?.items || []).map(normTrack).filter(Boolean);
    if (tracks.length) {
      const s = section('Songs');
      const l = makeTrackList();
      l.add(tracks);
      s.body.append(l.el);
      let offset = tracks.length;
      if ((r.tracks?.total || 0) > offset) {
        const more = h('button', { class: 'btn ghost', style: { margin: '14px auto 0', display: 'flex' } }, 'Show more songs');
        more.addEventListener('click', async () => {
          more.disabled = true;
          try {
            const d = await sp.api('/search', { query: { q, type: 'track', limit: 10, offset } });
            const more10 = (d.tracks?.items || []).map(normTrack).filter(Boolean);
            l.add(more10);
            offset += d.tracks?.items?.length || 0;
            if (!more10.length || offset >= (d.tracks?.total || 0)) more.remove();
          } catch (e) {
            toast(e.message, 'error');
          }
          more.disabled = false;
        });
        s.body.append(more);
      }
      nodes.push(s.el);
    }
    const artists = (r.artists?.items || []).filter(Boolean);
    if (artists.length) {
      const s = section('Artists');
      s.body.append(h('div', { class: 'cards' }, artists.map(artistCard)));
      nodes.push(s.el);
    }
    const albums = (r.albums?.items || []).filter(Boolean);
    if (albums.length) {
      const s = section('Albums');
      s.body.append(h('div', { class: 'cards' }, albums.map(albumCard)));
      nodes.push(s.el);
    }
    const lists = (r.playlists?.items || []).filter(Boolean);
    if (lists.length) {
      const s = section('Playlists');
      s.body.append(h('div', { class: 'cards' }, lists.map(playlistCard)));
      nodes.push(s.el);
    }
    out.replaceChildren(...(nodes.length ? nodes : [emptyState('No results', `Nothing found for “${q}”. Try different words.`)]));
  }

  input.addEventListener('input', debounce(() => run(input.value), 350));
  run(input.value);
  requestAnimationFrame(() => input.focus());
};

/* ---------------------------------------------------------------- Library */

let libTab = 'playlists';

views.library = async root => {
  root.append(pageHead('Spotify', 'Your Library'));
  if (!requireSpotify(root)) return;

  const pane = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const defs = [['playlists', 'Playlists'], ['liked', 'Liked Songs'], ['albums', 'Albums']];
  const buttons = defs.map(([id, label]) => h('button', { class: 'chip', role: 'tab', onClick: () => { libTab = id; show(); } }, label));
  tabs.append(...buttons);
  root.append(tabs, h('div', { style: { height: '18px' } }), pane);

  function show() {
    buttons.forEach((b, i) => {
      b.classList.toggle('on', defs[i][0] === libTab);
      b.setAttribute('aria-selected', String(defs[i][0] === libTab));
    });
    pane.replaceChildren();
    if (libTab === 'playlists') {
      fill(pane, () => pageAll('/me/playlists', 50, 4), items => (items.length ? h('div', { class: 'cards' }, items.map(playlistCard)) : null), 'You have no playlists yet');
    } else if (libTab === 'liked') {
      pane.append(
        pagedTracks({
          fetchPage: offset => sp.api('/me/tracks', { query: { limit: 50, offset } }),
          map: i => normTrack(i.track),
          markLiked: true,
        }),
      );
    } else {
      fill(pane, () => pageAll('/me/albums', 50, 4), items => (items.length ? h('div', { class: 'cards' }, items.map(i => albumCard(i.album))) : null), 'No saved albums yet');
    }
  }
  show();
};

async function pageAll(path, limit, maxPages) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    const d = await sp.api(path, { query: { limit, offset: p * limit } });
    const items = (d?.items || []).filter(Boolean);
    out.push(...items);
    if (!d?.next || !items.length) break;
  }
  return out;
}

/* --------------------------------------------------- playlist/album/artist */

views.playlist = async (root, id) => {
  if (!requireSpotify(root)) return;
  root.append(skeleton(2));
  const p = await sp.api('/playlists/' + id, { query: { fields: 'id,name,uri,description,images,owner(display_name)' } });
  root.replaceChildren(
    detailHeader({
      img: pickImg(p.images, 300),
      type: 'Playlist',
      title: p.name,
      sub: p.owner?.display_name ? 'By ' + p.owner.display_name : '',
      desc: decodeHtml(p.description),
      onPlay: () => playSp({ context: p.uri }),
      onShuffle: () => playShuffled({ context: p.uri }),
    }),
    h('div', { style: { height: '14px' } }),
  );
  root.append(
    pagedTracks({
      ctx: p.uri,
      fetchPage: offset => sp.api(`/playlists/${id}/items`, { query: { limit: 50, offset } }),
      map: i => normTrack(i?.item || i?.track),
      explainError: e =>
        e.status === 403
          ? emptyState("Spotify doesn't share this track list", 'Third-party apps can only read tracks of playlists you own or collaborate on. You can still press Play above.')
          : null,
    }),
  );
};

views.album = async (root, id) => {
  if (!requireSpotify(root)) return;
  root.append(skeleton(2));
  const a = await sp.api('/albums/' + id);
  let items = a.tracks?.items || [];
  let next = a.tracks?.next;
  for (let i = 0; next && i < 5; i++) {
    const d = await sp.api(next);
    items = items.concat(d.items || []);
    next = d.next;
  }
  const meta = { id: a.id, name: a.name, images: a.images };
  const tracks = items.map(t => normTrack({ ...t, album: meta })).filter(Boolean);
  root.replaceChildren(
    detailHeader({
      img: pickImg(a.images, 300),
      type: a.album_type === 'single' ? 'Single' : 'Album',
      title: a.name,
      sub: [(a.artists || []).map(x => x.name).join(', '), a.release_date?.slice(0, 4), `${a.total_tracks} songs`].filter(Boolean).join(' · '),
      onPlay: () => playSp({ context: a.uri }),
      onShuffle: () => playShuffled({ context: a.uri }),
    }),
    h('div', { style: { height: '14px' } }),
  );
  const l = makeTrackList({ ctx: a.uri, showAlbum: false });
  l.add(tracks);
  root.append(l.el);
};

views.artist = async (root, id) => {
  if (!requireSpotify(root)) return;
  root.append(skeleton(2));
  const a = await sp.api('/artists/' + id);
  root.replaceChildren(
    detailHeader({
      img: pickImg(a.images, 300),
      type: 'Artist',
      title: a.name,
      round: true,
      sub: (a.genres || []).slice(0, 3).join(' · '),
      onPlay: () => playSp({ context: a.uri }),
      onShuffle: () => playShuffled({ context: a.uri }),
    }),
  );
  const s = section('Albums & singles');
  root.append(s.el);
  fill(
    s.body,
    () => sp.api(`/artists/${id}/albums`, { query: { include_groups: 'album,single', limit: 20 } }),
    d => {
      const items = (d?.items || []).filter(Boolean);
      return items.length ? h('div', { class: 'cards' }, items.map(albumCard)) : null;
    },
    'No releases found',
  );
};

/* ------------------------------------------------------------------ Queue */

views.queue = async root => {
  root.append(pageHead('Up next', 'Queue'));
  if (!requireSpotify(root)) return;
  const body = h('div');
  root.append(body);
  await fill(
    body,
    () => sp.api('/me/player/queue'),
    q => {
      const cur = normTrack(q?.currently_playing);
      const upcoming = (q?.queue || []).map(normTrack).filter(Boolean);
      if (!cur && !upcoming.length) return null;
      const wrap = h('div');
      if (cur) {
        const s = section('Now playing');
        const l = makeTrackList();
        l.add([cur]);
        s.body.append(l.el);
        wrap.append(s.el);
      }
      const s2 = section('Next up', upcoming.length ? `${upcoming.length} songs` : '');
      if (upcoming.length) {
        const l = makeTrackList();
        l.add(upcoming);
        s2.body.append(l.el);
      } else s2.body.append(emptyState('The queue is empty', 'Use the + button next to any song to add it here.'));
      wrap.append(s2.el);
      return wrap;
    },
    'Nothing is playing. Start a song and its queue will appear here.',
  );
};

/* ------------------------------------------------------------ Now Playing */

views.now = async root => {
  root.append(
    pageHead('Now Playing', 'Aurora'),
    h(
      'div',
      { class: 'hero glass' },
      npArt('hero-art'),
      h(
        'div',
        { style: { minWidth: 0 } },
        h('span', { class: 'pill', dataset: { np: 'source' } }, 'Aurora'),
        h('h2', { dataset: { np: 'title' } }, 'Nothing playing'),
        h('div', { class: 'hero-artist', dataset: { np: 'artist' } }, 'Pick something to start'),
        h('div', { class: 'hero-album', dataset: { np: 'album' } }),
        seekRow(),
        nowControls(true),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' } }, likeNowBtn(), h('div', { style: { maxWidth: '280px', flex: 1 } }, volumeRow())),
      ),
    ),
  );
  if (!now.title) {
    root.append(
      h(
        'div',
        { class: 'cta glass', style: { marginTop: '18px' } },
        h('div', {}, h('b', {}, 'Nothing is playing yet'), h('p', {}, 'Search Spotify, browse your library, or paste a SoundCloud link to get started.')),
        h('div', { style: { display: 'flex', gap: '10px' } }, h('a', { class: 'btn accent', href: '#/search' }, 'Search'), h('a', { class: 'btn ghost', href: '#/sources' }, 'Open a link')),
      ),
    );
  }
  renderPlayer();
  renderVolume();
};

/* ------------------------------------------------- Links (SoundCloud etc.) */

let scHost = null;
let scList = null;
let spEmbed = null;
let lastScUrl = '';

function prettyUrl(u) {
  try {
    const seg = new URL(u).pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(seg[seg.length - 1] || 'SoundCloud').replace(/[-_]+/g, ' ');
    return last.charAt(0).toUpperCase() + last.slice(1);
  } catch {
    return 'SoundCloud';
  }
}

function renderSaved() {
  if (!scList) return;
  const saved = store.get().sc;
  if (!saved.length) {
    scList.replaceChildren(h('div', { class: 'hint', style: { padding: '8px 4px' } }, 'Links you open from SoundCloud are remembered here.'));
    return;
  }
  scList.replaceChildren(
    ...saved.map(s =>
      h(
        'div',
        { class: 'row', tabindex: '0', role: 'button', onClick: e => { if (!e.target.closest('button')) openLink(s.url); }, onKeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openLink(s.url); } },
        h('div', { class: 'row-lead' }, artImg(s.art, '')),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'row-title' }, s.title), h('div', { class: 'row-sub' }, s.artist || 'SoundCloud')),
        h('button', { class: 'iconbtn', title: 'Remove', 'aria-label': 'Remove ' + s.title, onClick: () => { store.set({ sc: store.get().sc.filter(x => x.url !== s.url) }); renderSaved(); } }, icon('trash', 18)),
        h('div'),
      ),
    ),
  );
}

hooks.onScReady = ev => {
  if (!lastScUrl) return;
  const s = ev.sound || {};
  const entry = {
    url: lastScUrl,
    title: ev.count > 1 ? prettyUrl(lastScUrl) + ' (set)' : s.title || prettyUrl(lastScUrl),
    artist: s.user?.username || '',
    art: sc.bigArt(s.artwork_url || s.user?.avatar_url),
  };
  store.set({ sc: [entry, ...store.get().sc.filter(x => x.url !== entry.url)].slice(0, 30) });
  renderSaved();
};

export async function openLink(raw) {
  const v = String(raw || '').trim();
  if (!v) return;
  if (sc.isSoundCloudUrl(v)) {
    lastScUrl = v;
    spEmbed.replaceChildren();
    try {
      await sc.open(v, scHost, { color: store.get().accent, volume: store.get().volume });
    } catch (e) {
      toast(e.message, 'error');
    }
    return;
  }
  const ref = sp.parseLink(v);
  if (ref) {
    if (sp.loggedIn() && spStatus.state === 'ready') {
      spEmbed.replaceChildren();
      playSp(ref.type === 'track' || ref.type === 'episode' ? { uris: [ref.uri] } : { context: ref.uri });
      return;
    }
    // Not signed in (or no Premium): fall back to Spotify's own embedded player.
    sc.pause();
    sp.pause();
    spEmbed.replaceChildren(
      h('iframe', {
        src: `https://open.spotify.com/embed/${ref.type}/${ref.id}?utm_source=generator`,
        height: ref.type === 'track' || ref.type === 'episode' ? '152' : '352',
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        loading: 'lazy',
        title: 'Spotify player',
      }),
    );
    toast(sp.loggedIn() ? 'Playing in Spotify’s own player below.' : 'Playing in Spotify’s own player below. Connect Spotify to play inside Aurora.');
    return;
  }
  toast('Paste a link from open.spotify.com or soundcloud.com.', 'error');
}

// Built once and kept alive in the DOM so SoundCloud keeps playing while you browse.
export function buildSourcesPage(page) {
  const input = h('input', { class: 'field', type: 'url', placeholder: 'https://soundcloud.com/… or https://open.spotify.com/…', 'aria-label': 'Music link', autocomplete: 'off' });
  scHost = h('div', { class: 'sc-host glass' }, h('div', { class: 'sc-empty' }, 'The SoundCloud player appears here once you open a link.'));
  spEmbed = h('div', { class: 'sp-embed' });
  scList = h('div', { class: 'saved' });
  page.replaceChildren(
    h('div', { class: 'page' },
      pageHead('SoundCloud & links', 'Open a link'),
      h('form', { class: 'linkform', onSubmit: e => { e.preventDefault(); openLink(input.value); } }, input, h('button', { class: 'btn accent', type: 'submit' }, icon('play', 16), 'Play')),
      h('p', { class: 'hint' }, 'SoundCloud tracks and sets play inside Aurora with full controls. Spotify links play inside Aurora when you are connected with Premium, otherwise through Spotify’s own player.'),
      scHost,
      spEmbed,
      h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h3', {}, 'Saved SoundCloud links')), scList),
    ),
  );
  renderSaved();
}

/* --------------------------------------------------------------- Settings */

const TINTS = [
  ['Rose', '#ff375f'], ['Ocean', '#3478f6'], ['Mint', '#1fb15a'], ['Violet', '#8e5cf6'], ['Amber', '#f08a00'], ['Graphite', '#5b5966'],
];

views.settings = async (root, _arg, rerender) => {
  root.append(pageHead('Preferences', 'Settings'));
  const st = store.get();
  const validOrigin = location.protocol === 'https:' || ['127.0.0.1', '[::1]'].includes(location.hostname);

  /* Spotify */
  const idInput = h('input', { class: 'field', value: st.clientId, placeholder: 'Spotify Client ID (32 characters)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spotify Client ID' });
  const statusText = () => {
    if (!sp.loggedIn()) return ['Not connected', ''];
    if (spStatus.state === 'ready') return [`Connected${spProfile.name ? ' as ' + spProfile.name : ''}. Player ready.`, 'ok'];
    if (spStatus.state === 'error') return [spStatus.message || 'Player error', 'bad'];
    return ['Connected. Starting player…', 'warn'];
  };
  const [stText, stDot] = statusText();

  const saveId = () => {
    const v = idInput.value.trim();
    if (v && !/^[0-9a-f]{32}$/i.test(v)) return toast('A Client ID is 32 letters and numbers. Copy it from your Spotify dashboard.', 'error');
    if (v === st.clientId) return toast('Client ID is already saved.');
    if (sp.loggedIn()) disconnectSpotify();
    store.set({ clientId: v });
    toast('Client ID saved.', 'ok');
    rerender();
  };

  root.append(
    h(
      'section',
      { class: 'panel glass' },
      h('h3', {}, 'Spotify'),
      h('p', { class: 'lead' }, 'Aurora signs in with Spotify directly from your browser using your own free developer app, so no password or secret is ever stored.'),
      h('div', { class: 'formrow', style: { marginBottom: '14px' } }, h('span', { class: 'dot ' + stDot }), h('span', {}, stText)),
      h('div', { class: 'formrow' }, idInput, h('button', { class: 'btn', onClick: saveId }, 'Save')),
      h('div', { style: { marginTop: '14px' } },
        sp.loggedIn()
          ? h('div', { class: 'formrow' },
              h('button', { class: 'btn ghost', onClick: async () => { setSpStatus({ state: 'off' }); await startSpotify(); } }, 'Restart player'),
              h('button', { class: 'btn danger', onClick: () => { disconnectSpotify(); rerender(); } }, 'Disconnect'))
          : h('button', { class: 'btn accent', disabled: !st.clientId.trim() || !validOrigin, onClick: () => sp.login().catch(e => toast(e.message, 'error')) }, 'Connect Spotify')),
      h('div', { class: 'hint', style: { margin: '18px 0 6px', fontWeight: 700 } }, 'Redirect URI to register'),
      h('div', { class: 'formrow' }, h('code', { style: { flex: 1 } }, sp.redirectUri()),
        h('button', { class: 'btn ghost sm', onClick: () => navigator.clipboard?.writeText(sp.redirectUri()).then(() => toast('Copied', 'ok')) }, icon('copy', 15), 'Copy')),
      !validOrigin ? h('p', { class: 'hint', style: { color: '#ff453a', marginTop: '8px' } }, 'Spotify only accepts https:// addresses or http://127.0.0.1. Open Aurora from one of those.') : null,
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Spotify developer dashboard'), ' and create an app.'),
        h('li', {}, 'Choose Web API and Web Playback SDK, and add the Redirect URI above exactly as shown.'),
        h('li', {}, 'Under User management, add the email of every Spotify account that will sign in (up to 5).'),
        h('li', {}, 'Copy the app’s Client ID into the box above, press Save, then Connect.'),
      ),
      h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Playback inside Aurora needs Spotify Premium, and Spotify requires the app owner to have Premium for development apps.'),
    ),
  );

  /* Appearance */
  const swatches = TINTS.map(([name, hex]) =>
    h('button', {
      class: 'swatch' + (st.accent.toLowerCase() === hex ? ' selected' : ''),
      style: { background: hex }, title: name, 'aria-label': name + ' tint',
      onClick: () => { store.set({ accent: hex, accentName: name }); rerender(); },
    }),
  );
  const themeChips = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([id, label]) =>
    h('button', { class: 'chip' + (st.theme === id ? ' on' : ''), onClick: () => { store.set({ theme: id }); rerender(); } }, label),
  );
  const nameInput = h('input', { class: 'field', value: st.name, placeholder: 'Your first name', maxlength: '40', 'aria-label': 'Your name' });
  nameInput.addEventListener('change', () => store.set({ name: nameInput.value.trim() }));

  root.append(
    h('section', { class: 'panel glass' },
      h('h3', {}, 'Appearance'),
      h('p', { class: 'lead' }, 'Make Aurora yours.'),
      h('div', { class: 'hint', style: { marginBottom: '8px', fontWeight: 700 } }, 'Tint'),
      h('div', { class: 'swatches' }, swatches),
      h('div', { class: 'hint', style: { margin: '18px 0 8px', fontWeight: 700 } }, 'Theme'),
      h('div', { class: 'chips' }, themeChips),
      h('div', { class: 'hint', style: { margin: '18px 0 8px', fontWeight: 700 } }, 'Greeting name'),
      nameInput,
    ),
    h('section', { class: 'panel glass' },
      h('h3', {}, 'Keyboard shortcuts'),
      h('div', { class: 'kv', style: { marginTop: '12px' } },
        h('span', {}, h('kbd', {}, 'Space')), h('span', {}, 'Play / pause'),
        h('span', {}, h('kbd', {}, 'Shift'), ' + ', h('kbd', {}, '→')), h('span', {}, 'Next track'),
        h('span', {}, h('kbd', {}, 'Shift'), ' + ', h('kbd', {}, '←')), h('span', {}, 'Previous track'),
        h('span', {}, h('kbd', {}, '/')), h('span', {}, 'Search'),
      ),
    ),
    h('section', { class: 'panel glass' },
      h('h3', {}, 'Data'),
      h('p', { class: 'lead' }, 'Everything stays in this browser. Resetting signs you out and clears saved links and settings.'),
      h('button', { class: 'btn danger', onClick: () => { if (confirm('Reset Aurora and clear all saved data on this device?')) { disconnectSpotify(); store.resetAll(); location.hash = '#/home'; location.reload(); } } }, 'Reset Aurora'),
    ),
  );
};

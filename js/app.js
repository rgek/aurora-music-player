// Aurora entry point: theme, navigation, router and boot sequence.
import * as store from './store.js';
import * as sp from './spotify.js';
import { h, icon, toast } from './ui.js';
import {
  hooks, spStatus, spProfile, controls, initPlayerUi, startSpotify, markPlaying, renderPlayer, renderVolume, setSpStatus,
} from './player.js';
import { views, buildSourcesPage } from './views.js';

const ROUTES = [
  ['home', 'Home', 'home'],
  ['search', 'Search', 'search'],
  ['library', 'Library', 'library'],
  ['queue', 'Queue', 'queue'],
  ['now', 'Now Playing', 'now'],
  ['sources', 'Links', 'link'],
  ['settings', 'Settings', 'settings'],
];
const PARENT = { playlist: 'library', album: 'library', artist: 'library' };

const $ = s => document.querySelector(s);
let currentRoute = 'home';
let renderToken = 0;

/* ---------------------------------------------------------------- theme */

function applyTheme() {
  const { theme, accent } = store.get();
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', accent);
  $('meta[name="theme-color"]')?.setAttribute('content', accent);
}

/* --------------------------------------------------------------- chrome */

function buildNav() {
  $('#nav').replaceChildren(
    ...ROUTES.map(([id, label, ic]) => h('a', { href: '#/' + id, dataset: { route: id }, title: label }, icon(ic, 20), h('span', { class: 'lbl' }, label))),
  );
}

function setActiveNav(route) {
  const target = PARENT[route] || route;
  document.querySelectorAll('#nav a').forEach(a => {
    const on = a.dataset.route === target;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function refreshChrome() {
  // sidebar status
  const connected = sp.loggedIn();
  const cls = !connected ? '' : spStatus.state === 'ready' ? 'ok' : spStatus.state === 'error' ? 'bad' : 'warn';
  const label = !connected ? 'Spotify not connected' : spStatus.state === 'ready' ? `Spotify${spProfile.name ? ': ' + spProfile.name : ' ready'}` : spStatus.state === 'error' ? 'Spotify needs attention' : 'Spotify connecting…';
  const foot = [h('b', {}, h('span', { class: 'dot ' + cls }), label)];
  if (!connected) foot.push(h('a', { class: 'btn ghost sm', href: '#/settings' }, store.get().clientId ? 'Connect' : 'Set up Spotify'));
  $('#sidefoot').replaceChildren(...foot);

  // banner
  const banner = $('#banner');
  if (connected && spStatus.state === 'error') {
    const needsReconnect = spStatus.kind === 'auth';
    banner.replaceChildren(
      h('div', { class: 'banner' + (spStatus.kind === 'user' ? ' bad' : '') },
        h('span', {}, spStatus.message),
        needsReconnect
          ? h('button', { class: 'btn sm', onClick: () => sp.login().catch(e => toast(e.message, 'error')) }, 'Reconnect')
          : h('a', { class: 'btn ghost sm', href: '#/settings' }, 'Settings')),
    );
  } else banner.replaceChildren();
}

hooks.onStatus = () => {
  refreshChrome();
  // Re-render Settings when player status changes, unless the user is typing in it.
  if (currentRoute === 'settings' && !$('#view').contains(document.activeElement)) render();
};

hooks.onSpTrack = () => {
  if (currentRoute === 'queue') queueRefresh();
};
const queueRefresh = (() => {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => currentRoute === 'queue' && render(), 700);
  };
})();

/* --------------------------------------------------------------- router */

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : '' };
}

async function render() {
  const { name, arg } = parseRoute();
  const view = $('#view');
  const page = $('#page-sources');
  const token = ++renderToken;
  currentRoute = name;
  setActiveNav(name);

  if (name === 'sources') {
    view.hidden = true;
    page.classList.remove('offscreen');
    return;
  }
  page.classList.add('offscreen');
  view.hidden = false;

  const root = h('div', { class: 'page' });
  view.replaceChildren(root);
  window.scrollTo(0, 0);
  const fn = views[name] || views.home;
  try {
    await fn(root, arg, () => render());
  } catch (e) {
    if (token !== renderToken) return;
    root.append(
      h('div', { class: 'empty-state' },
        h('b', {}, e?.status === 401 ? 'Connect Spotify to see this' : "That didn't load"),
        h('div', {}, e?.message || 'Something went wrong.'),
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '14px' } },
          h('button', { class: 'btn ghost sm', onClick: () => render() }, 'Try again'),
          h('a', { class: 'btn ghost sm', href: '#/home' }, 'Go home'))),
    );
  }
  if (token === renderToken) {
    markPlaying();
    renderPlayer();
    renderVolume();
  }
}

/* ----------------------------------------------------------------- boot */

function setupShortcuts() {
  addEventListener('keydown', e => {
    const t = e.target;
    if (t.closest?.('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !t.closest?.('button,a,[role="button"]')) {
      e.preventDefault();
      controls.toggle();
    } else if (e.key === '/') {
      e.preventDefault();
      location.hash = '#/search';
    } else if (e.shiftKey && e.key === 'ArrowRight') controls.next();
    else if (e.shiftKey && e.key === 'ArrowLeft') controls.prev();
  });
}

async function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  store.subscribe(applyTheme);

  buildNav();
  initPlayerUi($('#bar'));
  buildSourcesPage($('#page-sources'));
  setupShortcuts();

  try {
    if (await sp.handleRedirect()) toast('Spotify connected', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  }
  refreshChrome();
  if (sp.loggedIn()) startSpotify();
  else setSpStatus({ state: 'off' });

  addEventListener('hashchange', render);
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

// Spotify rejects "localhost" redirect URIs, so always use the loopback IP locally.
if (location.protocol === 'http:' && location.hostname === 'localhost') {
  location.replace(location.href.replace('//localhost', '//127.0.0.1'));
} else {
  boot();
}

// Spotify: Authorization Code + PKCE sign-in (no client secret, safe for a static site),
// a small Web API client, and a wrapper around the Web Playback SDK.
import * as store from './store.js';
import { sleep } from './ui.js';

const AUTH_KEY = 'aurora.sp.auth';
const PKCE_KEY = 'aurora.sp.pkce';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'streaming',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

export class SpotifyError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ auth */

let auth = loadAuth();

function loadAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveAuth() {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

export const loggedIn = () => !!(auth && auth.refresh);

// Must match, character for character, a Redirect URI registered in the Spotify dashboard.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

const b64url = buf =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export async function login() {
  const clientId = store.get().clientId.trim();
  if (!clientId) throw new Error('Add your Spotify Client ID in Settings first.');
  if (!crypto?.subtle) throw new Error('Sign-in needs a secure page (https:// or http://127.0.0.1).');
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + params;
}

// Call once on page load. Returns true if we just completed a sign-in.
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  history.replaceState({}, '', location.pathname + location.hash);
  if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : 'Spotify: ' + q.get('error'));
  let pk = null;
  try {
    pk = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  } catch {
    /* ignore */
  }
  localStorage.removeItem(PKCE_KEY);
  if (!pk || pk.state !== q.get('state')) throw new Error('Sign-in could not be verified. Please try connecting again.');
  await tokenRequest({
    grant_type: 'authorization_code',
    code: q.get('code'),
    redirect_uri: redirectUri(),
    code_verifier: pk.verifier,
  });
  return true;
}

async function tokenRequest(extra) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: store.get().clientId.trim(), ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SpotifyError(data.error_description || data.error || 'Spotify sign-in failed', res.status);
  auth = {
    access: data.access_token,
    refresh: data.refresh_token || auth?.refresh,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveAuth();
}

let refreshing = null;
async function refresh() {
  if (!auth?.refresh) throw new SpotifyError('Not signed in to Spotify', 401);
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh })
    .catch(err => {
      // A rejected refresh token means the session is dead – sign out cleanly.
      if (err.status === 400 || err.status === 401) logout();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function token() {
  if (!auth) return null;
  if (Date.now() >= auth.expires) await refresh();
  return auth?.access || null;
}

export function logout() {
  try {
    player?.disconnect();
  } catch {
    /* ignore */
  }
  player = null;
  device = null;
  readyPromise = null;
  auth = null;
  saveAuth();
  localStorage.removeItem(PKCE_KEY);
}

/* ---------------------------------------------------------------- Web API */

export async function api(path, { method = 'GET', query, body, retry = true } = {}) {
  const t = await token();
  if (!t) throw new SpotifyError('Connect Spotify to use this.', 401);
  const url = new URL(path.startsWith('http') ? path : API + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    auth.expires = 0;
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 429 && retry) {
    await sleep(Math.min((Number(res.headers.get('Retry-After')) || 1) * 1000, 5000));
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 204 || res.status === 202) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = data?.error;
    throw new SpotifyError(e?.message || res.statusText || 'Spotify request failed', res.status, e?.reason);
  }
  return data;
}

/* --------------------------------------------------------- Web Playback SDK */

let player = null;
let device = null;
let readyPromise = null;
let readyResolve = null;
let sdkPromise = null;

function loadSdk() {
  sdkPromise ||= new Promise((resolve, reject) => {
    if (window.Spotify?.Player) return resolve();
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load the Spotify player (blocked by a network or ad blocker?).'));
    };
    document.head.append(s);
  });
  return sdkPromise;
}

export const deviceId = () => device;
export const playerReady = () => !!device;

export function deviceReady(timeout = 10000) {
  if (device) return Promise.resolve(device);
  if (!readyPromise) return Promise.reject(new Error('Spotify player is not running. Reconnect Spotify in Settings.'));
  return Promise.race([
    readyPromise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("Aurora's Spotify player isn't ready. Spotify Premium is required to play in the browser.")), timeout),
    ),
  ]);
}

export async function initPlayer({ volume = 0.7, onState, onStatus }) {
  await loadSdk();
  try {
    player?.disconnect();
  } catch {
    /* ignore */
  }
  device = null;
  readyPromise = new Promise(r => (readyResolve = r));
  player = new window.Spotify.Player({
    name: 'Aurora',
    volume,
    getOAuthToken: cb => token().then(cb).catch(() => cb('')),
  });
  player.addListener('ready', ({ device_id }) => {
    device = device_id;
    readyResolve(device_id);
    onStatus({ state: 'ready' });
  });
  player.addListener('not_ready', () => {
    device = null;
    readyPromise = new Promise(r => (readyResolve = r));
    onStatus({ state: 'offline', message: 'Spotify player went offline.' });
  });
  player.addListener('player_state_changed', onState);
  player.addListener('autoplay_failed', () => onStatus({ warning: 'Your browser blocked autoplay. Press play once to start.' }));
  player.addListener('initialization_error', e =>
    onStatus({ state: 'error', kind: 'init', message: e.message || 'This browser cannot play Spotify (needs DRM support).' }),
  );
  player.addListener('authentication_error', e =>
    onStatus({ state: 'error', kind: 'auth', message: e.message || 'Spotify authentication failed. Reconnect in Settings.' }),
  );
  player.addListener('account_error', e =>
    onStatus({ state: 'error', kind: 'premium', message: e.message || 'Spotify Premium is required to play in the browser.' }),
  );
  player.addListener('playback_error', e => onStatus({ warning: e.message || 'Spotify playback error.' }));
  const ok = await player.connect();
  if (!ok) onStatus({ state: 'error', kind: 'init', message: 'Could not connect the Spotify player.' });
  return ok;
}

// Browsers only allow audio to start from a user gesture; call this inside click handlers.
export const activate = () => player?.activateElement?.();
export const toggle = () => player?.togglePlay();
export const pause = () => player?.pause();
export const next = () => player?.nextTrack();
export const prev = () => player?.previousTrack();
export const seek = ms => player?.seek(ms);
export const setVolume = v => player?.setVolume(v);
export const getState = () => (player ? player.getCurrentState() : Promise.resolve(null));

export async function play({ uris, context, offset } = {}) {
  const id = await deviceReady();
  const body = {};
  if (context) body.context_uri = context;
  if (uris) body.uris = uris;
  if (offset) body.offset = offset;
  try {
    await api('/me/player/play', { method: 'PUT', query: { device_id: id }, body });
  } catch (e) {
    if (e.status !== 404) throw e;
    // Device not yet known to the Spotify backend: transfer playback to us, then retry once.
    await api('/me/player', { method: 'PUT', body: { device_ids: [id], play: false } });
    await sleep(500);
    await api('/me/player/play', { method: 'PUT', query: { device_id: id }, body });
  }
}

export const setShuffle = on => api('/me/player/shuffle', { method: 'PUT', query: { state: on, device_id: device } });
export const setRepeat = mode => api('/me/player/repeat', { method: 'PUT', query: { state: mode, device_id: device } });
export const addToQueue = uri => api('/me/player/queue', { method: 'POST', query: { uri, device_id: device } });

// Parse an open.spotify.com URL or spotify: URI into {type,id,uri}.
export function parseLink(input) {
  const m = String(input).match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(track|album|playlist|artist|episode|show)[/:]([A-Za-z0-9]{10,})/);
  return m ? { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}` } : null;
}

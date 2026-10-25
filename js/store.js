// Tiny persisted settings store (localStorage) with change subscriptions.
const KEY = 'aurora.v2';

const defaults = {
  clientId: '',
  name: '',
  accent: '#ff375f',
  accentName: 'Rose',
  theme: 'auto', // auto | light | dark
  volume: 0.7,
  lastSearch: '',
  sc: [], // saved SoundCloud links: {url,title,artist,art}
};

let state;
try {
  state = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
} catch {
  state = { ...defaults };
}

const subs = new Set();

export const get = () => state;

export function set(patch) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) – keep in memory */
  }
  subs.forEach(fn => fn(state));
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function resetAll() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('aurora.'))
    .forEach(k => localStorage.removeItem(k));
}

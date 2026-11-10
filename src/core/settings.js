// Persistent player settings (localStorage). settings.get('retro'), settings.set('muted', true), settings.on(fn).
const KEY = 'indy3d.settings.v1';
const defaults = { retro: false, muted: false, musicVolume: 0.8, sfxVolume: 0.9 };

let data = { ...defaults };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) data = { ...defaults, ...JSON.parse(raw) };
} catch { /* private mode etc. */ }

const listeners = new Set();

export const settings = {
  get(key) { return data[key]; },
  set(key, value) {
    if (data[key] === value) return;
    data[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
    for (const fn of listeners) fn(key, value);
  },
  toggle(key) { this.set(key, !data[key]); return data[key]; },
  /** fn(key, value) is called after every change. Returns an unsubscribe function. */
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

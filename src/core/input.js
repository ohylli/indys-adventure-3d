// Unified input: keyboard, standard gamepads and touch (virtual stick + buttons fed in by src/ui/touch).
//
//   input.init();                 once
//   input.poll();                 once per rendered frame, before reading
//   input.moveX / input.moveY     -1..1 (right / up = +1), already dead-zoned and clamped to the unit circle
//   input.jump / input.meow       held state
//   input.pressed('jump')         true only on the frame the action went down
//   input.lastDevice              'keyboard' | 'gamepad' | 'touch'
//   input.glyph('jump')           short label for on-screen prompts, for the device in use
//   input.setVirtual({...})       touch controls write their state here
//   input.virtualPress('pause')   one-shot press from a touch button

const ACTIONS = ['jump', 'meow', 'pause', 'confirm', 'back', 'up', 'down', 'left', 'right', 'mute', 'retro'];

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  KeyX: 'meow', KeyJ: 'meow', KeyE: 'meow', KeyC: 'meow',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm', NumpadEnter: 'confirm',
  Backspace: 'back',
  KeyM: 'mute', KeyR: 'retro',
};

const GLYPHS = {
  keyboard: { move: 'WASD / Arrows', jump: 'Space', meow: 'X', pause: 'Esc', confirm: 'Enter', back: 'Esc', mute: 'M', retro: 'R' },
  gamepad: { move: 'Left stick', jump: 'A', meow: 'X', pause: 'Start', confirm: 'A', back: 'B', mute: 'M', retro: 'R' },
  touch: { move: 'the stick', jump: 'JUMP', meow: 'MEOW', pause: 'II', confirm: 'tap', back: 'back', mute: 'M', retro: 'R' },
};

const keys = new Set();
const tapped = new Set();
const down = Object.fromEntries(ACTIONS.map((a) => [a, false]));
const prev = Object.fromEntries(ACTIONS.map((a) => [a, false]));
const edge = Object.fromEntries(ACTIONS.map((a) => [a, false]));
const oneShot = new Set();
const virtual = { moveX: 0, moveY: 0, jump: false, meow: false };
const deviceListeners = new Set();
let inited = false;

function setDevice(d) {
  if (input.lastDevice === d) return;
  input.lastDevice = d;
  for (const fn of deviceListeners) fn(d);
}

export const input = {
  moveX: 0,
  moveY: 0,
  jump: false,
  meow: false,
  lastDevice: (typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches) ? 'touch' : 'keyboard',
  /** Set by tests to drive the game: { moveX, moveY, jump, meow } or null. Overrides every device. */
  override: null,

  init() {
    if (inited) return;
    inited = true;
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (KEYMAP[e.code]) {
        keys.add(e.code);
        if (!e.repeat) tapped.add(KEYMAP[e.code]);     // so a tap shorter than a frame is still seen
        setDevice('keyboard');
        if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());
    addEventListener('touchstart', () => setDevice('touch'), { passive: true });
  },

  poll() {
    for (const a of ACTIONS) { prev[a] = down[a]; down[a] = false; }
    for (const code of keys) down[KEYMAP[code]] = true;
    for (const a of tapped) down[a] = true;
    tapped.clear();

    let mx = (down.right ? 1 : 0) - (down.left ? 1 : 0);
    let my = (down.up ? 1 : 0) - (down.down ? 1 : 0);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      let ax = gp.axes[0] || 0;
      let ay = -(gp.axes[1] || 0);
      const mag = Math.hypot(ax, ay);
      if (mag < 0.22) { ax = 0; ay = 0; } else { const k = Math.min(1, (mag - 0.22) / 0.7) / mag; ax *= k; ay *= k; }
      if (b(14)) ax = -1; if (b(15)) ax = 1; if (b(12)) ay = 1; if (b(13)) ay = -1;
      const any = ax || ay || gp.buttons.some((x) => x.pressed);
      if (any) setDevice('gamepad');
      if (ax || ay) { mx = ax; my = ay; }
      if (b(0)) { down.jump = true; down.confirm = true; }
      if (b(2) || b(3)) down.meow = true;
      if (b(1)) { down.meow = true; down.back = true; }
      if (b(9)) down.pause = true;
      if (b(8)) down.back = true;
      if (ay > 0.6) down.up = true; if (ay < -0.6) down.down = true;
      if (ax > 0.6) down.right = true; if (ax < -0.6) down.left = true;
    }

    if (virtual.moveX || virtual.moveY || virtual.jump || virtual.meow) setDevice('touch');
    if (virtual.moveX || virtual.moveY) { mx = virtual.moveX; my = virtual.moveY; }
    if (virtual.jump) down.jump = true;
    if (virtual.meow) down.meow = true;
    for (const a of oneShot) { down[a] = true; }

    if (this.override) {
      mx = this.override.moveX || 0; my = this.override.moveY || 0;
      down.jump = !!this.override.jump; down.meow = !!this.override.meow;
    }

    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    this.moveX = mx; this.moveY = my;
    this.jump = down.jump; this.meow = down.meow;
    for (const a of ACTIONS) edge[a] = down[a] && !prev[a];
    for (const a of oneShot) { edge[a] = true; down[a] = false; }
    oneShot.clear();
  },

  pressed(action) { return edge[action]; },
  held(action) { return down[action]; },
  setVirtual(state) { Object.assign(virtual, state); },
  virtualPress(action) { oneShot.add(action); },
  glyph(action) { return (GLYPHS[this.lastDevice] || GLYPHS.keyboard)[action] || action; },
  /** fn(device) whenever the active device changes. Returns an unsubscribe function. */
  onDevice(fn) { deviceListeners.add(fn); return () => deviceListeners.delete(fn); },
};

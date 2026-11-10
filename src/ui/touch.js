// Touch controls: a floating virtual stick on the left half of the screen, JUMP and MEOW buttons bottom-right and a
// pause button top-right. Multi-touch: every finger is tracked by its Touch.identifier, so the stick and both buttons
// work at the same time. State goes to input.setVirtual({ moveX, moveY, jump, meow }) and input.virtualPress('pause').
// Mouse also works on everything (handy in the desktop sandbox).
//
//   const touch = createTouch(layerEl, input, { ICONS });
//   touch.setEnabled(bool)   false releases every finger and zeroes the virtual input
//   touch.state              { moveX, moveY, jump, meow, stick: bool } (read-only, for tests)

const DEAD = 0.16;

export function createTouch(layer, input, { ICONS }) {
  layer.innerHTML = `
    <div class="t-zone" data-touch="zone">
      <div class="t-stick-base idle"><div class="chev"><i style="transform:rotate(0deg) translateY(calc(var(--sz) * -.4))"></i><i style="transform:rotate(90deg) translateY(calc(var(--sz) * -.4))"></i><i style="transform:rotate(180deg) translateY(calc(var(--sz) * -.4))"></i><i style="transform:rotate(270deg) translateY(calc(var(--sz) * -.4))"></i></div><div class="t-knob"></div></div>
    </div>
    <button class="t-btn t-meow" data-touch="meow" aria-label="Meow" tabindex="-1">${ICONS.meow}<span class="lbl">MEOW</span></button>
    <button class="t-btn t-jump" data-touch="jump" aria-label="Jump" tabindex="-1">${ICONS.paw}<span class="lbl">JUMP</span></button>
    <button class="t-pause" data-touch="pause" aria-label="Pause" tabindex="-1">${ICONS.pause}</button>`;

  const zone = layer.querySelector('.t-zone');
  const base = layer.querySelector('.t-stick-base');
  const knob = layer.querySelector('.t-knob');
  const bJump = layer.querySelector('.t-jump');
  const bMeow = layer.querySelector('.t-meow');
  const bPause = layer.querySelector('.t-pause');

  const state = { moveX: 0, moveY: 0, jump: false, meow: false, stick: false };
  let enabled = false;
  let stickId = null;
  let cx = 0, cy = 0, R = 60;
  const held = { jump: new Set(), meow: new Set() };
  const lastSent = { moveX: 0, moveY: 0, jump: false, meow: false };

  function send() {
    state.jump = held.jump.size > 0;
    state.meow = held.meow.size > 0;
    bJump.classList.toggle('down', state.jump);
    bMeow.classList.toggle('down', state.meow);
    if (state.moveX !== lastSent.moveX || state.moveY !== lastSent.moveY || state.jump !== lastSent.jump || state.meow !== lastSent.meow) {
      lastSent.moveX = state.moveX; lastSent.moveY = state.moveY; lastSent.jump = state.jump; lastSent.meow = state.meow;
      input.setVirtual({ moveX: state.moveX, moveY: state.moveY, jump: state.jump, meow: state.meow });
    }
  }

  // ---- stick ---------------------------------------------------------------------------------------------
  function stickStart(id, x, y) {
    if (stickId !== null) return;
    stickId = id;
    R = base.offsetWidth / 2 || 60;
    const W = innerWidth, H = innerHeight, m = 4;
    cx = Math.min(Math.max(x, R + m), W - R - m);
    cy = Math.min(Math.max(y, R + m), H - R - m);
    base.classList.remove('idle');
    base.classList.add('active');
    base.style.left = cx + 'px';
    base.style.top = cy + 'px';
    state.stick = true;
    stickMove(id, x, y);
  }
  function stickMove(id, x, y) {
    if (id !== stickId) return;
    let dx = x - cx, dy = y - cy;
    let d = Math.hypot(dx, dy);
    // floating stick: when the thumb runs past the rim, drag the base along
    if (d > R * 1.15) {
      const k = (d - R * 1.15) / d;
      cx += dx * k; cy += dy * k;
      base.style.left = cx + 'px';
      base.style.top = cy + 'px';
      dx = x - cx; dy = y - cy; d = Math.hypot(dx, dy);
    }
    const lim = R * 0.62;
    const kd = d > lim ? lim / d : 1;
    knob.style.transform = `translate(${(dx * kd).toFixed(1)}px, ${(dy * kd).toFixed(1)}px)`;
    const mag = Math.min(1, d / (R * 0.85));
    if (mag < DEAD || d === 0) { state.moveX = 0; state.moveY = 0; }
    else {
      const s = (mag - DEAD) / (1 - DEAD);
      state.moveX = +(dx / d * s).toFixed(3);
      state.moveY = +(-dy / d * s).toFixed(3);
    }
    send();
  }
  function stickEnd(id) {
    if (id !== stickId) return;
    stickId = null;
    state.stick = false;
    state.moveX = 0; state.moveY = 0;
    base.classList.remove('active');
    base.classList.add('idle');
    base.style.left = ''; base.style.top = '';
    knob.style.transform = '';
    send();
  }

  // ---- buttons -------------------------------------------------------------------------------------------
  function btnDown(which, id) {
    held[which].add(id);
    send();
  }
  function btnUp(which, id) { held[which].delete(id); send(); }

  const opts = { passive: false };
  const each = (e, fn) => { for (const t of e.changedTouches) fn(t); };

  zone.addEventListener('touchstart', (e) => { e.preventDefault(); if (!enabled) return; each(e, (t) => stickStart(t.identifier, t.clientX, t.clientY)); }, opts);
  zone.addEventListener('touchmove', (e) => { e.preventDefault(); each(e, (t) => stickMove(t.identifier, t.clientX, t.clientY)); }, opts);
  const zoneEnd = (e) => { e.preventDefault(); each(e, (t) => stickEnd(t.identifier)); };
  zone.addEventListener('touchend', zoneEnd, opts);
  zone.addEventListener('touchcancel', zoneEnd, opts);

  for (const [el, which] of [[bJump, 'jump'], [bMeow, 'meow']]) {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); if (!enabled) return; each(e, (t) => btnDown(which, t.identifier)); }, opts);
    el.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    const end = (e) => { e.preventDefault(); each(e, (t) => btnUp(which, t.identifier)); };
    el.addEventListener('touchend', end, opts);
    el.addEventListener('touchcancel', end, opts);
    el.addEventListener('mousedown', (e) => { if (!enabled || e.button !== 0) return; e.preventDefault(); btnDown(which, 'mouse'); });
  }

  const pauseDown = () => {
    if (!enabled) return;
    bPause.classList.add('down');
    input.virtualPress('pause');
  };
  bPause.addEventListener('touchstart', (e) => { e.preventDefault(); pauseDown(); }, opts);
  const pauseUp = (e) => { e.preventDefault(); bPause.classList.remove('down'); };
  bPause.addEventListener('touchend', pauseUp, opts);
  bPause.addEventListener('touchcancel', pauseUp, opts);
  bPause.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); pauseDown(); } });

  // mouse drag on the stick zone (desktop sandbox)
  zone.addEventListener('mousedown', (e) => { if (!enabled || e.button !== 0) return; e.preventDefault(); stickStart('mouse', e.clientX, e.clientY); });
  addEventListener('mousemove', (e) => { if (stickId === 'mouse') stickMove('mouse', e.clientX, e.clientY); });
  addEventListener('mouseup', () => {
    stickEnd('mouse');
    bPause.classList.remove('down');
    if (held.jump.has('mouse')) btnUp('jump', 'mouse');
    if (held.meow.has('mouse')) btnUp('meow', 'mouse');
  });

  for (const el of [zone, bJump, bMeow, bPause]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  function releaseAll() {
    if (stickId !== null) stickEnd(stickId);
    held.jump.clear(); held.meow.clear();
    bPause.classList.remove('down');
    state.moveX = 0; state.moveY = 0;
    send();
  }
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  return {
    state,
    setEnabled(on) {
      on = !!on;
      if (on === enabled) return;
      enabled = on;
      if (!on) releaseAll();
    },
    get enabled() { return enabled; },
  };
}

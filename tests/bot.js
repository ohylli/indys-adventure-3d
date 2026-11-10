// A scripted player, injected into the page by tests/run.mjs. It drives the real game through the same input
// path as a person (window.indy.step with move/jump/meow), in manual stepping mode, and plays the stage from
// the plaza to the tip of the mast. It proves that every jump, ride and climb in the level can be made.
(() => {
  const DEG = Math.PI / 180;
  const G = () => window.indy.game;
  const P = () => G().player;
  const norm = (d) => ((d % 360) + 540) % 360 - 180;
  const A = () => P().angle / DEG;
  const R = () => P().radial;
  const Y = () => P().pos.y;
  const log = [];
  let steps = 0;

  function fail(what) {
    const e = new Error(`${what} | at ${JSON.stringify(window.indy.info())} | after: ${log.slice(-4).join(' > ')}`);
    throw e;
  }
  function step(inp = {}) {
    // with autoMeow on, the bot meows every 0.7 s: that keeps gulls and jackdaws away, as a careful player would
    const meow = !!inp.meow || (bot.autoMeow && steps % 42 === 0);
    window.indy.step(1, { moveX: 0, moveY: 0, jump: false, ...inp, meow });
    steps++;
    if (G().state !== 'play' && G().state !== 'claim') fail('left play state: ' + G().state);
  }
  /** Stick input that heads for the cylinder point (a, r). */
  function steer(a, r) {
    const p = P();
    const da = norm(a - A());
    const aa = (A() + Math.max(-16, Math.min(16, da))) * DEG;
    const dx = r * Math.sin(aa) - p.pos.x, dz = r * Math.cos(aa) - p.pos.z;
    const th = p.frameAngle;
    let mx = dx * Math.cos(th) - dz * Math.sin(th);
    let my = -dx * Math.sin(th) - dz * Math.cos(th);
    const dist = Math.hypot(r * Math.sin(a * DEG) - p.pos.x, r * Math.cos(a * DEG) - p.pos.z);
    const d = Math.hypot(mx, my);
    if (d > 1e-4) { const k = Math.min(1, dist / 0.45) / d; mx *= k; my *= k; }
    return { moveX: mx, moveY: my, dist };
  }
  const bot = {
    autoMeow: false,
    log, get steps() { return steps; },
    note(s) { log.push(s); },
    hold(inp, n) { for (let i = 0; i < n; i++) step(inp); },
    wait(fn, max = 1800, what = 'wait') { for (let i = 0; i < max; i++) { if (fn()) return i; step(); } fail(what + ' timed out'); },
    /** Walk to (a, r) on the current footing. */
    walk(a, r, o = {}) {
      log.push(`walk ${a},${r}`);
      const tol = o.tol ?? 0.35, max = o.max ?? 1500;
      for (let i = 0; i < max; i++) {
        const s = steer(a, r);
        if (s.dist < tol || (o.until && o.until())) return;
        step({ moveX: s.moveX, moveY: s.moveY, meow: !!o.meow && i % 40 === 0 });
        if (!o.fall && P().state === 'air' && Y() < (o.minY ?? -1e9)) fail('fell while walking');
      }
      fail(`walk ${a},${r} timed out`);
    },
    /** Jump toward (a, r) and steer until standing or climbing again. o.pounce: lunge at the top of the arc. */
    jump(a, r, o = {}) {
      log.push(`jump ${a},${r}${o.pounce ? ' pounce' : ''}`);
      const hold = o.hold ?? 26, max = o.max ?? 260;
      let pounceAt = -1;
      const hearts0 = G().hearts, from = `a=${A().toFixed(1)} r=${R().toFixed(2)} y=${Y().toFixed(2)} t=${G().time.toFixed(2)}`;
      step({});                                   // let go of the button first so this is a fresh press
      for (let i = 0; i < max; i++) {
        const s = steer(a, r), p = P();
        let jump = i < hold;
        if (o.pounce && pounceAt < 0 && i > 3 && p.state === 'air' && p.vel.y < (o.pounceVy ?? 3)) pounceAt = i + 1;
        if (pounceAt >= 0 && i >= pounceAt && i < pounceAt + 3) jump = true; else if (pounceAt >= 0 && i === pounceAt - 1) jump = false;
        if (pounceAt >= 0 && i < pounceAt) jump = false;
        step({ moveX: o.still ? 0 : s.moveX, moveY: o.still ? 0 : s.moveY, jump });
        if (i > 2 && (P().state === 'ground' || P().state === 'climb')) {
          const miss = Math.hypot(r * Math.sin(a * DEG) - P().pos.x, r * Math.cos(a * DEG) - P().pos.z);
          if (miss > (o.within ?? 2.2) || G().hearts < hearts0) fail(`jump ${a},${r} went wrong (landed ${miss.toFixed(1)} away, hearts ${hearts0} -> ${G().hearts}, from ${from})`);
          return;
        }
      }
      fail(`jump ${a},${r} never landed`);
    },
    /** Hold up on a climbable until at least y, or until the top hop lands. */
    climb(y, o = {}) {
      log.push(`climb to ${y}`);
      if (P().state !== 'climb') fail('not climbing');
      for (let i = 0; i < (o.max ?? 1200); i++) {
        step({ moveY: 1, moveX: o.x ?? 0, meow: !!o.meow && i % 45 === 0 });
        if (P().state !== 'climb') return;        // hopped over the top (or reached the floor)
        if (P().state === 'climb' && Y() >= y) return;
      }
      fail('climb timed out');
    },
    /** After a top hop: steer to (a, r) until landed (or hanging on the next climbable). */
    land(a, r, o = {}) {
      for (let i = 0; i < (o.max ?? 200); i++) {
        if (P().state === 'ground' || (o.orClimb && P().state === 'climb')) return;
        const s = steer(a, r);
        step({ moveX: s.moveX, moveY: s.moveY });
      }
      fail('never landed');
    },
    expect(cond, what) { if (!cond) fail('expected ' + what); },
    A, R, Y, P, G, norm,
    mover(name, pick) { return G().level.movers.filter((m) => m.name === name).map((m) => ({ m, p: m.object.position, a: Math.atan2(m.object.position.x, m.object.position.z) / DEG })).filter(pick || (() => true)); },
  };
  window.bot = bot;
})();

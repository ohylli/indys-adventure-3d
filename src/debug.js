// Test hooks, on window.indy. Used by the Playwright scripts in tests/ and handy in the console.
//   indy.start()                 skip the title and start the climb
//   indy.manual(true)            stop the real-time loop; drive with indy.step(n)
//   indy.step(n, input?)         run n fixed steps with { moveX, moveY, jump, meow }
//   indy.tp(a, r, y)             teleport (cylinder coordinates); indy.cp(i) teleports to checkpoint i
//   indy.god(true)               nothing hurts
//   indy.info()                  position, state, section, hearts, treats
import { input } from './core/input.js';
import { cyl } from './world/movers.js';

export function installDebug(game) {
  const api = {
    game,
    start() { game.startRun(); },
    manual(on = true) { game.manual = on; game.acc = 0; },
    god(on = true) { game.god = on; },
    step(n = 1, inp = null) {
      for (let i = 0; i < n; i++) {
        if (inp) {
          input.override = inp;
          input.poll();
          if (inp.jump && !api._jumpWas) game.jumpLatch = true;
          if (inp.meow && !api._meowWas) game.meowLatch = true;
          api._jumpWas = !!inp.jump; api._meowWas = !!inp.meow;
        }
        game.fixed(1 / 60);
      }
      return api.info();
    },
    release() { input.override = null; api._jumpWas = api._meowWas = false; },
    tp(a, r, y) { game.player.teleport(cyl(a, r, y), game.player.yaw); game.cam.snap(game.player); return api.info(); },
    cp(i) {
      const c = game.level.checkpoints[i];
      game.player.teleport(c.respawn, game.player.yaw); game.cam.snap(game.player);
      return api.info();
    },
    time(t) { game.dayT = t; },
    info() {
      const p = game.player;
      return {
        state: game.state, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
        a: +(((p.angle * 180 / Math.PI) % 360 + 360) % 360).toFixed(1), r: +p.radial.toFixed(2),
        move: p.state, section: game.section, hearts: game.hearts, naps: game.naps,
        treats: game.level ? game.level.treats.taken : 0, total: game.level ? game.level.treats.total : 0,
        ground: p.ground && p.ground.mover ? p.ground.mover.name : p.ground ? 'static' : null,
        cp: game.checkpoint ? game.checkpoint.index : -1, fps: Math.round(game.fps),
        calls: game.renderer ? game.renderer.gl.info.render.calls : 0, tris: game.renderer ? game.renderer.gl.info.render.triangles : 0,
      };
    },
  };
  window.indy = api;
}

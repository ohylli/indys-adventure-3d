import { Game } from './game.js';
import { installDebug } from './debug.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
installDebug(game);

game.init().then(() => {
  let last = performance.now();
  const loop = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}).catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;background:#1b1530;color:#ffd9d0;font:14px/1.5 monospace;white-space:pre-wrap;z-index:99';
  el.textContent = 'Indy could not start the climb:\n\n' + (err && err.stack || err);
  document.body.appendChild(el);
});

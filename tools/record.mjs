// Records a showcase video of a whole playthrough: the title screen, the bot's climb (tests/route.js, with the
// showcase pauses of b.beat()), the claim with its fireworks and the results screen, with the game's own audio.
//
//   node tools/record.mjs                       1920x1080 at 60 fps -> tests/out/video/indy-playthrough.mp4
//   node tools/record.mjs --fps=30 --size=1280x720 --out=path.mp4
//   node tools/record.mjs --only=ferris         one section, from its checkpoint (quick look at the pacing)
//   node tools/record.mjs --max=10              stop after 10 s of video (trying things out)
//   node tools/record.mjs --god                 nothing hurts
//   node tools/record.mjs --url=http://127.0.0.1:5173/   use a running dev server
//
// It renders offline, frame by frame, so the video is smooth however slow the machine is (expect it to take
// several times the length of the video). How:
//   - The page runs on Playwright's fake clock, paused: setTimeout, Date and performance.now only move when the
//     recorder advances the clock, by exactly one video frame per frame, and requestAnimationFrame callbacks run
//     once per video frame. CSS animations and transitions are
//     paused and stepped by hand to the same clock.
//   - The game is in manual mode and the bot steps it at 60 Hz; after every 60/fps steps the recorder advances the
//     clock (the game's own frame loop then draws), takes a screenshot (canvas and UI) and pipes it to ffmpeg.
//   - The audio API logs every call with its time on that clock (audio.record), and at the end the log is replayed
//     into an OfflineAudioContext (audio.renderSession) and muxed in.
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const fps = Number(args.fps || 60);
if (60 % fps) throw new Error('--fps must divide 60 (60, 30, 20, ...)');
const [W, H] = String(args.size || '1920x1080').split('x').map(Number);
const out = path.resolve(root, String(args.out || 'tests/out/video/indy-playthrough.mp4'));
const work = path.join(path.dirname(out), '.work');
fs.mkdirSync(work, { recursive: true });
const maxFrames = args.max ? Math.round(Number(args.max) * fps) : Infinity;
const SAMPLE_RATE = 48000;

let server = null;
let url = args.url;
if (!url) {
  server = await createServer({ root, server: { port: 5181, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

// ---- video out
const videoTmp = path.join(work, 'video.mp4');
const ffVideo = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', videoTmp], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffVideoDone = new Promise((res, rej) => ffVideo.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg (video) exited with ' + c)))));
const write = (buf) => new Promise((res) => { if (ffVideo.stdin.write(buf)) res(); else ffVideo.stdin.once('drain', res); });

// ---- the clock: frame n is shown at n / fps seconds and is captured with the page clock at (n + 1) / fps
const msPerFrame = 1000 / fps;
let frame = 0, clockMs = 0;
const t0 = Date.now();
async function captureFrame() {
  if (frame >= maxFrames) return false;
  const target = Math.round((frame + 1) * msPerFrame);
  await page.clock.runFor(target - clockMs);
  clockMs = target;
  await page.evaluate(() => {
    // exactly one animation frame per video frame, like a 60 Hz display (the fake clock's own requestAnimationFrame
    // ticks every 16 ms, which would draw twice in some video frames and not at all in others)
    window.__flushRaf();
    // CSS animations and transitions follow the fake clock too
    const now = performance.now();
    const seen = window.__anims || (window.__anims = new WeakMap());
    for (const a of document.getAnimations()) {
      let s = seen.get(a);
      if (!s) { s = { t0: now, c0: 0 }; seen.set(a, s); try { a.pause(); } catch { /* */ } }
      try { a.currentTime = s.c0 + (now - s.t0); } catch { /* */ }
    }
  });
  await write(await page.screenshot({ type: 'jpeg', quality: 92 }));
  frame++;
  if (frame % (fps * 10) === 0) {
    const real = (Date.now() - t0) / 1000;
    console.log(`  ${(frame / fps).toFixed(0)} s of video, ${real.toFixed(0)} s so far (${(real / (frame / fps)).toFixed(1)}x)`);
  }
  return true;
}
await page.exposeFunction('__recFrame', captureFrame);

// ---- boot on the fake clock
await page.clock.install();
await page.goto(url);
for (let i = 0; ; i++) {
  if (await page.evaluate(() => window.indy && window.indy.game.state === 'title')) break;
  if (i > 1200) throw new Error('the game did not reach the title screen');
  await page.clock.runFor(50);
  await page.waitForTimeout(50);       // real time for asset loading
}
// from here on the page's time only moves when the recorder says so (an installed clock keeps flowing in real time)
await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
await page.clock.runFor(1500);           // let the first fade-in finish before frame 0
await page.evaluate(() => {
  const queue = new Map();
  let id = 0;
  window.requestAnimationFrame = (cb) => { queue.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => { queue.delete(i); };
  window.__flushRaf = () => {
    const cbs = [...queue.values()];
    queue.clear();
    const now = performance.now();
    for (const cb of cbs) cb(now);
  };
});
await page.clock.runFor(100);            // the game loop's pending frame moves over to the new queue
await page.evaluate((god) => { window.indy.manual(true); window.indy.god(!!god); }, !!args.god);
await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'bot.js'), 'utf8') });
await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'tests', 'route.js'), 'utf8') });

// ---- the show
const result = await page.evaluate(async ({ fps, only }) => {
  const indy = window.indy, game = indy.game, bot = window.bot, audio = game.ctx.audio;
  const spf = 60 / fps;
  let k = 0;
  const T0 = performance.now();
  audio.record(() => Math.max(0, (performance.now() - T0) / 1000 - 1 / fps));
  bot.showcase = true;
  let enough = false;
  bot.onStep = async () => {
    if (enough || ++k % spf) return;
    if (!(await window.__recFrame())) { enough = true; throw new Error('ENOUGH'); }
  };
  const step = async (inp = {}) => { indy.step(1, { moveX: 0, moveY: 0, jump: false, meow: false, ...inp }); await bot.onStep(); };
  const hold = async (sec, until) => { for (let i = 0; i < Math.round(sec * 60) && !(until && until()); i++) await step(); };
  const sections = [];
  let stopped = null;
  try {
    const route = only ? window.route.filter((s) => only.split(',').includes(s.name)) : window.route;
    if (!only) await hold(6);                                    // the title screen
    audio.sfx('ui_select');
    indy.start();
    await hold(3, () => game.state === 'play');
    if (only && route[0].cp != null) { indy.cp(route[0].cp); await hold(0.5); }
    for (const s of route) {
      const s0 = game.time;
      await s.run();
      sections.push(`${s.name} ${(game.time - s0).toFixed(1)} s`);
    }
    if (game.state === 'claim') {
      await hold(14, () => game.state === 'results');
      await hold(9);                                             // the results screen
    }
  } catch (e) {
    stopped = String(e.message || e);
  }
  await hold(0.2);
  const log = audio.stopRecording();
  return { sections, stopped, log, info: indy.info() };
}, { fps, only: args.only || null });

const seconds = frame / fps;
console.log(result.stopped && !/ENOUGH/.test(result.stopped) ? `stopped: ${result.stopped}` : 'run finished');
console.log('  ' + result.sections.join(', '));
console.log(`  ${frame} frames, ${seconds.toFixed(1)} s of video, ${result.log.length} audio events`);
ffVideo.stdin.end();
await ffVideoDone;

// ---- audio: replay the log offline, pass it back in chunks as 16-bit PCM
console.log('rendering audio...');
const at = Date.now();
const nChunks = await page.evaluate(async ({ log, seconds, rate }) => {
  const buf = await window.indy.game.ctx.audio.renderSession(log, seconds, rate);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const pcm = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    pcm[i * 2] = Math.max(-1, Math.min(1, L[i])) * 32767;
    pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i])) * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  const CH = 3 << 20;
  window.__pcm = [];
  for (let o = 0; o < bytes.length; o += CH) {
    let s = '';
    const part = bytes.subarray(o, o + CH);
    for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
    window.__pcm.push(btoa(s));
  }
  return window.__pcm.length;
}, { log: result.log, seconds, rate: SAMPLE_RATE });
const parts = [];
for (let i = 0; i < nChunks; i++) parts.push(Buffer.from(await page.evaluate((i) => window.__pcm[i], i), 'base64'));
const pcm = Buffer.concat(parts);
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SAMPLE_RATE, 24); head.writeUInt32LE(SAMPLE_RATE * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(work, 'audio-log.json'), JSON.stringify(result.log));
const wav = path.join(work, 'audio.wav');
fs.writeFileSync(wav, Buffer.concat([head, pcm]));
console.log(`  audio rendered in ${((Date.now() - at) / 1000).toFixed(0)} s`);
await browser.close();
if (server) await server.close();

// ---- mux, with a fade out at the end
const fade = Math.min(1.5, seconds / 4);
await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoTmp, '-i', wav,
    '-vf', `fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`, '-af', `afade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out],
  { stdio: 'inherit' });
  ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg (mux) exited with ' + c))));
});
console.log(`wrote ${path.relative(root, out)} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].slice(0, 10).join('\n  '));
process.exit(result.stopped && !/ENOUGH/.test(result.stopped) ? 1 : 0);

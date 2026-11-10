// The stage: Näsinneula on a festival night. One continuous climb from the Särkänniemi plaza to the tip of the mast.
// Positions are cylinder coordinates around the tower: angle a (degrees, increasing = right on screen), radius r,
// height y. See CLAUDE.md "World conventions".
import * as THREE from 'three';
import { assets } from '../core/assets.js';
import { cyl, placeCyl, orbit, spin, ferris, bob, dropRide, helix } from './movers.js';

const DEG = Math.PI / 180;

export const SECTION_NAMES = [
  'Särkänniemi Plaza', 'The Big Wheel', 'The Spiral Coaster', 'The Drop', 'The Wave Swinger',
  'Festival Skies', 'Under the Saucer', 'The Revolving Restaurant', 'The Needle',
];
// lowest footing of each section, used to tell where Indy is
export const SECTION_Y = [-100, 1.0, 16.3, 36.8, 54.3, 59.0, 92.3, 99.3, 106.6];

export const TOP_Y = 140;
const FESTIVE = ['#e8443a', '#ffc93c', '#2bb3a6', '#3d7fe0', '#f27aa8', '#8a5bd6', '#f58a2c'];
const shaftR = (y) => 5.2 - 0.6 * Math.min(1, Math.max(0, y / 94));

export function buildLevel(L) {
  const world = L.world;
  L.spawn = { a: 0, r: 25, y: 0.05 };

  plaza(L);
  bigWheel(L);
  coaster(L);
  dropAndNets(L);
  swinger(L);
  festivalSkies(L);
  underside(L);
  restaurant(L);
  needle(L);
  lights(L);

  // the plaza is fenced in by an invisible wall, open at the quay to the north (a = 180)
  world.addStaticGeometry(openRing(33.0, -1, 30, 174.5, 185.5));
  // the ground: the paved plaza, and the quay running out over the lake
  world.addStaticGeometry(disc(0, 34.5));
  world.addStaticGeometry(box3(cyl(180, 39.5, -0.5), [6.4, 1, 13], 180));
}

// ---------------------------------------------------------------------------------------------------- 0 plaza
function plaza(L) {
  L.checkpoint(-7, 20.5, 0, 0);
  L.treatLine([0, 22, 0], [0, 16.5, 0], 4);
  L.hint((p) => p.pos.y < 2 && p.radial > 14 && Math.abs(p.angle) < 0.5, 'Run with {move}. Jump with {jump}.');

  // festival furniture
  L.piece('kiosk', -36, 15.2, 0);
  L.piece('kiosk', 52, 15.2, 0);
  L.piece('fountain', 28, 22, 0);
  L.water(28, 22, 0.35, 2.55);
  for (const a of [-70, -22, 22, 70, 215, 250, 290]) L.piece('lamp_post', a, 13.3, 0, { yaw: 90 });
  L.piece('bench', -14, 29.5, 0, { yaw: 180 });
  L.piece('bench', 46, 30, 0, { yaw: 180 });
  L.piece('bench', 238, 29, 0, { yaw: 180 });
  L.decor('flag_pole', -10, 14.2, 0);
  L.decor('flag_pole', 10, 14.2, 0);
  L.piece('speaker_stack', 96, 14.2, 0, { yaw: -10 });
  L.piece('speaker_stack', 104, 14.2, 0, { yaw: 10 });
  L.visitor('visitor_a', -31, 19, 200);
  L.visitor('visitor_b', -43, 18.6, 150);
  L.visitor('visitor_c', 54, 19.5, 190);
  L.visitor('visitor_b', 98, 24.5, 170);
  L.visitor('visitor_a', 225, 24, 180);
  L.visitor('visitor_c', 262, 21, 200);
  for (const [a, r] of [[12, 20], [15, 21.2], [9, 21.6], [-58, 26], [-55, 27], [200, 25], [203, 26.3]]) L.pigeon(a, r, 0, { yaw: 60 * a });

  // a first jump: crates, and a trampoline up to the pavilion roof where treats wait
  L.piece('crate', 78, 17, 0, { yaw: 12 });
  L.piece('crate', 82, 15.4, 0, { yaw: -8 });
  L.piece('crate', 82, 15.4, 1.2, { yaw: 20 });
  L.treat(78, 17, 1.4); L.treat(82, 15.4, 2.6);
  L.jackdaw(73, 17.6, 0, { yaw: 120 });
  L.hint((p) => p.pos.y < 3 && Math.abs(p.angle / DEG - 76) < 12 && p.radial < 22, 'Meow with {meow} to shoo birds away.');
  L.piece('trampoline', -62, 15.5, 0);
  L.bouncer(-62, 15.5, 0.6, 1.3, 19);
  L.treatLine([-62, 15.5, 2.5], [-62, 15.5, 5.5], 3);
  L.treatLine([-80, 9.5, 3.4], [80, 9.5, 3.4], 9);          // on the pavilion roof
  L.heart(-125, 9, 3.4);
  L.piece('gift_box', -100, 14.5, 0, { tint: '#3d7fe0', yaw: 15 });
  L.piece('gift_box', -112, 16, 0, { tint: '#f27aa8', yaw: -20 });

  // the climbing frame teaches climbing: up the net onto a deck, then across to the wheel
  L.decor('sign_arrow', 100, 16, 0, { yaw: 0 });
  L.piece('net', 118, 15.2, 0);
  L.piece('deck_m', 118, 13.9, 5.0);
  L.box(118, 12.7, 2.5, [0.3, 5, 0.3], 'steel_dark');
  L.hint((p) => p.pos.y < 2 && Math.abs(p.angle / DEG - 118) < 9 && p.radial < 21, 'Push into a net, ladder or rope to climb. {jump} leaps off.');
  L.treatLine([118, 16, 1], [118, 16, 4], 3);
  L.treat(118, 13.9, 5.0);
  L.piece('deck_s', 130, 14.4, 4.2);
  L.treat(130, 14.4, 4.2);
}

// ---------------------------------------------------------------------------------------------------- 1 the big wheel
const WHEEL = { a: 150, r: 16.5, baseY: 1.9, speed: 17 };
function bigWheel(L) {
  const { a, r, baseY, speed } = WHEEL;
  L.box(a, r - 2.3, baseY / 2, [13.4, baseY, 2.4], 'concrete');
  L.arcDeck(a - 24, a + 24, r - 0.9, r + 2.4, 0.2, 0.2, { top: 'wood', side: 'red', alt: 'cream', thick: 0.2 });
  const base = L.decor('ferris_base', a, r, baseY);
  const rotor = assets.kit('ferris_rotor');
  rotor.position.set(0, 10, 0);
  base.add(rotor);
  L.spinner(rotor, 'z', speed * DEG);
  for (let i = 0; i < 8; i++) {
    L.mover('ferris_gondola', ferris({ a, r, hubY: baseY + 10, radius: 8, speed, phase: i * 45 }), { tint: FESTIVE[i % FESTIVE.length] });
  }
  L.hint((p) => p.pos.y < 6 && Math.abs(p.angle / DEG - a) < 22 && p.radial > 13, 'Hop into a gondola and ride it to the top.');
  L.checkpoint(a - 20, r + 1, 0.2, 1);
  // the pier from the top of the wheel to the tower
  const top = baseY + 10 + 8 - 2.4;          // gondola floor at the top: 17.2
  L.box(a, 10.4, top - 0.75, [2.8, 0.3, 8.8], 'wood_light');
  L.box(a, 10.4, top - 0.95, [3.0, 0.14, 9.0], 'red', { collide: false });
  for (const s of [-1, 1]) L.box(a + s * 6.5, 11.3, (top + 3.4) / 2 - 0.5, [0.3, top - 3.4 - 0.9, 0.3], 'steel_dark');
  L.decor('station_arch', a, 7.4, top - 0.6);
  L.treatLine([a, 14, top - 0.6], [a, 9, top - 0.6], 4);
}

// ---------------------------------------------------------------------------------------------------- 2 the spiral coaster
const COASTER = { a0: 190, a1: 640, y0: 16.6, y1: 37.0, rIn: 6.0, rOut: 9.2 };
function coaster(L) {
  const { a0, a1, y0, y1, rIn, rOut } = COASTER;
  L.arcDeck(128, a0, 5.5, rOut, y0, y0, { top: 'wood_light' });
  L.checkpoint(168, 6.6, y0, 2);
  // the track: a planked ramp with two rails
  L.arcDeck(a0, a1, rIn, rOut, y0, y1, { top: 'wood', side: 'steel_dark', alt: 'yellow', step: 5 });
  for (const rr of [6.85, 8.2]) L.arcDeck(a0, a1, rr, rr + 0.16, y0 + 0.1, y1 + 0.1, { top: 'red', side: 'red', alt: 'red', thick: 0.1, collide: false, step: 5 });
  for (let a = a0 + 15; a < a1; a += 30) {
    const y = y0 + (y1 - y0) * (a - a0) / (a1 - a0);
    L.decor('bracket', a, rOut - 0.5, y - 0.3);
  }
  L.decor('station_arch', a0 + 1, 7.6, y0, { yaw: 90 });
  L.decor('station_arch', a1 - 1, 7.6, y1, { yaw: 90 });
  // trains of two cars roll down the track; jump over them or step aside
  const mid = (rIn + rOut) / 2;
  for (const [phase, tint] of [[0, '#e8443a'], [0.5, '#2bb3a6']]) {
    for (let c = 0; c < 2; c++) {
      const m = L.mover('coaster_car', helix({ a0: a1, a1: a0, y0: y1 + 0.12, y1: y0 + 0.12, r: mid, speed: 6.5, phase: phase - c * 0.034, gap: 14 }), { tint });
      L.bumper(m);
    }
  }
  L.hint((p) => p.pos.y > y0 - 0.5 && p.pos.y < y0 + 3 && p.radial < 10, 'Coaster cars! Jump over them. In the air, {jump} again to pounce.');
  // treats up the ramp, a heart half way
  const at = (a) => y0 + (y1 - y0) * (a - a0) / (a1 - a0);
  for (let a = a0 + 20; a < a1 - 10; a += 22) L.treat(a, a % 44 < 22 ? 6.5 : 8.7, at(a));
  L.heart(415, 9.9, at(415) + 0.2);
  // the hidden charm: a balloon bunch floating off the track, a pounce away
  L.mover('balloon_bunch', bob({ a: 400, r: 13.6, y: at(400) + 1.0, amp: 0.3, period: 5 }));
  L.charm(400, 13.6, at(400) + 1.4);
  // top station
  L.arcDeck(a1 - 360, 309.5, 5.5, rOut, y1, y1, { top: 'wood_light' });
  L.checkpoint(305.5, 8.3, y1, 3);
}

// ---------------------------------------------------------------------------------------------------- 3 the drop and the nets
function dropAndNets(L) {
  const a = 322, r = 7.9, y0 = 37.0, y1 = 54.5;
  for (let y = 33; y < 57; y += 4) L.decor('drop_rail', a, r, y);
  L.decor('drop_top', a, r, 57);
  for (let y = 35; y < 57; y += 6) L.box(a, 5.9, y, [0.5, 0.25, 1.6], 'steel_dark', { collide: false });
  L.mover('drop_car', dropRide({ a, r, y0, y1, up: 5.5, holdTop: 2.4, down: 1.0, holdBottom: 2.6 }));
  L.hint((p) => Math.abs(p.pos.y - y0) < 1.5 && p.radial < 10 && Math.abs(((p.angle / DEG + 360) % 360) - 310) < 14, 'Ride the drop car up, or take the nets.');
  // the slower, safer way: three nets
  L.piece('net', 291, 7.4, 37);
  L.piece('deck_m', 291, 6.2, 42);
  L.piece('deck_s', 277, 8.9, 42);
  L.piece('net', 277, 7.7, 42);
  L.piece('deck_m', 277, 6.5, 47);
  L.piece('deck_s', 291, 9.0, 47);
  L.piece('net', 291, 7.7, 47);
  L.piece('deck_m', 291, 6.5, 52);
  L.piece('crate', 297, 6.3, 52);
  L.arcDeck(302.5, 310, 5.3, 7.1, y1, y1);       // starts past the crate, so nothing is overhead
  L.treatLine([291, 8, 38], [291, 8, 41], 3);
  L.treatLine([277, 8.3, 43], [277, 8.3, 46], 3);
  L.treatLine([291, 8.3, 48], [291, 8.3, 51], 3);
  L.treat(284, 7.6, 42); L.treat(284, 7.8, 47);
  L.jackdaw(281, 6.3, 47, { yaw: 40 });
  // top landing
  L.arcDeck(333.4, 341, 5.3, 8.9, y1, y1);       // as wide as the car, so stepping off is safe
  L.arcDeck(341, 400, 5.3, 7.1, y1, y1);
  L.checkpoint(350, 6.1, y1, 4);
  L.treatLine([338, 6.2, y1], [344, 6.2, y1], 2);
}

// ---------------------------------------------------------------------------------------------------- 4 the wave swinger
const SWING = { y: 61.5, tilt: 2.0, phase: 110, r: 8.2, speed: 26 };
function swinger(L) {
  const { y, tilt, phase, r, speed } = SWING;
  // the tilted, spinning canopy
  const hub = assets.kit('swing_hub');
  const tiltGroup = new THREE.Group();
  const d = cyl(phase + 90, 1, 0);
  tiltGroup.quaternion.setFromAxisAngle(new THREE.Vector3(-d.z, 0, d.x).normalize(), Math.asin(tilt / r));
  tiltGroup.position.y = y;
  tiltGroup.add(hub);
  L.root.add(tiltGroup);
  L.spinner(hub, 'y', speed * DEG);
  for (let i = 0; i < 12; i++) {
    L.mover('swing_chair', orbit({ a0: i * 30, r, y, speed, tilt, tiltPhase: phase }), { tint: FESTIVE[i % FESTIVE.length] });
  }
  L.hint((p) => Math.abs(p.pos.y - 54.5) < 1 && p.radial < 8 && Math.abs(((p.angle / DEG + 540) % 360) - 180 - 10) < 25, 'Jump onto a swing seat. It carries you up and around.');
  for (let a = 40; a <= 180; a += 20) L.treat(a, r, y - 4 + tilt * Math.sin((a - phase) * DEG) + 0.9);
  // exit deck on the high side
  L.arcDeck(178, 232, 5.3, 7.1, 59.2, 59.2);
  L.checkpoint(214, 6.1, 59.2, 5);
  L.jackdaw(196, 6.2, 59.2, { yaw: 0 });
}

// ---------------------------------------------------------------------------------------------------- 5 festival skies
function festivalSkies(L) {
  // out and around the swinger's canopy on balloons
  L.piece('deck_s', 240, 10.6, 59.7);
  L.treat(240, 10.6, 59.7);
  L.mover('balloon_bunch', bob({ a: 249, r: 11.4, y: 61.2, amp: 0.35, period: 4.2 }));
  L.mover('balloon_bunch', bob({ a: 259, r: 11.4, y: 63.0, amp: 0.35, period: 5.0, phase: 0.4 }));
  L.mover('balloon_bunch', bob({ a: 269, r: 11.0, y: 64.8, amp: 0.35, period: 4.6, phase: 0.7 }));
  L.treat(249, 11.4, 62); L.treat(259, 11.4, 63.8); L.treat(269, 11, 65.6);
  L.piece('deck_m', 281, 8.6, 66.2);
  L.heart(285, 8.8, 66.2);
  // ladders up
  L.piece('ladder', 280, 7.35, 66.2);
  L.piece('ladder', 280, 7.35, 70.2);
  L.piece('deck_m', 280, 6.15, 74.2);
  L.treatLine([280, 8.1, 67.5], [280, 8.1, 72.5], 4);
  L.checkpoint(275, 6.0, 74.2, 5);
  // stepping pads in the wind
  const pads = [[301, 7.3, 75.4], [336, 7.4, 76.8], [372, 7.3, 78.2], [408, 7.4, 79.6]];
  for (const [a, r, y] of pads) { L.piece('deck_round', a, r, y); L.treat(a, r, y); }
  L.wind({ y0: 74.6, y1: 82.5, a0: 284, a1: 62, period: 6.5, blow: 2.3, strength: 15 });
  L.hint((p) => p.pos.y > 73.8 && p.pos.y < 76 && Math.abs(((p.angle / DEG + 360) % 360) - 285) < 14, 'Wind! Wait for the gust to pass before you jump.');
  L.gull({ a: 330, r: 12.5, y: 80.5, arc: 45, speed: 0.4 });
  // the hot-air balloon lift
  L.mover('hot_air_balloon', bob({ a: 66, r: 10.6, y: 83.4, amp: 3.0, period: 10 }), { tint: '#e8443a' });
  L.treatLine([66, 10.6, 84], [66, 10.6, 88], 3);
  L.piece('deck_m', 95, 8.6, 86.6);
  L.jackdaw(100, 9.2, 86.6, { yaw: -50 });
  L.treat(92, 8.6, 86.6);
  // the banner up to the ring balcony
  L.piece('banner', 99, 6.8, 93.35);
  L.treatLine([99, 7.5, 87.6], [99, 7.5, 91.6], 3);
  L.gull({ a: 140, r: 12, y: 90, arc: 50, speed: 0.36 });
  L.checkpoint(118, 5.85, 92.5, 6);
  L.heart(84, 5.9, 92.5);
}

// ---------------------------------------------------------------------------------------------------- 6 under the saucer
function underside(L) {
  // the last two hang clear of the brim, so nothing is overhead when Indy jumps for the banner
  const lanterns = [[131, 8.4, 93.2], [143, 10.0, 94.1], [155, 11.6, 95.0], [167, 13.4, 95.8], [179, 15.6, 96.5], [190, 16.9, 97.2]];
  lanterns.forEach(([a, r, y], i) => {
    L.mover('lantern', bob({ a, r, y, amp: 0.18, period: 3.4 + i * 0.3, phase: i * 0.21 }));
    L.treat(a, r, y);
  });
  L.piece('banner_short', 200, 15.25, 99.95);
  L.hint((p) => p.pos.y > 92.3 && p.pos.y < 94 && p.radial < 7.2 && Math.abs(((p.angle / DEG + 360) % 360) - 122) < 12, 'Lanterns make good stepping stones.');
}

// ---------------------------------------------------------------------------------------------------- 7 the revolving restaurant
const REST = { speed: 7, y: 103.0 };
function restaurant(L) {
  L.checkpoint(208, 14.0, 99.5, 7);
  // ledge A, the observation deck brim: birds and sparklers
  L.jackdaw(222, 14.4, 99.5, { yaw: 180 });
  L.jackdaw(226, 13.8, 99.5, { yaw: 160 });
  L.sparkler(244, 14.3, 99.5, { phase: 0 });
  L.sparkler(262, 13.6, 99.5, { phase: 1.2 });
  L.sparkler(280, 14.4, 99.5, { phase: 2.4 });
  for (let a = 212; a < 300; a += 9) if (![244, 262, 280].some((s) => Math.abs(s - a) < 4)) L.treat(a, 14.1, 99.5);
  L.heart(310, 14.1, 99.5);
  L.checkpoint(297, 14.0, 99.5, 7);
  // ropes hang from the revolving brim above: ride one up
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.7, 8), L.mat('rope'));
    rope.position.y = -2.35; rope.castShadow = true;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), L.mat('rope'));
    knot.position.y = -4.7;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 1.5), L.mat('steel_dark'));
    arm.position.set(0, 0.05, -0.65);
    g.add(rope, knot, arm);
    const m = L.mover(g, orbit({ a0: i * 90, r: 17.45, y: REST.y + 0.45, speed: REST.speed }));
    L.world.addClimbPole(0, 0, -4.7, 0, 0.1, m);
  }
  L.hint((p) => Math.abs(p.pos.y - 99.5) < 0.6 && p.radial > 12 && Math.abs(((p.angle / DEG + 360) % 360) - 290) < 25, 'The restaurant above revolves. Leap out and grab a rope as it comes by.');
  // on the revolving brim: treats float past
  for (let a = 0; a < 360; a += 24) L.treat(a, 15.3, REST.y);
  // fixed ropes from the roof eave
  for (const a of [60, 180, 300]) {
    const p = cyl(a, 17.55, 107.35);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.8, 8), L.mat('rope'));
    rope.position.set(p.x, p.y - 1.9, p.z); rope.castShadow = true;
    L.root.add(rope);
    L.box(a, 17.2, 107.4, [0.22, 0.16, 1.2], 'steel_dark', { collide: false });
    L.world.addClimbPole(p.x, p.z, 103.55, 107.35, 0.1);
    L.checkpoint(a + 9, 14.6, null, 8);
  }
}

// ---------------------------------------------------------------------------------------------------- 8 the needle
function needle(L) {
  // the roof: sparklers and treats on the way to the drums
  for (let i = 0; i < 6; i++) {
    const s = L.sparkler(i * 60 + 30, 10.5, null, { phase: i * 0.6, on: 1.3, off: 2.3 });
    L.pendingGround.push(s);
  }
  for (let a = 0; a < 360; a += 30) L.treat(a, 7.6, 108.9);
  for (const a of [0, 120, 240]) { const m = L.decor('firework_mortar', a, 13, 107.75, { scale: 1.3 }); L.mortars = (L.mortars || []).concat(m); }
  for (const [i, a] of [90, 210, 330].entries()) L.piece("gift_box", a, 6.4, 109.08, { tint: FESTIVE[i * 2], yaw: 20 * i });
  for (let a = 45; a < 360; a += 90) L.treat(a, 4.3, 111.7);
  L.treat(0, 3, 113.3); L.treat(180, 3, 113.3);
  // lower mast
  L.world.addClimbPole(0, 0, 114.4, 123.92, 0.8);
  for (let i = 0; i < 6; i++) L.treat(i * 75, 1.3, 115.6 + i * 1.2);
  L.checkpoint(40, 1.95, 123.2, 8);
  L.gull({ a: 200, r: 9, y: 119, arc: 120, speed: 0.33 });
  // the beacon drum
  L.world.addClimbPole(0, 0, 123.2, 128.1, 1.15);
  // upper mast to the tip, and the perch that makes the tower a cat tree
  L.world.addClimbPole(0, 0, 127.5, 140.72, 0.42);
  for (let i = 0; i < 8; i++) L.treat(i * 100 + 30, 0.95, 128.6 + i * 1.3);
  L.gull({ a: 20, r: 8, y: 132, arc: 150, speed: 0.3 });
  L.piece('cat_perch', 0, 0, TOP_Y);
  L.heart(200, 2.0, 123.2);
  L.hint((p) => p.pos.y > 113 && p.pos.y < 115.5 && p.radial < 3, 'Climb the mast. {move} left and right circles around it.');
}

// ---------------------------------------------------------------------------------------------------- festival lights
function lights(L) {
  // strings of bulbs from the pavilion roof to the lamp posts
  for (let a = 0; a < 360; a += 30) L.cableCyl([a, 12.0, 3.6], [a + 15, 5.3, 12.5], { sag: 1.4, kind: 'bulbs' });
  // bunting around the pavilion
  for (let a = 0; a < 360; a += 45) L.cableCyl([a, 12.1, 3.3], [a + 45, 12.1, 3.3], { sag: 0.5, kind: 'flags', spacing: 0.7 });
  // bunting up the shaft
  for (const y of [22, 30, 44, 68, 80, 88]) {
    for (let a = 20; a < 380; a += 60) L.cableCyl([a, shaftR(y) + 0.25, y + 1.4], [a + 60, shaftR(y) + 0.25, y + 1.4], { sag: 0.9, kind: y % 3 ? 'flags' : 'both', spacing: 0.62 });
  }
  // light strings under the saucer, and from the mast down to the roof edge like a circus tent
  for (let a = 15; a < 360; a += 45) L.cableCyl([a, 6.6, 93.5], [a + 12, 15.0, 99.0], { sag: 0.7, kind: 'bulbs', spacing: 0.9 });
  for (let a = 0; a < 360; a += 40) L.cableCyl([a, 0.5, 133.5], [a, 16.8, 107.1], { sag: 3.2, kind: 'bulbs', spacing: 1.25 });
}

// ---------------------------------------------------------------------------------------------------- collision helpers
function disc(y, radius) {
  const g = new THREE.CircleGeometry(radius, 40);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return strip(g);
}
function box3(centre, size, aDeg) {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.rotateY(aDeg * DEG); g.translate(centre.x, centre.y, centre.z);
  return strip(g);
}
/** A cylinder wall with a gap between angles gapA0..gapA1 (degrees). */
function openRing(radius, y0, y1, gapA0, gapA1) {
  const span = (360 - (gapA1 - gapA0)) * DEG;
  const g = new THREE.CylinderGeometry(radius, radius, y1 - y0, 56, 1, true, gapA1 * DEG, span);
  g.translate(0, (y0 + y1) / 2, 0);
  return strip(g);
}
function strip(g) {
  const out = new THREE.BufferGeometry();
  const flat = g.index ? g.toNonIndexed() : g;
  out.setAttribute('position', flat.getAttribute('position'));
  return out;
}

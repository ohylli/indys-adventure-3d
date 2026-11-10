// The bot's route up the tower, section by section. Injected into the page after tests/bot.js.
// Each section starts where the previous one ends; `cp` is the checkpoint to start from when a section is run alone.
(() => {
  const b = window.bot;
  const { A, R, Y, P, G, norm } = b;
  const ent = (type) => G().level.entities.filter((e) => e.type === type);     // (class names do not survive the build)
  const windCalm = () => ent('wind').every((w) => w.level < 0.05 && !w.warned && !w.blowing);

  window.route = [
    {
      name: 'plaza', cp: null,
      run() {
        b.walk(40, 27);
        b.walk(105, 22, { meow: true });
        // the climbing frame: up the net, across two decks (the long way round; teaches climbing)
        b.walk(118, 17);
        b.walk(118, 14, { until: () => P().state === 'climb', max: 300 });
        b.expect(P().state === 'climb', 'to grab the net');
        b.climb(99); b.land(118, 13.9);
        b.expect(Math.abs(Y() - 5) < 0.2, 'to stand on the deck above the net');
        b.jump(130, 14.4);
        b.expect(Math.abs(Y() - 4.2) < 0.3, 'to reach the second deck');
      },
    },
    {
      name: 'ferris', cp: 1,
      run() {
        b.walk(140, 20, { fall: true, tol: 0.8 });
        b.walk(150, 18.3);
        // wait for a gondola coming through the bottom, then hop in
        const hubY = 11.9;
        b.wait(() => b.mover('ferris_gondola', (g) => g.p.y - 2.4 < 2.0 && norm(g.a - 150) > -7.5 && norm(g.a - 150) < -5).length > 0, 2400, 'gondola at the bottom');
        b.jump(150.3, 16.5, { hold: 14 });
        b.expect(P().ground && P().ground.mover && P().ground.mover.name === 'ferris_gondola', 'to be in a gondola');
        const mine = P().ground.mover;
        // ride to the top, then jump to the pier
        b.wait(() => mine.object.position.y > hubY + 7.6 && norm(Math.atan2(mine.object.position.x, mine.object.position.z) * 180 / Math.PI - 150) < 4, 3000, 'top of the wheel');
        b.expect(P().ground && P().ground.mover === mine, 'to still be in the gondola at the top');
        b.jump(150, 13.2, { hold: 10 });
        b.expect(Y() > 16 && R() < 15, 'to be on the pier');
        b.walk(150, 8.5);
        b.walk(166, 6.8);
      },
    },
    {
      name: 'coaster', cp: 2,
      run() {
        b.walk(186, 8.8);
        // run up the outer lane; the cars keep to the middle
        for (const a of [230, 280, 330, 20, 70, 120, 170, 220, 262]) b.walk(a, 8.9, { tol: 0.45 });
        b.walk(285, 8.4);
        b.expect(Math.abs(Y() - 37) < 0.3, 'to be at the top station');
        b.walk(305.5, 8.3);
      },
    },
    {
      name: 'drop', cp: 3,
      run() {
        b.walk(307, 7.9);
        const car = b.mover('drop_car')[0].m;
        b.wait(() => car.object.position.y < 37.02 && ((G().time) % 11.5) < 1.2, 2400, 'drop car at the bottom');
        b.walk(322, 7.7);
        b.expect(P().ground && P().ground.mover === car, 'to stand on the drop car');
        b.wait(() => car.object.position.y > 54.45, 1200, 'top of the drop ride');
        b.walk(338, 6.2);
        b.expect(Math.abs(Y() - 54.5) < 0.3, 'to be on the landing above the drop');
        b.walk(350, 6.1);
      },
    },
    {
      name: 'swinger', cp: 4,
      run() {
        b.walk(18, 6.7);
        // hop onto a seat as it swings past the low point
        b.wait(() => b.mover('swing_chair', (c) => norm(c.a - A()) > -13 && norm(c.a - A()) < -10).length > 0, 600, 'a swing seat');
        b.jump(A() + 0.5, 8.2, { hold: 12 });
        b.expect(P().ground && P().ground.mover && P().ground.mover.name === 'swing_chair', 'to be on a swing seat');
        const seat = P().ground.mover;
        b.wait(() => { const a = Math.atan2(seat.object.position.x, seat.object.position.z) * 180 / Math.PI; return norm(a - 196) > 0 && norm(a - 196) < 8; }, 1200, 'the high side');
        b.jump(A() + 9, 6.2, { hold: 8 });
        b.expect(Math.abs(Y() - 59.2) < 0.3, 'to be on the exit deck');
        b.walk(214, 6.1, { meow: true });
      },
    },
    {
      name: 'festival', cp: 5,
      run() {
        b.autoMeow = true;          // gull country from here on
        b.walk(230.5, 6.8);
        b.jump(240, 10.6);
        b.jump(249, 11.4); b.jump(259, 11.4); b.jump(269, 11.0);
        b.jump(281, 8.8);
        b.expect(Math.abs(Y() - 66.2) < 0.4, 'to be on the deck past the balloons');
        b.walk(280, 8.3);
        b.walk(280, 7.0, { until: () => P().state === 'climb', max: 300 });
        b.climb(99); b.land(280, 6.2);
        b.expect(Math.abs(Y() - 74.2) < 0.3, 'to be above the ladders');
        // stepping pads, between gusts
        for (const [a, r] of [[301, 7.3], [336, 7.4], [12, 7.3], [48, 7.4]]) {
          b.wait(windCalm, 900, 'calm air');
          b.walk(A() + 4.5, r, { tol: 0.25, max: 120 });
          b.wait(windCalm, 900, 'calm air');
          b.jump(a, r, { meow: true });
        }
        b.expect(Math.abs(Y() - 79.6) < 0.4, 'to be on the last pad');
        // the hot-air balloon lift
        const hab = b.mover('hot_air_balloon')[0].m;
        b.walk(54, 7.9, { tol: 0.25 });
        b.wait(() => hab.object.position.y < 80.7 && windCalm(), 2400, 'the balloon to come down');
        b.jump(66, 10.6);
        b.expect(P().ground && P().ground.mover === hab, 'to stand on the balloon');
        b.wait(() => hab.object.position.y > 86.1, 1200, 'the balloon to rise');
        b.walk(73, 10.2, { tol: 0.3, max: 120 });
        b.jump(93, 8.8, { meow: true });
        b.expect(Math.abs(Y() - 86.6) < 0.4, 'to be on the deck under the banner');
        b.walk(99, 8.0, { meow: true });
        b.walk(99, 6.6, { until: () => P().state === 'climb', max: 300 });
        b.climb(99, { meow: true }); b.land(99, 6.0);
        b.expect(Math.abs(Y() - 92.5) < 0.3, 'to be on the ring balcony');
        b.walk(118, 5.9);
      },
    },
    {
      name: 'underside', cp: 7,
      run() {
        b.autoMeow = true;
        b.walk(126, 6.3);
        for (const [a, r] of [[131, 8.4], [143, 10.0], [155, 11.6], [167, 13.4], [179, 15.6], [190, 16.9]]) b.jump(a, r);
        b.jump(200, 15.8);
        b.expect(P().state === 'climb', 'to grab the banner under the brim');
        b.climb(999); b.land(201, 14.2);
        b.expect(Math.abs(Y() - 99.5) < 0.3, 'to be on the observation deck brim');
        b.walk(208, 14);
      },
    },
    {
      name: 'restaurant', cp: 8,
      run() {
        b.autoMeow = true;
        // along the brim: shoo the jackdaws, slip past the sparklers when they are off
        b.walk(216, 14.1, { meow: true });
        b.hold({ meow: true }, 30);
        b.walk(236, 14.2, { meow: true });
        const sparks = ent('sparkler');
        for (const a of [244, 262, 280]) {
          const s = sparks.find((e) => Math.abs(norm(Math.atan2(e.pos.x, e.pos.z) * 180 / Math.PI - a)) < 2 && e.pos.y < 105);
          b.walk(a - 5, 14.0);
          b.wait(() => { const o = s.o, k = (G().time + o.phase) % (o.on + o.off); return k > o.on + 0.1 && k < o.on + 0.5; }, 600, 'sparkler off');
          b.jump(a + 5, 14.0, { hold: 12 });
        }
        b.walk(292, 14.6);
        // a rope on the revolving brim comes by: leap out and grab it
        b.wait(() => { const p = P(); return G().world.climbs.some((c) => c.mover && c.type === 'pole' && (() => { const q = c.mover.object.position; const a = Math.atan2(q.x, q.z) * 180 / Math.PI; return norm(a - A()) > -4.5 && norm(a - A()) < -2.5; })()); }, 3600, 'a rope');
        b.jump(A() + 0.5, 17.5, { hold: 20 });
        b.expect(P().state === 'climb', 'to hang on the rope');
        b.climb(999); b.land(A(), 15.3);
        b.expect(Math.abs(Y() - 103) < 0.3 && P().ground && P().ground.mover, 'to stand on the revolving brim');
        // ride round to a rope that hangs from the roof
        b.wait(() => [60, 180, 300].some((a) => norm(a - A()) > 3 && norm(a - A()) < 6), 3600, 'a roof rope');
        const target = [60, 180, 300].find((a) => norm(a - A()) > 0 && norm(a - A()) < 12);
        b.walk(target - 3, 16.0, { tol: 0.3, max: 200 });
        b.jump(target, 17.5, { hold: 16 });
        b.expect(P().state === 'climb', 'to hang on the roof rope');
        b.climb(999); b.land(target, 15.5);
        b.expect(Y() > 106.8, 'to be on the roof');
        b.walk(target + 9, 14.6);
      },
    },
    {
      name: 'needle', cp: 10,
      run() {
        b.autoMeow = true;
        const a0 = Math.round(A());
        // up the drums, using a gift box as a step
        const box = [90, 210, 330].find((a) => Math.abs(norm(a - A())) < 60);
        b.walk(box - 14, 8.2, { tol: 0.5 });
        b.walk(box, 8.0, { tol: 0.4 });
        b.jump(box, 6.4, { hold: 20 });
        b.jump(box, 4.4);
        b.expect(Y() > 111.5, 'to be on the first drum');
        b.jump(box, 3.0);
        b.jump(box, 1.9);
        b.expect(Y() > 113.9, 'to be at the foot of the mast');
        b.walk(box, 0.5, { until: () => P().state === 'climb', max: 200 });
        b.expect(P().state === 'climb', 'to grab the mast');
        // each hop over the top may catch the next pole in mid-air, which is fine
        b.climb(999); b.land(A(), 1.6, { orClimb: true });
        b.expect(Y() > 123.1, 'to be on the maintenance ring');
        if (P().state !== 'climb') b.walk(A(), 0.5, { until: () => P().state === 'climb', max: 200 });
        b.climb(999); b.land(A(), 0.9, { orClimb: true });
        b.expect(Y() > 127.3, 'to be on the crow’s nest');
        if (P().state !== 'climb') b.walk(A(), 0.1, { until: () => P().state === 'climb', max: 200 });
        b.climb(999);
        b.wait(() => G().state === 'claim', 240, 'the claim');
      },
    },
  ];
})();

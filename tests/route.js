// The bot's route up the tower, section by section. Injected into the page after tests/bot.js.
// Each section starts where the previous one ends; `cp` is the checkpoint to start from when a section is run alone.
// b.beat() is a pause for the showcase video (tools/record.mjs) and does nothing in tests: only use it on safe footing.
(() => {
  const b = window.bot;
  const { A, R, Y, P, G, norm } = b;
  const DEG = Math.PI / 180;
  const ent = (type) => G().level.entities.filter((e) => e.type === type);     // (class names do not survive the build)
  const windCalm = () => ent('wind').every((w) => w.level < 0.05 && !w.warned && !w.blowing);

  window.route = [
    {
      name: 'plaza', cp: null,
      async run() {
        await b.beat(2.5);
        await b.walk(40, 27);
        await b.walk(105, 22, { meow: true });
        // the climbing frame: up the net, across two decks (the long way round; teaches climbing)
        await b.walk(118, 17);
        await b.walk(118, 14, { until: () => P().state === 'climb', max: 300 });
        b.expect(P().state === 'climb', 'to grab the net');
        await b.climb(99); await b.land(118, 13.9);
        b.expect(Math.abs(Y() - 5) < 0.2, 'to stand on the deck above the net');
        await b.jump(130, 14.4);
        b.expect(Math.abs(Y() - 4.2) < 0.3, 'to reach the second deck');
        await b.beat(1);
      },
    },
    {
      name: 'ferris', cp: 1,
      async run() {
        await b.walk(140, 20, { fall: true, tol: 0.8 });
        await b.walk(150, 18.3);
        // wait for a gondola coming through the bottom, then hop in
        const hubY = 11.9;
        await b.wait(() => b.mover('ferris_gondola', (g) => g.p.y - 2.4 < 2.0 && norm(g.a - 150) > -7.5 && norm(g.a - 150) < -5).length > 0, 2400, 'gondola at the bottom');
        await b.jump(150.3, 16.5, { hold: 14 });
        b.expect(P().ground && P().ground.mover && P().ground.mover.name === 'ferris_gondola', 'to be in a gondola');
        const mine = P().ground.mover;
        // ride to the top, then jump to the pier
        await b.wait(() => mine.object.position.y > hubY + 7.6 && norm(Math.atan2(mine.object.position.x, mine.object.position.z) * 180 / Math.PI - 150) < 4, 3000, 'top of the wheel');
        b.expect(P().ground && P().ground.mover === mine, 'to still be in the gondola at the top');
        await b.jump(150, 13.2, { hold: 10 });
        b.expect(Y() > 16 && R() < 15, 'to be on the pier');
        await b.beat(1.5);
        await b.walk(150, 9.8);
        await b.walk(162, 10.4);
        await b.walk(173, 10.6);
      },
    },
    {
      name: 'coaster', cp: 2,
      async run() {
        const cars = b.mover('coaster_car').map((c) => c.m);
        // how far up the lane the nearest oncoming car is (99 if none is near Indy's level)
        const oncoming = () => {
          let best = 99;
          for (const c of cars) {
            const p = c.object.position;
            if (!c.object.visible || Math.abs(p.y - Y()) > 3) continue;
            const d = norm(Math.atan2(p.x, p.z) / DEG - A()) * DEG * 7.6;
            if (d > 0.4 && d < best) best = d;
          }
          return best;
        };
        await b.walk(186, 10.3);
        // up the lane, jumping each train as it comes. Coming down on a car's roof is fine: walk on over the train.
        const atTop = () => Y() > 36.9 && !!P().ground && !P().ground.mover;
        const near = () => oncoming() < 4.4 && P().state === 'ground';
        for (let i = 0; i < 600 && !atTop(); i++) {
          await b.walk(A() + 8, 7.6, { until: () => near() || atTop(), tol: 0.4, max: 240 });
          if (near() && !atTop()) await b.jump(A() + 30, 7.6, { hold: 30, within: 99 });
        }
        b.expect(atTop(), 'to be at the top station');
        // round the outside of the car shed
        await b.walk(246, 10.2); await b.walk(264, 10.4); await b.walk(279, 10.2); await b.walk(286, 8.4);
        await b.beat(1.5);
        await b.walk(305.5, 8.3);
      },
    },
    {
      name: 'drop', cp: 3,
      async run() {
        await b.walk(307, 7.9);
        const car = b.mover('drop_car')[0].m;
        await b.wait(() => car.object.position.y < 37.02, 900, 'drop car at the bottom');
        await b.walk(322, 7.7);
        b.expect(P().ground && P().ground.mover === car, 'to stand on the drop car');
        await b.wait(() => car.object.position.y > 54.45, 1200, 'top of the drop ride');
        await b.walk(338, 6.2);
        b.expect(Math.abs(Y() - 54.5) < 0.3, 'to be on the landing above the drop');
        await b.beat(1.5);
        await b.walk(350, 6.1);
      },
    },
    {
      name: 'swinger', cp: 4,
      async run() {
        await b.walk(18, 6.7);
        // hop onto a seat as it swings past the low point
        await b.wait(() => b.mover('swing_chair', (c) => norm(c.a - A()) > -13 && norm(c.a - A()) < -10).length > 0, 600, 'a swing seat');
        await b.jump(A() + 0.5, 8.2, { hold: 12 });
        b.expect(P().ground && P().ground.mover && P().ground.mover.name === 'swing_chair', 'to be on a swing seat');
        const seat = P().ground.mover;
        // on the high side the seat sweeps along the exit deck, which is just outside it: step off
        await b.wait(() => { const a = Math.atan2(seat.object.position.x, seat.object.position.z) * 180 / Math.PI; return norm(a - 166) > 0 && norm(a - 166) < 8; }, 1200, 'the high side');
        await b.walk(A() + 9, 10.7, { tol: 0.4, max: 200, fall: true });
        b.expect(Math.abs(Y() - 58.9) < 0.3 && P().ground && !P().ground.mover, 'to be on the exit deck');
        await b.beat(1.5);
        await b.walk(180, 10.2, { meow: true });
      },
    },
    {
      name: 'festival', cp: 5,
      async run() {
        b.autoMeow = true;          // gull country from here on
        await b.walk(191, 11.3, { meow: true });
        for (const a of [206.7, 225.7, 244.7, 263.7]) await b.jump(a, 11.3);
        await b.jump(277.5, 11.3);
        b.expect(Math.abs(Y() - 66.2) < 0.4, 'to be on the deck past the balloons');
        await b.beat(1.5);
        await b.walk(280, 8.4);
        await b.walk(280, 7.0, { until: () => P().state === 'climb', max: 300 });
        await b.climb(99); await b.land(280, 6.2);
        b.expect(Math.abs(Y() - 74.2) < 0.3, 'to be above the ladders');
        // stepping pads, between gusts
        for (const [a, r] of [[304, 7.3], [338, 7.4], [12, 7.3], [46, 7.4]]) {
          await b.wait(windCalm, 900, 'calm air');
          await b.walk(A() + 4.5, r, { tol: 0.25, max: 120 });
          await b.wait(windCalm, 900, 'calm air');
          await b.jump(a, r, { meow: true });
        }
        b.expect(Math.abs(Y() - 79.6) < 0.4, 'to be on the last pad');
        // the hot-air balloon lift: it waits beside the last pad and rises once Indy is on it
        const hab = b.mover('hot_air_balloon')[0].m;
        await b.wait(() => hab.object.position.y < 80.5 && windCalm(), 1200, 'the balloon to be down');
        await b.walk(A() + 5, 7.5, { tol: 0.25, max: 120 });
        await b.jump(80, 8.0);
        b.expect(P().ground && P().ground.mover === hab, 'to stand on the balloon');
        await b.wait(() => hab.object.position.y > 86.7, 1200, 'the balloon to rise');
        await b.walk(86, 8.2, { tol: 0.3, max: 120 });
        await b.jump(110, 8.7, { meow: true });
        b.expect(Math.abs(Y() - 86.6) < 0.4, 'to be on the deck under the banner');
        await b.walk(117, 8.0, { meow: true });
        await b.walk(117, 6.6, { until: () => P().state === 'climb', max: 300 });
        await b.climb(99, { meow: true }); await b.land(117, 6.0);
        b.expect(Math.abs(Y() - 92.5) < 0.3, 'to be on the ring balcony');
        await b.beat(1.5);
        await b.walk(124, 5.9);
      },
    },
    {
      name: 'underside', cp: 7,
      async run() {
        b.autoMeow = true;
        await b.walk(134, 6.3);
        await b.walk(134, 10.0);                   // out along the plank
        await b.jump(159, 10.0); await b.jump(184, 10.0);
        await b.jump(207, 10.2);                   // onto the strut
        b.expect(Math.abs(Y() - 95.5) < 0.2, 'to be on the strut');
        await b.beat(1);
        await b.walk(209.5, 16.3);                 // out along it
        await b.jump(225.7, 16.3); await b.jump(241, 16.3);
        // the banner hangs right behind the last lantern: push into it
        await b.walk(241, 15.5, { until: () => P().state === 'climb', max: 200 });
        b.expect(P().state === 'climb', 'to grab the banner under the brim');
        await b.climb(999); await b.land(242, 14.2);
        b.expect(Math.abs(Y() - 99.5) < 0.3, 'to be on the observation deck brim');
        await b.beat(1.5);
        await b.walk(249, 14);
      },
    },
    {
      name: 'restaurant', cp: 8,
      async run() {
        b.autoMeow = true;
        // along the brim: shoo the jackdaws, slip past the sparklers when they are off
        await b.walk(257, 14.1, { meow: true });
        await b.hold({ meow: true }, 30);
        await b.walk(277, 14.2, { meow: true });
        const sparks = ent('sparkler');
        for (const a of [285, 303, 321]) {
          const s = sparks.find((e) => Math.abs(norm(Math.atan2(e.pos.x, e.pos.z) * 180 / Math.PI - a)) < 2 && e.pos.y < 105);
          await b.walk(a - 5, 14.0);
          await b.wait(() => { const o = s.o, k = (G().time + o.phase) % (o.on + o.off); return k > o.on + 0.1 && k < o.on + 0.5; }, 600, 'sparkler off');
          await b.jump(a + 5, 14.0, { hold: 12 });
        }
        await b.walk(338, 14.7);
        // out on the jetty, under the path of the ropes that hang from the revolving brim: jump up as one comes by
        await b.walk(344, 15.0); await b.walk(344, 17.4, { tol: 0.25 });
        await b.wait(() => G().world.climbs.some((c) => { if (!c.mover || c.type !== 'pole') return false; const q = c.mover.object.position; const d = norm(Math.atan2(q.x, q.z) / DEG - A()); return d > -3 && d < -0.5; }), 3600, 'a rope');
        await b.jump(A(), 17.45, { hold: 20, still: true });
        b.expect(P().state === 'climb', 'to hang on the rope');
        await b.climb(999); await b.land(A(), 15.6);
        b.expect(Math.abs(Y() - 103) < 0.3 && P().ground && P().ground.mover, 'to stand on the revolving brim');
        // ride round to a rope that hangs from the roof
        const ropes = [0, 60, 120, 180, 240, 300];
        await b.wait(() => ropes.some((a) => norm(a - A()) > 3 && norm(a - A()) < 6), 3600, 'a roof rope');
        const target = ropes.find((a) => norm(a - A()) > 0 && norm(a - A()) < 12);
        await b.walk(target - 3, 16.0, { tol: 0.3, max: 200 });
        await b.jump(target, 17.5, { hold: 16 });
        b.expect(P().state === 'climb', 'to hang on the roof rope');
        await b.climb(999); await b.land(target, 15.5);
        b.expect(Y() > 106.8, 'to be on the roof');
        await b.beat(1.5);
        await b.walk(target + 9, 14.6);
      },
    },
    {
      name: 'needle', cp: 10,
      async run() {
        b.autoMeow = true;
        const a0 = Math.round(A());
        // up the drums, using a gift box as a step
        const box = [90, 210, 330].find((a) => Math.abs(norm(a - A())) < 60);
        await b.walk(box - 14, 8.2, { tol: 0.5 });
        await b.walk(box, 8.0, { tol: 0.4 });
        await b.jump(box, 6.4, { hold: 20 });
        await b.jump(box, 4.4);
        b.expect(Y() > 111.5, 'to be on the first drum');
        await b.jump(box, 3.0);
        await b.jump(box, 1.9);
        b.expect(Y() > 113.9, 'to be at the foot of the mast');
        await b.beat(1.5);
        await b.walk(box, 0.5, { until: () => P().state === 'climb', max: 200 });
        b.expect(P().state === 'climb', 'to grab the mast');
        // each hop over the top may catch the next pole in mid-air, which is fine
        await b.climb(999); await b.land(A(), 1.6, { orClimb: true });
        b.expect(Y() > 123.1, 'to be on the maintenance ring');
        if (P().state !== 'climb') await b.walk(A(), 0.5, { until: () => P().state === 'climb', max: 200 });
        await b.climb(999); await b.land(A(), 0.9, { orClimb: true });
        b.expect(Y() > 127.3, 'to be on the crow’s nest');
        if (P().state !== 'climb') await b.walk(A(), 0.1, { until: () => P().state === 'climb', max: 200 });
        await b.climb(999);
        await b.wait(() => G().state === 'claim', 240, 'the claim');
      },
    },
  ];
})();

// Rain on the window - a city at night out of focus behind wet glass: clusters
// of bokeh lights, beads on the pane and drops that run down and clear a path,
// a warm mug steaming on the sill; the rain eases as the break goes on.
// Music: lo-fi hip hop in E-flat (72 bpm): dusty Rhodes-like comping, kalimba droplets, a piano
// answer, upright bass walking in the middle, rim and hats; rain on the glass.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A bokeh disc: flat, soft-edged, its rim a touch brighter - the way a lens blurs a light.
  function disc(r, rgb) {
    var c = K.canvas(r * 2 + 2, r * 2 + 2); var x = c.getContext('2d');
    x.fillStyle = K.radial(x, r + 1, r + 1, r, [[0, 'rgba(' + rgb + ',0.42)'], [0.72, 'rgba(' + rgb + ',0.5)'],
      [0.9, 'rgba(' + rgb + ',0.72)'], [1, 'rgba(' + rgb + ',0)']]);
    x.beginPath(); x.arc(r + 1, r + 1, r, 0, Math.PI * 2); x.fill();
    return c;
  }

  // A bead of water on the glass, at full resolution: a darker lower edge, the street's
  // light gathered inside it, a small warm caustic low down and a glint at the top.
  function bead(x, cx, cy, r, a) {
    a = a === undefined ? 1 : a;
    x.fillStyle = 'rgba(3, 4, 12, ' + (0.36 * a).toFixed(3) + ')';
    x.beginPath(); x.ellipse(cx, cy + r * 0.16, r, r * 1.05, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = K.radial(x, cx - r * 0.15, cy - r * 0.25, r * 1.1, [[0, 'rgba(70, 72, 110, ' + (0.32 * a).toFixed(3) + ')'],
      [1, 'rgba(150, 120, 140, ' + (0.18 * a).toFixed(3) + ')']]);
    x.beginPath(); x.ellipse(cx, cy, r * 0.86, r * 0.9, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255, 190, 140, ' + (0.3 * a).toFixed(3) + ')';
    x.beginPath(); x.ellipse(cx + r * 0.08, cy + r * 0.5, r * 0.45, r * 0.2, 0, 0, Math.PI * 2); x.fill();
    if (r > 1.6) {
      x.fillStyle = 'rgba(255, 248, 238, ' + (0.62 * a).toFixed(3) + ')';
      x.beginPath(); x.ellipse(cx - r * 0.3, cy - r * 0.42, Math.max(0.5, r * 0.2), Math.max(0.4, r * 0.13), -0.5, 0, Math.PI * 2); x.fill();
    }
  }

  RelaxBiomes.register({
    id: 'rain-window',
    name: 'Rain on the window',
    about: 'A city at night out of focus behind wet glass: clusters of bokeh lights, drops running down, a mug steaming, the rain slowly easing. Lo-fi hip hop in E-flat: dusty keys, kalimba droplets, a piano answer, upright bass walking in the middle, rim and hats, rain on the glass.',
    ink: '255, 236, 222',
    shade: '6, 6, 16',
    vignette: 0.34,
    grade: { shadow: '10, 9, 24', light: '255, 240, 224' },
    level: 0.577, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.811,

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var SILL = 0.84; // where the glass ends and the sill begins, as a part of the height
      var sill = H * SILL, sillY = SH * SILL;

      // The street beyond: deep blue night, a low warm glow from the city and two towers
      // out of focus against it.
      var bg = s.layer(), bx = bg.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, 0, H, [[0, '#070917'], [0.4, '#0e1228'], [0.68, '#1b1630'], [0.86, '#2c1c2c'], [1, '#22161f']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'lighter';
      bx.fillStyle = K.radial(bx, W * (0.5 - 0.15 * inner), H * 1.02, W * 0.62, [[0, 'rgba(255, 150, 96, 0.2)'], [0.6, 'rgba(255, 130, 96, 0.06)'], [1, 'rgba(255, 130, 96, 0)']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'source-over';
      var towers = s.layer(), tx = towers.getContext('2d');
      var towerAt = main ? [0.5 + 0.27 * inner, 0.5 + 0.38 * inner] : [0.5 - 0.3 * inner];
      towerAt.forEach(function (u, i) {
        var tw = W * (0.07 + 0.04 * i), top = H * (0.16 + 0.12 * i);
        tx.fillStyle = K.linear(tx, 0, top, 0, H, [[0, 'rgba(6, 7, 18, 0)'], [0.45, 'rgba(6, 7, 18, 0.45)'], [1, 'rgba(10, 8, 20, 0.7)']]);
        tx.fillRect(W * u - tw / 2, top, tw, H - top);
      });
      bx.drawImage(K.blurred(towers, 3), 0, 0);

      // The lights: three loose clusters with quiet dark between them - a lit tower,
      // the street below it and a far corner. Mostly sodium amber, a few warm white, a rose sign.
      var AMBER = '255, 176, 96', WARM = '255, 222, 178', ROSE = '236, 116, 132', COOL = '196, 212, 255';
      var layers = [0, 1, 2, 3].map(function () { var c = s.layer(); return { c: c, x: c.getContext('2d') }; });
      function light(L, x, y, r, a, rgb) {
        var img = disc(Math.max(2, Math.round(r)), rgb);
        L.x.globalCompositeOperation = 'lighter'; L.x.globalAlpha = Math.min(1, a);
        L.x.drawImage(img, x - img.width / 2, y - img.height / 2);
      }
      var pick = function () { var q = rnd(); return q < 0.55 ? AMBER : q < 0.82 ? WARM : q < 0.93 ? ROSE : COOL; };
      // the tower's windows (layer 2 and 3 go dark one by one as the evening settles)
      towerAt.forEach(function (u, ti) {
        var top = H * (0.2 + 0.12 * ti);
        for (var wi = 0; wi < 9; wi++) {
          if (rnd() < 0.4) continue;
          light(layers[wi % 3 === 0 ? 2 : wi % 3 === 1 ? 3 : 0], W * u + (rnd() - 0.5) * W * 0.05, top + wi * H * 0.045 + rnd() * H * 0.015,
            H * (0.012 + 0.008 * rnd()), 0.16 + 0.16 * rnd(), rnd() < 0.8 ? '255, 200, 128' : COOL);
        }
      });
      var clusters = main ? [[0.5 - 0.3 * inner, 0.74, 0.2, 14], [0.5 + 0.3 * inner, 0.72, 0.12, 9], [0.5 + 0.05 * inner, 0.8, 0.08, 4]]
        : [[0.5 - 0.22 * inner, 0.76, 0.16, 9], [0.5 + 0.34 * inner, 0.79, 0.08, 4]];
      clusters.forEach(function (cl) {
        for (var i = 0; i < cl[3]; i++) {
          var depth = Math.pow(rnd(), 1.8);
          light(layers[i % 2], W * (cl[0] + (rnd() + rnd() - 1) * cl[2]), H * (cl[1] + (rnd() - 0.5) * 0.09 + 0.05 * depth),
            H * (0.02 + 0.075 * depth), 0.14 + 0.24 * rnd() * (1 - depth * 0.4), pick());
        }
      });
      // two big, very near, very faint ones
      light(layers[1], W * (0.5 - 0.38 * inner), H * 0.5, H * 0.15, 0.06, WARM);
      light(layers[0], W * (0.5 + 0.12 * inner), H * 0.86, H * 0.12, 0.05, AMBER);
      var breath = [[0.09, 1.3], [0.06, 4.1]];

      // Rain falling outside, out of focus: thin soft streaks scrolling down. It eases.
      // The texture wraps top to bottom, so it can scroll without a seam.
      var rain = K.canvas(Math.ceil(W / 2), Math.ceil(H / 2)), rnx = rain.getContext('2d');
      (function () {
        var r = K.seeded(71 + s.seed), rw = rain.width, rh2 = rain.height;
        rnx.lineCap = 'round';
        // each streak tapers in and out and they vary in length, so none reads as a scratch
        for (var i = 0; i < 150; i++) {
          var x0 = r() * rw, y0 = r() * rh2, len = 3 + Math.pow(r(), 1.5) * 20, a = 0.04 + 0.11 * r();
          rnx.lineWidth = 0.4 + r() * 0.6;
          for (var k = -1; k <= 0; k++) {
            var ya = y0 + k * rh2;
            rnx.strokeStyle = K.linear(rnx, 0, ya, 0, ya + len, [[0, 'rgba(190, 196, 228, 0)'], [0.6, 'rgba(190, 196, 228, ' + a.toFixed(3) + ')'],
              [1, 'rgba(190, 196, 228, 0)']]);
            rnx.beginPath(); rnx.moveTo(x0, ya); rnx.lineTo(x0 - len * 0.08, ya + len); rnx.stroke();
          }
        }
      })();
      // A car's lights now and then, low and dim.
      var carImg = disc(Math.round(H * 0.035), '255, 214, 170'), tailImg = disc(Math.round(H * 0.03), '240, 80, 70');

      // The glass, beads and the mist of fine droplets: a crisp full-resolution sprite the
      // running drops wipe clean, re-wetted slowly while the rain lasts.
      // Where the water drains: three or four meandering lanes down the pane. Beads gather
      // along them, the running drops follow them, and the glass between stays fairly clear.
      var lanes = [], lr = K.seeded(55 + s.seed), nL = 3 + (lr() < 0.5 ? 1 : 0);
      for (var li = 0; li < nL; li++) {
        lanes.push({ x0: SW * (0.08 + 0.84 * (li + 0.2 + 0.6 * lr()) / nL), amp: SW * (0.012 + 0.018 * lr()), f: 2 + 2 * lr(),
          ph: lr() * 6.3, w: SW * (0.03 + 0.025 * lr()) });
      }
      function laneX(L, y) { return L.x0 + Math.sin(y / sillY * L.f + L.ph) * L.amp + K.noise1(y / 90 + L.ph, 3) * L.amp * 0.6; }
      function nearLane(r, spread) {
        var L = lanes[Math.floor(r() * lanes.length)], y = Math.pow(r(), 0.8) * sillY, g = (r() + r() + r() - 1.5) / 1.5;
        return [laneX(L, y) + g * L.w * (spread || 1), y];
      }
      var glass = s.sprite(SW, Math.ceil(sillY), function (x, w, h) {
        var r = K.seeded(301 + s.seed);
        for (var i = 0; i < 900; i++) {
          var q0 = r() < 0.7 ? nearLane(r, 1.8) : [r() * w, r() * h];
          var px = q0[0], py = q0[1], pr = 0.7 + r() * 1.1;
          x.fillStyle = 'rgba(3, 4, 12, 0.22)'; x.beginPath(); x.arc(px, py + pr * 0.3, pr, 0, Math.PI * 2); x.fill();
          x.fillStyle = 'rgba(224, 204, 216, ' + (0.12 + 0.14 * r()).toFixed(3) + ')';
          x.beginPath(); x.arc(px, py, pr * 0.7, 0, Math.PI * 2); x.fill();
        }
        for (var j = 0; j < 115; j++) {
          var q1 = j < 85 ? nearLane(r, 1.2) : [r() * w, Math.pow(r(), 0.8) * h];
          bead(x, q1[0], q1[1], 2.2 + 11 * Math.pow(r(), 2.6));
        }
      });
      var gx = glass.el.getContext('2d');
      var drops = [], dropImgs = [6.5, 8, 9.5].map(function (dr) {
        return { r: dr, spr: null, draw: function (x, w, h) {
          var cx = w / 2, cy = h * 0.62;
          x.fillStyle = 'rgba(3, 4, 12, 0.45)';
          x.beginPath(); x.ellipse(cx, cy + dr * 0.18, dr * 1.05, dr * 1.2, 0, 0, Math.PI * 2); x.fill();
          x.beginPath(); x.moveTo(cx - dr * 0.5, cy - dr * 0.6); x.quadraticCurveTo(cx, cy - dr * 2.6, cx + dr * 0.5, cy - dr * 0.6); x.fill();
          x.fillStyle = K.radial(x, cx, cy - dr * 0.2, dr * 1.2, [[0, 'rgba(80, 80, 120, 0.4)'], [1, 'rgba(170, 130, 150, 0.25)']]);
          x.beginPath(); x.ellipse(cx, cy, dr * 0.9, dr * 1.02, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = 'rgba(255, 196, 150, 0.42)';
          x.beginPath(); x.ellipse(cx, cy + dr * 0.55, dr * 0.5, dr * 0.22, 0, 0, Math.PI * 2); x.fill();
          x.fillStyle = 'rgba(255, 250, 242, 0.75)';
          x.beginPath(); x.ellipse(cx - dr * 0.32, cy - dr * 0.45, dr * 0.22, dr * 0.15, -0.5, 0, Math.PI * 2); x.fill();
        } };
      });
      for (var d = 0; d < 4; d++) {
        var di = dropImgs[d % 3], dw = Math.ceil(di.r * 4), dh = Math.ceil(di.r * 5);
        drops.push({ spr: s.sprite(dw, dh, di.draw), r: di.r, w: dw, h: dh, x: 0, y: -100, v: 0, go: 0, live: false, trail: 0 });
      }
      var dr = K.seeded(911 + s.seed);
      function launch(q, t) {
        q.lane = lanes[Math.floor(dr() * lanes.length)]; q.off = (dr() - 0.5) * q.lane.w * 0.6;
        q.y = sillY * (0.05 + 0.5 * dr()); q.x = laneX(q.lane, q.y) + q.off; q.v = 0; q.go = t + dr() * 2; q.live = true; q.trail = 0;
        q.speed = 12 + 18 * dr();
      }

      // Steam from the mug, in its own small sprite so it rises in front of the glass.
      var mugU = 0.5 + 0.21 * inner, mugX = SW * mugU, mugW = SH * 0.068, mugH = SH * 0.078;
      var stW = Math.round(SH * 0.2), stH = Math.round(SH * 0.26), steam = null, stx = null, puff = null;
      if (main) {
        steam = s.sprite(stW, stH, function () {});
        steam.set(mugX - stW / 2, sillY - mugH - stH + 6, 0, 1);
        stx = steam.el.getContext('2d');
        puff = K.glow(Math.round(SH * 0.03), '232, 222, 228', [[0, 0.45], [0.5, 0.18], [1, 0]]);
      }

      // The room: the sill's lit top and its dark front, the frame, a mullion, and on the
      // main screen a mug and a plant; on the other a curtain and two books. The city
      // light from behind catches their upper edges.
      s.sprite(SW, SH, function (x, w, h) {
        var room = K.canvas(w, h), rx = room.getContext('2d');
        rx.fillStyle = '#0b080e';
        rx.fillRect(0, sillY + h * 0.03, w, h);
        rx.fillRect(0, 0, w, h * 0.022);
        var frame = w * 0.014;
        rx.fillRect(inner > 0 ? 0 : w - frame, 0, frame, sillY);
        if (main) rx.fillRect(w * (0.5 - 0.33 * inner) - w * 0.009, 0, w * 0.018, sillY);
        // the sill's top: a plane receding to the glass
        rx.fillStyle = '#1a1219';
        rx.beginPath(); rx.moveTo(0, sillY); rx.lineTo(w, sillY); rx.lineTo(w, sillY + h * 0.032); rx.lineTo(0, sillY + h * 0.032); rx.fill();
        var things = K.canvas(w, h), qx = things.getContext('2d'), r = K.seeded(55 + s.seed);
        qx.fillStyle = '#100b11';
        if (main) {
          // the mug
          var top = sillY + h * 0.012 - mugH;
          qx.beginPath();
          qx.ellipse(mugX, top, mugW / 2, mugW * 0.09, 0, Math.PI, 0);
          qx.bezierCurveTo(mugX + mugW * 0.53, top + mugH * 0.5, mugX + mugW * 0.48, top + mugH * 0.9, mugX + mugW * 0.4, top + mugH - 2);
          qx.quadraticCurveTo(mugX, top + mugH + 3, mugX - mugW * 0.4, top + mugH - 2);
          qx.bezierCurveTo(mugX - mugW * 0.48, top + mugH * 0.9, mugX - mugW * 0.53, top + mugH * 0.5, mugX - mugW / 2, top);
          qx.closePath(); qx.fill();
          qx.lineWidth = h * 0.009; qx.strokeStyle = '#100b11';
          qx.beginPath(); qx.arc(mugX - inner * mugW * 0.55, top + mugH * 0.42, mugH * 0.2, Math.PI * 0.5, Math.PI * 1.5, inner < 0); qx.stroke();
          // the plant: a pot and long leaves, each leaf a different length and curve
          var px = w * (0.5 - 0.27 * inner), pw = h * 0.07, ph = h * 0.056, pb = sillY + h * 0.014;
          qx.beginPath(); qx.moveTo(px - pw / 2, pb - ph); qx.lineTo(px + pw / 2, pb - ph);
          qx.lineTo(px + pw * 0.38, pb); qx.lineTo(px - pw * 0.38, pb); qx.closePath(); qx.fill();
          for (var l = 0; l < 11; l++) {
            var ang = -Math.PI / 2 + (r() - 0.5) * 2.2, len = h * (0.06 + 0.11 * r()), bend = (r() - 0.5) * 0.9;
            var ex = px + Math.cos(ang) * len, ey = pb - ph + Math.sin(ang) * len * 0.9;
            var lw = 0.16 + r() * 0.14;
            qx.beginPath(); qx.moveTo(px, pb - ph);
            qx.quadraticCurveTo(px + Math.cos(ang - lw + bend) * len * 0.6, pb - ph + Math.sin(ang - lw + bend) * len * 0.6, ex, ey);
            qx.quadraticCurveTo(px + Math.cos(ang + lw + bend) * len * 0.55, pb - ph + Math.sin(ang + lw + bend) * len * 0.55, px, pb - ph);
            qx.fill();
          }
        } else {
          // a curtain falling on the outer side, and two books lying on the sill
          var cxp = inner < 0 ? w : 0, cd = inner < 0 ? -1 : 1, cw = w * 0.11;
          qx.beginPath(); qx.moveTo(cxp, 0); qx.lineTo(cxp + cd * cw * 0.9, 0);
          for (var cy = 0; cy <= sillY + h * 0.03; cy += 8) {
            qx.lineTo(cxp + cd * cw * (0.82 + 0.1 * Math.sin(cy / h * 9) + 0.12 * (cy / sillY)), cy);
          }
          qx.lineTo(cxp, sillY + h * 0.03); qx.closePath(); qx.fill();
          var bxp = w * (0.5 + 0.2 * inner), by = sillY + h * 0.014;
          qx.fillRect(bxp - h * 0.09, by - h * 0.022, h * 0.18, h * 0.022);
          qx.fillRect(bxp - h * 0.075, by - h * 0.04, h * 0.15, h * 0.018);
        }
        K.rim(things, -inner * 0.35, -1, 2.6, '255, 184, 140', 0.7, 0.8);
        rx.drawImage(things, 0, 0);
        // the city's light along the sill's front edge, faint
        rx.fillStyle = K.linear(rx, 0, sillY, 0, sillY + h * 0.032, [[0, 'rgba(185, 129, 104, 0.32)'], [0.2, 'rgba(185, 129, 104, 0.12)'], [1, 'rgba(185, 129, 104, 0)']]);
        rx.fillRect(0, sillY, w, h * 0.032);
        x.drawImage(room, 0, 0);
      });

      var lastT = 0, nextBead = 0;
      return {
        paint: function (ctx, t, p) {
          var dt = Math.min(0.2, Math.max(0, t - lastT)); lastT = t;
          var ease = 1 - 0.78 * K.smooth(p); // the rain eases over the break
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bg, 0, 0);
          // the city settles: the lights dim a little, tower windows go dark one by one
          ctx.globalCompositeOperation = 'lighter';
          var dim = 1 - 0.18 * p;
          ctx.globalAlpha = dim * (0.85 + 0.15 * K.noise1(t * breath[0][0], breath[0][1])); ctx.drawImage(layers[0].c, 0, 0);
          ctx.globalAlpha = dim * (0.85 + 0.15 * K.noise1(t * breath[1][0], breath[1][1])); ctx.drawImage(layers[1].c, 0, 0);
          ctx.globalAlpha = dim * (1 - K.smooth((p - 0.3) / 0.25)); ctx.drawImage(layers[2].c, 0, 0);
          ctx.globalAlpha = dim * (1 - K.smooth((p - 0.62) / 0.25)); ctx.drawImage(layers[3].c, 0, 0);
          // a car passes, low and dim, once every 50 s or so
          var cp = (t + 20 * (s.seed % 3)) % 53 / 14;
          if (cp < 1) {
            var dir = Math.floor((t + 20) / 53) % 2 ? 1 : -1;
            var cx = W * (dir > 0 ? -0.1 + 1.2 * cp : 1.1 - 1.2 * cp);
            ctx.globalAlpha = 0.32 * Math.sin(Math.PI * cp);
            var img = dir > 0 ? tailImg : carImg;
            ctx.drawImage(img, cx - img.width / 2, H * 0.8 - img.height / 2);
          }
          // the rain beyond the glass, falling
          ctx.globalAlpha = 0.36 * ease;
          var rh = H, ry = (t * 46) % rh;
          ctx.drawImage(rain, 0, ry - rh, W, rh); ctx.drawImage(rain, 0, ry, W, rh);
          ctx.globalCompositeOperation = 'source-over';
          // mist on the glass, thicker low down where it is coolest
          ctx.globalAlpha = 1;
          ctx.fillStyle = K.linear(ctx, 0, 0, 0, sill, [[0, 'rgba(120, 120, 150, 0.04)'], [0.7, 'rgba(130, 120, 150, 0.07)'],
            [1, 'rgba(150, 130, 150, ' + (0.16 + 0.06 * p).toFixed(3) + ')']]);
          ctx.fillRect(0, 0, W, sill + 1);
          ctx.fillStyle = '#0b080e'; ctx.fillRect(0, sill, W, H - sill);

          // A few drops run at a time - fewer as the rain eases - stopping, sliding on,
          // swallowing the beads in their way and leaving a clear wet path.
          var want = Math.round(1 + 3 * ease);
          for (var i = 0; i < drops.length; i++) {
            var q = drops[i];
            if (!q.live) { if (i < want && dr() < dt * 0.25) launch(q, t); else { q.spr.set(-60, -60, 0, 0); continue; } }
            if (t > q.go) {
              q.v = Math.min(q.speed, q.v + q.speed * 2 * dt);
              if (dr() < dt * 0.35) { q.v = 0; q.go = t + 0.6 + dr() * 3; }
            } else q.v *= 0.7;
            var ny = q.y + q.v * dt;
            if (q.v > 0.5) {
              var nx = laneX(q.lane, ny) + q.off + (dr() - 0.5) * 0.5;
              gx.save(); gx.globalCompositeOperation = 'destination-out'; gx.fillStyle = '#000';
              gx.beginPath(); gx.ellipse(nx, (q.y + ny) / 2 + q.r * 0.4, q.r * 1.15, (ny - q.y) / 2 + q.r * 1.1, 0, 0, Math.PI * 2); gx.fill();
              gx.restore();
              q.trail += ny - q.y;
              if (q.trail > 22) { q.trail = 0; bead(gx, nx + (dr() - 0.5) * 2, q.y - q.r * 2, 1.2 + dr() * 1.3, 0.9); }
              q.x = nx;
            }
            q.y = ny;
            q.spr.set(q.x - q.w / 2, q.y - q.h * 0.62, 0, 1);
            if (q.y > sillY - 4) q.live = false;
          }
          // new beads settle while it rains
          if (t > nextBead) {
            var nb = nearLane(dr, 1.3);
            bead(gx, nb[0], nb[1], 1.6 + 6 * Math.pow(dr(), 2.5));
            nextBead = t + 0.9 / Math.max(0.15, ease); // fewer as it eases: the glass must not fill up
          }

          // steam: wisps rising and curling, thinning as the tea cools
          if (stx) {
            stx.clearRect(0, 0, stW, stH);
            stx.globalCompositeOperation = 'lighter';
            var warm = 1 - 0.65 * p;
            for (var w = 0; w < 7; w++) {
              var life = (t * 0.16 + w / 7) % 1;
              var sx = stW / 2 + K.noise1(t * 0.35 + w * 3.1, 4) * stW * 0.12 * (0.3 + life * 1.5);
              var sy = stH - 10 - life * stH * 0.8;
              stx.globalAlpha = 0.5 * warm * Math.sin(Math.PI * life);
              var sz = (0.6 + life * 1.4) * puff.width;
              stx.drawImage(puff, sx - sz / 2, sy - sz / 2, sz, sz);
            }
            stx.globalAlpha = 1; stx.globalCompositeOperation = 'source-over';
          }
        },
      };
    },

    lofi: {
      key: 'Eb', mode: 'major', bpm: 72, swing: 0.58,
      progs: ['Imaj9 vi9 IVmaj9 V13sus', 'ii9 V13 Imaj9 vi9', 'IVmaj9 iii7 vi9 ii9,V7b9'],
      keys: { inst: 'piano', style: 'comp', range: [50, 72], size: 3, ep: true, level: 1 },
      lead: { inst: 'kalimba', range: [62, 83], level: 0.62, motif: '2.2.5 6.2.5? 10.2.6 14.2.5? | 2.2.3 6.6.2' },
      reply: { inst: 'piano', shift: -12, level: 0.76 },
      bass: { style: 'lofi', walk: true, level: 0.98 },
      drums: { style: 'boom', snare: 'rim', hat: 'hat', level: 0.98 },
      fx: { tone: 4500, crackle: 0.3, hiss: 0.4, wow: 0.9, room: 0.35, verb: 1.0, echo: 0.5, duck: 0.12 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // Rain: a soft wash plus drops tapping the glass.
      var rainG = K.gain(ac, 0.1, out);
      var rhp = K.filter(ac, 'highpass', 350, 0.5); var rlp = K.filter(ac, 'lowpass', 4200, 0.4, rainG); rhp.connect(rlp);
      K.loop(ac, K.noise(ac, 'pink', 7), rhp, t0);
      K.lfo(ac, 0.05, 0.022, rainG.gain, 'sine', t0);
      var hum = K.gain(ac, 0.05, out);
      K.loop(ac, K.noise(ac, 'brown', 6), K.filter(ac, 'lowpass', 140, 0.5, hum), t0);
      var tapBus = K.filter(ac, 'bandpass', 2600, 1.4, K.gain(ac, 0.55, out));
      var tapBuf = K.noise(ac, 'white', 1);
      var nextTap = t0 + 0.2;

      return function schedule(until) {
        while (nextTap < until) {
          var src = ac.createBufferSource(); src.buffer = tapBuf;
          var g = ac.createGain();
          var lv = 0.02 + Math.random() * 0.05;
          g.gain.setValueAtTime(0.0001, nextTap);
          g.gain.linearRampToValueAtTime(lv, nextTap + 0.002);
          g.gain.exponentialRampToValueAtTime(0.0001, nextTap + 0.03 + Math.random() * 0.03);
          src.connect(g); g.connect(K.panner(ac, Math.random() * 1.6 - 0.8, tapBus));
          src.start(nextTap, Math.random() * 0.9); src.stop(nextTap + 0.08);
          nextTap += 0.04 + Math.random() * 0.22;
        }
      };
    },
  });
})();

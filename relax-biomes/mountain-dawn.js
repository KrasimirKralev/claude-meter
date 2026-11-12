// Mountain lake at dawn - ridge after ridge fading into blue, banks of mist
// drifting between them, the sky warming behind the peaks as the break goes
// on, all of it mirrored in a still lake; a wooden dock and a canoe in front.
// Music: lo-fi in F (64 bpm): a soft upright piano whose theme returns an octave
// higher, cello, upright bass, brushes; lapping water, a loon.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A spruce for the near bank: tiers of drooping boughs, a little ragged.
  function pine(cx, r, x, base, h) {
    var tiers = 13;
    cx.beginPath();
    cx.moveTo(x, base - h);
    for (var i = 1; i <= tiers; i++) {
      var k = i / tiers, y = base - h + h * 0.92 * k, w = h * (0.03 + 0.2 * Math.pow(k, 0.9)) * (0.8 + 0.4 * r());
      cx.lineTo(x + w, y + h * 0.02); cx.lineTo(x + w * 0.35, y - h * 0.006);
    }
    cx.lineTo(x + h * 0.015, base); cx.lineTo(x - h * 0.015, base);
    for (var j = tiers; j >= 1; j--) {
      var kk = j / tiers, yy = base - h + h * 0.92 * kk, ww = h * (0.03 + 0.2 * Math.pow(kk, 0.9)) * (0.8 + 0.4 * r());
      cx.lineTo(x - ww * 0.35, yy - h * 0.006); cx.lineTo(x - ww, yy + h * 0.02);
    }
    cx.closePath(); cx.fill();
  }

  RelaxBiomes.register({
    id: 'mountain-dawn',
    name: 'Mountain lake at dawn',
    about: 'Alpine ridges fading into blue, mist in the valleys, dawn warming until the sun clears the peak, a still lake mirroring it, a dock and a canoe. Lo-fi in F: soft upright piano with a theme that returns an octave higher, cello, upright bass, brushes, lapping water, a loon.',
    ink: '250, 246, 255',
    shade: '28, 34, 58',
    vignette: 0.26,
    legible: 0.6,
    scale: 3,
    grade: { shadow: '20, 26, 52', light: '255, 246, 238' },
    level: 0.950, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.356,

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var horizon = Math.round(H * 0.6), outer = -inner;
      // Dawn comes up behind the big peak on the main screen, on the side towards the
      // other screen; the side screen continues the range in the cool half of the sky.
      var sunU = main ? 0.5 + 0.24 * inner : (inner < 0 ? -0.2 : 1.2);
      var sunX = W * sunU;

      function sky(top, mid, low, glowA) {
        var c = s.layer(W, horizon + 2), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, [[0, top], [0.55, mid], [1, low]]);
        x.fillRect(0, 0, W, horizon + 2);
        // the warmth stays local, around where the sun will come up
        x.save(); x.translate(sunX, horizon - H * 0.12); x.scale(1.7, 1);
        x.fillStyle = K.radial(x, 0, 0, H * 0.55, [[0, 'rgba(241, 197, 168, ' + glowA + ')'],
          [0.4, 'rgba(241, 197, 168, ' + (glowA * 0.4).toFixed(3) + ')'], [1, 'rgba(241, 197, 168, 0)']]);
        x.fillRect(-H * 0.55, -H * 0.55, H * 1.1, H * 0.55 + H * 0.14);
        x.restore();
        return c;
      }
      var skyEarly = sky('#6c7c9c', '#8f96b6', '#b7aec4', 0.55);
      var skyLate = sky('#7b8daa', '#a3a8c4', '#d3bfc4', 0.75);

      // Four distances of mountains, each paler, bluer, softer-edged than the one in front.
      var HAZE = '#c6c3d8';
      var bands = [
        { amp: 0.17, freq: 4.6, seed: 3, col: '#7f88ae', depth: 0.72, blur: 1.1 },
        // a rear ridge, partly hidden behind the main peak's shoulders
        { amp: main ? 0.24 : 0.15, freq: 3.3, seed: 41, col: '#66709c', depth: 0.6, blur: 0.8 },
        { amp: main ? 0.3 : 0.2, freq: 2.4, seed: main ? 7 : 27, col: '#4f5a86', depth: 0.42, blur: 0.5, facets: true, peak: main },
        { amp: 0.09, freq: 5.5, seed: 11, col: '#3f4b72', depth: 0.35, blur: 0.25, trees: true },
        { amp: 0.035, freq: 9, seed: 17, col: '#2a3354', depth: 0.15, blur: 0, trees: true },
      ];
      var peakU = main ? sunU - 0.06 * inner : 0.5;
      bands.forEach(function (B, bi) {
        function f(x) {
          var u = x / W;
          var r1 = 1 - Math.abs(K.noise1(u * B.freq, B.seed)), r2 = 1 - Math.abs(K.noise1(u * B.freq * 2.3 + 3, B.seed + 1));
          var h = Math.pow(r1, 2.4) * 0.7 + Math.pow(r2, 3) * 0.22 + 0.05 * K.noise1(u * B.freq * 9, B.seed + 2);
          if (B.peak) h = h * 0.55 + 0.75 * Math.exp(-Math.pow((u - peakU) / 0.13, 2)) * (0.925 + 0.075 * Math.tanh((peakU - u) * inner / 0.03));
          return horizon - H * B.amp * Math.max(0.04, h);
        }
        B.f = f;
        var c = s.layer(W, horizon + 2), x = c.getContext('2d'), path = K.ridge(-2, W + 2, 1, f, horizon + 1);
        var top = H; for (var px = 0; px < W; px += 2) top = Math.min(top, f(px));
        x.fillStyle = K.linear(x, 0, top, 0, horizon, [[0, K.aerial(B.col, HAZE, B.depth)], [1, K.aerial(B.col, HAZE, Math.min(1, B.depth + 0.15))]]);
        x.fill(path);
        if (B.facets) {
          // Ridge-following planes, low in contrast: every point of a face takes its light from
          // the ridge point it falls from (down a slanting, wandering fall line), so the shading
          // runs down from the ridges as spurs and gullies instead of a few big triangles.
          var lean = -inner * 0.35, sdir = sunX > W / 2 ? 1 : -1, sw = Math.ceil(W / 2), shh = Math.ceil((horizon + 2) / 2);
          var shade = K.field(sw, shh, function (u, v, out) {
            var px = u * W, py = v * (horizon + 2), ry = f(px);
            if (py < ry - 1) return null;
            var d = Math.max(0, py - ry);
            var sx = px + d * lean + K.fbm2(px * 0.02, py * 0.03, 3, B.seed + 70) * (10 + d * 0.5);
            var lit = Math.tanh((f(sx + 5) - f(sx - 5)) / 10 * sdir * 1.6);
            var a = lit * Math.exp(-d / (H * 0.13)) * 0.15 + K.fbm2(sx * 0.05, 0.5, 2, B.seed + 90) * 0.025;
            if (a > 0) { out[0] = 240; out[1] = 206; out[2] = 198; out[3] = a; } else { out[0] = 38; out[1] = 44; out[2] = 78; out[3] = -a * 0.8; }
            return out;
          });
          x.save(); x.globalCompositeOperation = 'source-atop'; x.drawImage(shade, 0, 0, W, horizon + 2); x.restore();
          B.lit = K.rimLayer(c, sdir, -0.35, 1.4, '255, 214, 190', 0.45, 0.6);
        }
        if (B.trees) {
          x.fillStyle = K.aerial(B.col, HAZE, B.depth);
          var tr = K.seeded(B.seed + 9);
          for (var tx = 0; tx < W; tx += 0.8 + tr() * 1.6) {
            var th = H * (0.006 + 0.012 * tr()) * (bi === 3 ? 1.6 : 1), ty = f(tx) + 0.8;
            x.beginPath(); x.moveTo(tx, ty - th); x.lineTo(tx + th * 0.28, ty); x.lineTo(tx - th * 0.28, ty); x.fill();
          }
        }
        B.c = B.blur ? K.blurred(c, B.blur) : c;
      });

      // Mist between the distances and a thin bank lying on the far water.
      var mists = [0, 1, 2].map(function (i) {
        return { img: K.wisps({ w: Math.round(W * 1.3), h: Math.round(H * (0.05 + 0.02 * i)), rgb: '238, 234, 246', alpha: 0.42,
          cover: 0.6, seed: 5 + i * 11 + (main ? 0 : 50), stretch: 9 }), band: i, v: (0.25 + 0.15 * i) / s.scale * (i % 2 ? -1 : 1) };
      });
      var lakeMist = K.wisps({ w: Math.round(W * 1.3), h: Math.round(H * 0.035), rgb: '244, 236, 240', alpha: 0.5, cover: 0.7,
        seed: main ? 61 : 71, stretch: 14 });

      // The mirror picture: sky and mountains, upside down, drawn in sway bands.
      var above = s.layer(W, horizon + 2), ax = above.getContext('2d');
      ax.drawImage(skyEarly, 0, 0);
      bands.forEach(function (B) { ax.drawImage(B.c, 0, 0); });
      var mirror = K.mirror(above, horizon);
      var lake = s.layer(), lx = lake.getContext('2d');
      lx.fillStyle = K.linear(lx, 0, horizon, 0, H, [[0, 'rgba(60, 76, 116, 0.1)'], [0.45, 'rgba(40, 52, 92, 0.34)'], [1, 'rgba(22, 30, 60, 0.7)']]);
      lx.fillRect(0, horizon, W, H - horizon);
      var ripples = K.field(Math.ceil(W / 2), H - horizon, function (u, v, out) {
        var n = K.noise2(u * 8, v * 64, 13);
        var a = K.clamp((n - 0.4) * 1.6, 0, 1) * 0.12 * Math.min(1, v * 4 + 0.1);
        if (a <= 0.003) return null;
        out[0] = 255; out[1] = 238; out[2] = 228; out[3] = a; return out;
      });
      var sunBloom = K.bloom('255, 226, 190', 2.2), sunCore = K.bloom('255, 226, 191', 0.7);
      var rays = main ? K.rays(W, H, { x: sunX, y: horizon - H * 0.3, angle: -inner * 0.45, spread: 0.7, count: 6,
        length: W * 0.8, width: W * 0.05, rgb: '255, 226, 196', alpha: 0.2, seed: 9, patchy: 0.75 }) : null;

      // The canoe floats on a sprite of its own, so it can bob a pixel or two.
      var canoe = null, cW = Math.round(SW * 0.2), cH = Math.round(SH * 0.07), cX = X(0.66) - cW / 2, cY = SH * 0.86;
      function X(u) { return outer < 0 ? u * SW : SW - u * SW; }
      if (main) {
        canoe = s.sprite(cW, cH, function (fx, w, h) {
          var cx = w / 2, cy = h * 0.55, cl = w * 0.42;
          fx.fillStyle = 'rgba(30, 30, 46, 0.3)';
          fx.beginPath(); fx.moveTo(cx - cl, cy + h * 0.08); fx.quadraticCurveTo(cx, cy + h * 0.6, cx + cl, cy + h * 0.08); fx.closePath(); fx.fill();
          var hull = K.canvas(w, h), hx = hull.getContext('2d');
          hx.fillStyle = '#3e2a30';
          hx.beginPath(); hx.moveTo(cx - cl, cy - h * 0.3);
          hx.quadraticCurveTo(cx - cl * 0.7, cy + h * 0.17, cx, cy + h * 0.2);
          hx.quadraticCurveTo(cx + cl * 0.7, cy + h * 0.17, cx + cl, cy - h * 0.32);
          hx.quadraticCurveTo(cx, cy - h * 0.06, cx - cl, cy - h * 0.3); hx.fill();
          hx.strokeStyle = '#24181c'; hx.lineWidth = 2;
          hx.beginPath(); hx.moveTo(cx - cl * 0.35, cy - h * 0.42); hx.lineTo(cx + cl * 0.3, cy - h * 0.03); hx.stroke();
          K.rim(hull, -outer, -1, 1.6, '255, 206, 176', 0.75, 0.5);
          fx.drawImage(hull, 0, 0);
        }, cW / 2, cH / 2);
      }

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          var dawn = K.smooth(p);
          ctx.drawImage(skyEarly, 0, 0);
          ctx.globalAlpha = dawn; ctx.drawImage(skyLate, 0, 0); ctx.globalAlpha = 1;
          // The sun clears the big peak in the last third of the break.
          var sunY = horizon - H * (0.16 + 0.2 * K.smooth((p - 0.25) / 0.75));
          K.light(ctx, sunBloom, sunX, sunY, H * 0.455, 0.14 + 0.2 * dawn);
          if (main) K.light(ctx, sunCore, sunX, sunY, H * 0.08, 0.35 + 0.45 * dawn);
          for (var i = 0; i < bands.length; i++) {
            var B = bands[i], pp = s.par(1 - B.depth);
            ctx.drawImage(B.c, pp.x, pp.y);
            if (B.lit) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.2 + 0.5 * dawn; ctx.drawImage(B.lit, pp.x, pp.y); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
            if (i < mists.length) {
              // the mist brightens as the light reaches it, and thins a little
              var m = mists[i], mw = m.img.width, mx = ((t * m.v) % (mw - W) + (mw - W)) % (mw - W);
              ctx.globalAlpha = 0.8 - 0.2 * dawn;
              ctx.drawImage(m.img, -mx, horizon - H * (0.05 + 0.03 * (2 - i)) - m.img.height / 2 + H * 0.03);
              ctx.globalAlpha = 1;
            }
          }
          if (rays) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.15 + 0.45 * K.smooth((p - 0.3) / 0.6);
            ctx.drawImage(rays, 0, 0);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          }

          // The lake: a clear mirror at the far shore, broken into drifting bands nearer us.
          ctx.fillStyle = '#4e5a82'; ctx.fillRect(0, horizon, W, H - horizon);
          K.reflect(ctx, mirror, horizon, H, W, t, { bands: 16, amp: 4.5, speed: 0.18, squash: 1.1, alpha: 0.9 });
          ctx.globalAlpha = dawn * 0.35;
          ctx.fillStyle = 'rgba(241, 197, 168, 0.5)';
          ctx.fillRect(0, horizon, W, H - horizon);
          ctx.globalAlpha = 1;
          ctx.drawImage(lake, 0, 0);
          K.light(ctx, sunBloom, sunX, horizon + (horizon - sunY) * 0.6, H * 0.3, 0.08 + 0.12 * dawn, H * 0.5);
          ctx.globalCompositeOperation = 'lighter';
          var rw = ripples.width * 2, rh = H - horizon, r1 = (t * 0.5 / s.scale) % rw;
          ctx.globalAlpha = 0.5 + 0.4 * dawn;
          ctx.drawImage(ripples, r1, horizon, rw, rh); ctx.drawImage(ripples, r1 - rw, horizon, rw, rh);
          ctx.globalCompositeOperation = 'source-over';
          var lw = lakeMist.width, lmx = ((t * 0.2 / s.scale) % (lw - W));
          ctx.globalAlpha = 0.55 + 0.35 * dawn;
          ctx.drawImage(lakeMist, -lmx, horizon - lakeMist.height * 0.6);
          ctx.globalAlpha = 1;
          if (canoe) canoe.set(cX, cY + 1.2 * K.noise1(t / 12, 4), 0.25 * K.noise1(t / 15, 8), 1);
        },

        // The near bank with its spruces on the outer side, and (on the main screen) the dock.
        front: function (fx) {
          var bank = K.canvas(SW, SH), bx = bank.getContext('2d'), r = K.seeded(main ? 95 : 97);
          bx.fillStyle = '#1b2233';
          bx.beginPath(); bx.moveTo(X(0), SH * 0.655);
          var reach = main ? 0.15 : 0.11;
          // the shoreline widens towards us, unevenly
          for (var u = 0; u <= 1.0001; u += 0.02) {
            var v = 0.655 + 0.345 * u;
            bx.lineTo(X(reach * (0.3 + 0.9 * u) + 0.01 * K.noise1(u * 9, 3) * u), SH * v);
          }
          bx.lineTo(X(0), SH); bx.closePath(); bx.fill();
          for (var g = 0; g < 50; g++) {
            var gu = r() * reach * 0.95, gy = SH * (0.655 + 0.08 * r());
            bx.fillRect(X(gu), gy - SH * 0.02 * r(), 1.5, SH * 0.028);
          }
          var trees = main ? [[0.02, 0.66, 0.4], [0.065, 0.672, 0.27], [0.105, 0.69, 0.19], [0.04, 0.69, 0.31]]
            : [[0.03, 0.66, 0.3], [0.07, 0.675, 0.2]];
          trees.forEach(function (tq) { pine(bx, r, X(tq[0]), SH * tq[1], SH * tq[2]); });
          K.rim(bank, inner, -0.6, 2, '255, 212, 188', 0.55, 0.8);
          fx.drawImage(main ? K.blurred(bank, 0.6) : bank, 0, 0);
          if (!main) return;
          // the dock, in perspective, its far edge warmed by the dawn
          var y0 = SH * 0.82, y1 = SH * 1.02, xL0 = X(0.22), xR0 = X(0.34), xL1 = X(0.12), xR1 = X(0.4);
          var dock = K.canvas(SW, SH), dx = dock.getContext('2d');
          dx.fillStyle = '#2a2a38';
          dx.beginPath(); dx.moveTo(xL0, y0); dx.lineTo(xR0, y0); dx.lineTo(xR1, y1); dx.lineTo(xL1, y1); dx.closePath(); dx.fill();
          dx.strokeStyle = 'rgba(20, 20, 30, 0.6)'; dx.lineWidth = 1.2;
          for (var pl = 0; pl < 14; pl++) {
            var q = Math.pow(pl / 14, 1.2), py = y0 + (y1 - y0) * q;
            dx.beginPath(); dx.moveTo(xL0 + (xL1 - xL0) * q, py); dx.lineTo(xR0 + (xR1 - xR0) * q, py); dx.stroke();
          }
          dx.fillStyle = '#1e1f2b';
          [xL0, xR0].forEach(function (px) { dx.fillRect(px - 3, y0 - SH * 0.02, 6, SH * 0.06); });
          K.rim(dock, inner, -1, 1.6, '255, 214, 190', 0.6, 0.5);
          fx.drawImage(dock, 0, 0);
          fx.fillStyle = 'rgba(30, 34, 50, 0.4)';
          [xL0, xR0].forEach(function (px) { fx.fillRect(px - 3, y0 + SH * 0.04, 6, SH * 0.045); });
        },
      };
    },

    lofi: {
      key: 'F', mode: 'major', bpm: 64, swing: 0.58, swing8: true,
      progs: ['Imaj9 vi9 IVmaj9 V9sus', 'Imaj9 iii7 IVmaj9 IVmaj9,V9sus', 'ii9 V13sus Imaj9 IVmaj9'],
      keys: { inst: 'piano', style: 'hold', range: [48, 72], level: 0.95 },
      lead: { inst: 'piano', range: [64, 88], level: 0.52, vary: 'octave', motif: '0.6.3 6.2.2 8.8.5 | 4.12.6' },
      reply: { inst: 'piano', shift: -12, level: 0.48 },
      pad: { inst: 'cello', range: [41, 55], fifth: true, level: 1, in: ['release', 'outro'] },
      bass: { style: 'lofi', level: 0.54 },
      drums: { style: 'brush', kit: 'brushes', level: 0.77 },
      fx: { tone: 5200, crackle: 0.25, hiss: 0.3, wow: 0.8, room: 0.45, verb: 1.2, echo: 0.75, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 3.6, 2.6, out, 0.26);
      // lapping water and a loon
      var lap = K.gain(ac, 0.055, out);
      K.loop(ac, K.noise(ac, 'brown', 7), K.filter(ac, 'lowpass', 700, 0.5, lap), t0);
      K.lfo(ac, 0.28, 0.028, lap.gain, 'sine', t0);
      var nextLoon = t0 + 18;

      return function schedule(until) {
        while (nextLoon < until) {
          var o = ac.createOscillator(); var g = ac.createGain(); var lt = nextLoon;
          var f0 = 640 + Math.random() * 60;
          o.frequency.setValueAtTime(f0, lt); o.frequency.linearRampToValueAtTime(f0 * 1.5, lt + 0.9);
          o.frequency.setValueAtTime(f0 * 1.5, lt + 1.8); o.frequency.linearRampToValueAtTime(f0 * 1.33, lt + 2.4);
          g.gain.setValueAtTime(0.0001, lt); g.gain.linearRampToValueAtTime(0.012, lt + 0.4);
          g.gain.setValueAtTime(0.012, lt + 2.0); g.gain.linearRampToValueAtTime(0.0001, lt + 2.8);
          K.lfo(ac, 6, 10, o.detune, 'sine', lt + 0.8).stop(lt + 3);
          var lp = K.filter(ac, 'lowpass', 1800, 0.5);
          o.connect(lp); lp.connect(g); g.connect(K.panner(ac, -0.5, rv)); g.connect(K.gain(ac, 0.4, out));
          o.start(lt); o.stop(lt + 3);
          nextLoon = lt + 35 + Math.random() * 25;
        }
      };
    },
  });
})();

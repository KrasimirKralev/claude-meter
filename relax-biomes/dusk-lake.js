// Dusk lake - the first Relax scene: a low sun sinking behind hills over still
// water, a shimmering sun path, mist on the waterline, stars coming out, reeds.
// Music: lo-fi in D (70 bpm): Rhodes-like keys in maj9 / min9 chords, a falling vibraphone
// theme answered an octave lower, upright bass, a lazy swung kit; water hush.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A clump of reeds and blades standing on the bottom edge of a w x h box.
  function reeds(cx, w, h, rnd, n, col) {
    cx.fillStyle = col; cx.strokeStyle = col; cx.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x0 = w * (0.08 + 0.84 * rnd()), tall = h * (0.4 + 0.6 * Math.pow(rnd(), 0.7));
      var lean = (rnd() - 0.45) * w * 0.14, x1 = x0 + lean, y1 = h - tall;
      cx.lineWidth = 1.4 + rnd() * 2.4;
      cx.beginPath(); cx.moveTo(x0, h + 2); cx.quadraticCurveTo(x0 + lean * 0.15, h - tall * 0.55, x1, y1); cx.stroke();
      if (rnd() < 0.3) {
        cx.save(); cx.translate(x1 - lean * 0.06, y1 + tall * 0.13); cx.rotate(Math.atan2(lean, tall) * 0.8);
        cx.beginPath(); cx.ellipse(0, 0, 2.6 + rnd() * 2, tall * 0.075, 0, 0, Math.PI * 2); cx.fill();
        cx.restore();
      }
    }
    for (var j = 0; j < n; j++) {
      var bx = w * (0.06 + 0.88 * rnd()), bl = h * (0.22 + 0.5 * rnd()), bend = (rnd() - 0.5) * 2.2;
      var tx = bx + bend * bl * 0.55, ty = h - bl * (0.75 + 0.25 * rnd()), bw = 2 + rnd() * 3;
      cx.beginPath(); cx.moveTo(bx - bw, h + 2);
      cx.quadraticCurveTo(bx + bend * bl * 0.08, h - bl * 0.62, tx, ty);
      cx.quadraticCurveTo(bx + bend * bl * 0.14 + bw * 0.4, h - bl * 0.55, bx + bw, h + 2);
      cx.fill();
    }
  }

  RelaxBiomes.register({
    id: 'dusk-lake',
    name: 'Dusk lake',
    about: 'A low sun sinking behind hills over still water, mist on the waterline, stars coming out. Lo-fi in D: Rhodes-like keys, a falling vibraphone theme answered an octave lower, upright bass, a lazy swung kit, water hush.',
    ink: '255, 238, 230',
    shade: '10, 8, 26',
    vignette: 0.3,
    grade: { shadow: '16, 12, 38', light: '255, 241, 228' },
    level: 0.714, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.079,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main';
      var horizon = Math.round(H * 0.6);
      var inner = s.inner;
      // The sun sits on the main screen, a little towards the other one; the side
      // screen only gets its afterglow on the edge that faces it.
      var sunU = main ? 0.5 + 0.13 * inner : (inner > 0 ? 1.18 : -0.18);
      var sunX = W * sunU;
      var haze = '#c39aa8';

      function hill(u, seed, amp, base) {
        return H * (base + amp * (0.55 * K.noise1(u * 3.1 + seed, seed) + 0.3 * K.noise1(u * 7.3 + seed, seed + 1) +
          0.15 * K.noise1(u * 17 + seed, seed + 2)));
      }
      function sky(stops, glowA, glowRgb) {
        var c = s.layer(W, horizon + 2), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, stops);
        x.fillRect(0, 0, W, horizon + 2);
        // The glow over the sunset point, wide and low, warmer near the horizon.
        x.save(); x.translate(sunX, horizon); x.scale(1.9, 1);
        x.fillStyle = K.radial(x, 0, 0, H * 0.5, [[0, 'rgba(' + glowRgb + ',' + glowA + ')'],
          [0.35, 'rgba(' + glowRgb + ',' + (glowA * 0.35).toFixed(3) + ')'], [1, 'rgba(' + glowRgb + ',0)']]);
        x.fillRect(-H * 0.5, -H * 0.5, H, H * 0.5 + 2);
        x.restore();
        return c;
      }
      var skyEarly = sky([[0, '#131739'], [0.3, '#26295b'], [0.55, '#4b3b70'], [0.78, '#99607f'], [0.92, '#d89283'],
        [1, '#f0bc93']], 0.5, '255, 205, 160');
      var skyLate = sky([[0, '#090c24'], [0.35, '#171b43'], [0.62, '#2d2956'], [0.82, '#563c69'], [0.94, '#94586c'],
        [1, '#b8706c']], 0.32, '235, 140, 120');

      var stars = K.stars(W, horizon, rnd, { faint: 260, mid: 24, bright: main ? 3 : 2, halo: 0.5,
        density: function (v) { return v < 0.62 ? 1 - v : 0; } });

      // Three distances of land, each lighter and closer to the haze than the one in front.
      var farSeed = main ? 3 : 11;
      var farHills = K.ridge(-4, W + 4, 2, function (x) { return horizon - hill(x / W, farSeed, 0.035, 0.05); }, horizon + 1);
      var midHills = K.ridge(-4, W + 4, 2, function (x) {
        var u = x / W;
        // a long low shore on the side away from the sun, open water under it
        var shore = main ? K.smooth((sunU - 0.12 - u) / 0.25) : K.smooth(((inner < 0 ? u : 1 - u) - 0.45) / 0.3);
        return horizon - hill(u, farSeed + 5, 0.014, 0.022) * shore;
      }, horizon + 1);
      var land = s.layer(W, horizon + 2), lx = land.getContext('2d');
      lx.fillStyle = K.aerial('#3e2c55', haze, 0.4); lx.fill(farHills);
      lx.fillStyle = K.linear(lx, 0, horizon - H * 0.09, 0, horizon, [[0, 'rgba(195,154,168,0)'], [1, 'rgba(195,154,168,0.28)']]);
      lx.fill(farHills);
      // after sunset the hills lose their light and stand dark against the afterglow
      var landDusk = s.layer(W, horizon + 2), ldx = landDusk.getContext('2d');
      ldx.fillStyle = '#251c3c'; ldx.fill(farHills);
      var mid = s.layer(W, horizon + 2), mx = mid.getContext('2d');
      mx.fillStyle = K.aerial('#2f2449', haze, 0.3); mx.fill(midHills);

      // Water: the sky and the land mirrored, broken up by ripples towards the viewer.
      var above = s.layer(W, horizon + 2), ax = above.getContext('2d');
      ax.drawImage(skyEarly, 0, 0); ax.drawImage(land, 0, 0); ax.drawImage(mid, 0, 0);
      var water = s.layer(), wx = water.getContext('2d');
      wx.fillStyle = K.linear(wx, 0, horizon, 0, H, [[0, 'rgba(60, 44, 86, 0.25)'], [0.35, 'rgba(36, 28, 64, 0.55)'],
        [1, 'rgba(14, 14, 36, 0.86)']]);
      wx.fillRect(0, horizon, W, H - horizon);
      // The haze sitting on the far shore, 50-90 px tall on screen, thicker in places.
      var hazeBand = K.field(Math.ceil(W / 2), Math.round(H * 0.075), function (u, v, out) {
        var a = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), 1.4) * (0.6 + 0.4 * K.noise1(u * 5, farSeed));
        out[0] = 195; out[1] = 154; out[2] = 168; out[3] = a * 0.42; return out;
      });

      // The sun's path: broken horizontal marks, narrow at the horizon and wider towards
      // the viewer, gold near the sun fading to mauve. Two sets, crossfaded, so it shimmers.
      function path(seed) {
        var c = s.layer(), x = c.getContext('2d'), r = K.seeded(seed);
        var rows = 46;
        for (var i = 0; i < rows; i++) {
          var d = Math.pow((i + r()) / rows, 1.45);
          var y = horizon + 1 + (H - horizon) * 0.92 * d;
          var spread = W * (0.012 + 0.11 * d);
          var marks = 1 + Math.floor(r() * (1 + d * 3));
          for (var m = 0; m < marks; m++) {
            var off = (r() + r() - 1) * spread;
            var len = W * (0.004 + 0.028 * d) * (0.4 + r());
            var a = 0.7 * Math.pow(1 - d, 1.1) * (1 - Math.abs(off) / (spread * 1.05)) * (0.5 + 0.5 * r());
            if (a <= 0.02) continue;
            x.fillStyle = K.mix('#ffd7a3', '#96758f', Math.min(1, d * 1.3), a.toFixed(3));
            x.fillRect(sunX + off - len / 2, y, len, 0.5 + d * 1.1);
          }
        }
        return c;
      }
      var paths = main ? [path(41), path(77)] : null;
      // Faint ripple lines over the whole lake: long thin streaks, drifting at their own speeds.
      var ripples = K.field(Math.ceil(W / 2), Math.ceil((H - horizon) / 1), function (u, v, out) {
        // far off: short thin marks; close by: broader, irregular patches
        var fx = 22 - 16 * v, depth = Math.pow(v, 0.6) * 46;
        var n = K.noise2(u * fx + K.noise1(v * 9, 4) * 2, depth, 21) * (0.75 + 0.25 * K.noise2(u * 3, v * 5, 23));
        var a = K.clamp((n - 0.35) * 1.6, 0, 1) * 0.096 * Math.min(1, v * 3 + 0.2);
        if (a <= 0.003) return null;
        out[0] = 236; out[1] = 200; out[2] = 214; out[3] = a; return out;
      });
      var mists = [0, 1].map(function (i) {
        return { img: K.wisps({ w: Math.round(W * 0.9), h: Math.round(H * 0.05), rgb: '232, 212, 228', alpha: 0.26,
          cover: 0.5, seed: 31 + i * 7 + farSeed, stretch: 9 }),
          y: horizon - H * (0.035 - i * 0.025), speed: (0.35 + i * 0.25) * (i ? -1 : 1), x0: rnd() * W };
      });
      // The headland (crisp, on the front layer) on the outer side of each screen, the
      // edge that faces the sun lit while it is up; reed clumps sway in front of it.
      var SW = s.SW, SH = s.SH, hz = SH * 0.6, outer = -inner;
      var reach = main ? 0.36 : 0.2, hx0 = outer < 0 ? 0 : SW, hdir = outer < 0 ? 1 : -1;
      // Its skyline is a row of tree crowns of uneven size, not a regular saw.
      function drawHeadland(x, k) {
        var r = K.seeded(main ? 61 : 67);
        x.beginPath();
        x.moveTo(hx0 * k, (hz + 1) * k);
        var ridge = [];
        for (var hu = 0; hu <= reach + 0.0005; hu += 0.002) {
          var hk = K.smooth((reach - hu) / (reach * 0.85));
          var hh = SH * (0.004 + (main ? 0.05 : 0.032) * hk + 0.008 * K.noise1(hu * 24, 5) * hk);
          ridge.push([hx0 + hdir * hu * SW, hz - hh, hk]);
          x.lineTo((hx0 + hdir * hu * SW) * k, (hz - hh) * k);
        }
        x.lineTo((hx0 + hdir * reach * SW) * k, (hz + 1) * k); x.closePath(); x.fill();
        for (var i = 0; i < ridge.length; i += 1 + Math.floor(r() * 3)) {
          var q = ridge[i];
          if (q[2] < 0.15 || r() < 0.2) continue;
          var tw = SH * (0.006 + 0.016 * r()) * (0.5 + 0.5 * q[2]), th = tw * (0.8 + r() * 0.9);
          x.beginPath();
          if (r() < 0.12) { // now and then a small conifer
            th *= 0.75;
            x.moveTo((q[0] - tw * 0.7) * k, (q[1] + 2) * k); x.lineTo(q[0] * k, (q[1] - th * 2.2) * k);
            x.lineTo((q[0] + tw * 0.7) * k, (q[1] + 2) * k);
          } else { // a broadleaf crown: a few overlapping lobes, never one ball
            for (var lb = 0; lb < 3; lb++) {
              var lx2 = q[0] + (r() - 0.5) * tw * 1.6, ly2 = q[1] - th * (0.25 + 0.3 * r()), lr = tw * (0.55 + 0.45 * r());
              x.moveTo((lx2 + lr) * k, ly2 * k);
              x.ellipse(lx2 * k, ly2 * k, lr * k, lr * (0.75 + 0.3 * r()) * k, r() * 0.6, 0, Math.PI * 2);
            }
          }
          x.fill();
        }
      }
      var rimTop = Math.floor(hz - SH * 0.11);
      var headRim = s.sprite(SW, Math.ceil(hz + 2 - rimTop), function (cx, w, h) {
        var c = K.canvas(w, h), x = c.getContext('2d');
        x.translate(0, -rimTop); x.fillStyle = '#000'; drawHeadland(x, 1);
        cx.drawImage(K.rimLayer(c, inner, -0.5, 2.2, '255, 178, 140', main ? 0.75 : 0.4, 0.9), 0, 0);
      });
      headRim.set(0, rimTop, 0, 1);
      var clumps = [];
      function clump(cxu, hFrac, wFrac, n, seed, blur, rimA) {
        var cw = Math.round(SW * wFrac), ch = Math.round(SH * hFrac), r = K.seeded(seed);
        var spr = s.sprite(cw, ch, function (cx, w, h) {
          var c = K.canvas(w, h);
          reeds(c.getContext('2d'), w, h, r, n, '#0c0a1c');
          K.rim(c, inner, -0.35, 1.6, '255, 184, 150', rimA, 0.7);
          if (blur) cx.filter = 'blur(' + blur + 'px)';
          cx.drawImage(c, 0, 0);
        }, cw / 2, ch);
        clumps.push({ spr: spr, x: SW * cxu - cw / 2, y: SH - ch + 6, per: 14 + 8 * r(), amp: (2 + 2 * r()) / ch * 57.3, seed: seed });
      }
      if (main) clump(outer < 0 ? 0.06 : 0.94, 0.4, 0.17, 22, 5, 1.3, 0.55);
      else clump(outer < 0 ? 0.62 : 0.38, 0.27, 0.12, 14, 9, 0.6, 0.3);

      ax.fillStyle = '#1b1530'; drawHeadland(ax, 1 / s.scale);
      var mirror = K.mirror(above, horizon);

      var sunCore = K.bloom('255, 236, 210', 1);
      var sunHalo = K.bloom('255, 186, 140', 2.2);

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          // Dusk deepens over the whole break: a second, darker sky fades in.
          ctx.drawImage(skyEarly, 0, 0);
          ctx.globalAlpha = K.smooth(p * 1.1); ctx.drawImage(skyLate, 0, 0);
          ctx.globalAlpha = 1;
          // The stars come out one tier after another: the brightest first.
          var tw = 0.85 + 0.15 * K.noise1(t * 0.21, 3);
          ctx.globalAlpha = K.smooth((p - 0.08) / 0.3) * tw; ctx.drawImage(stars.bright, 0, 0);
          ctx.globalAlpha = K.smooth((p - 0.25) / 0.35) * (0.8 + 0.2 * K.noise1(t * 0.17, 9)); ctx.drawImage(stars.mid, 0, 0);
          ctx.globalAlpha = K.smooth((p - 0.45) / 0.45); ctx.drawImage(stars.faint, 0, 0);
          ctx.globalAlpha = 1;

          // The sun sinks behind the far hills by about two thirds of the way through.
          var sunY = horizon - H * (0.105 - 0.17 * p);
          var vis = K.clamp((horizon - sunY + H * 0.01) / (H * 0.11), 0, 1);
          var glow = 0.25 + 0.75 * vis;
          K.light(ctx, sunHalo, sunX, Math.min(sunY, horizon - 2), H * 0.62, 0.38 * glow, H * 0.42);
          if (main && sunY < horizon + H * 0.04) {
            ctx.fillStyle = K.radial(ctx, sunX, sunY, H * 0.045, [[0, 'rgba(255, 246, 228, 1)'], [0.7, 'rgba(255, 228, 190, 0.96)'],
              [1, 'rgba(255, 205, 165, 0)']]);
            ctx.beginPath(); ctx.arc(sunX, sunY, H * 0.045, 0, Math.PI * 2); ctx.fill();
            K.light(ctx, sunCore, sunX, sunY, H * 0.16, 0.5 * vis);
          }

          var pf = s.par(0.15), pm = s.par(0.35);
          ctx.drawImage(land, pf.x, pf.y);
          ctx.globalAlpha = 0.75 * K.smooth((p - 0.3) / 0.6);
          ctx.drawImage(landDusk, pf.x, pf.y);
          ctx.globalAlpha = 0.9 - 0.6 * p;
          ctx.drawImage(hazeBand, -W * 0.02 + pf.x, horizon - H * 0.062, W * 1.04, H * 0.075);
          ctx.globalAlpha = 1;
          ctx.drawImage(mid, pm.x, pm.y);

          // Water: the mirrored sky and land, then the depth of the lake over it.
          ctx.fillStyle = '#1c1736'; ctx.fillRect(0, horizon, W, H - horizon);
          K.reflect(ctx, mirror, horizon, H, W, t, { bands: 24, amp: 2.4, speed: 0.22, squash: 1.2, alpha: 0.82 });
          ctx.drawImage(water, 0, 0);
          if (paths) {
            var sh = 0.5 + 0.5 * K.noise1(t * 0.35, 5);
            var pa = 0.95 * vis + 0.12;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = pa * sh; ctx.drawImage(paths[0], K.noise1(t * 0.12, 1) * 1.2, 0);
            ctx.globalAlpha = pa * (1 - sh); ctx.drawImage(paths[1], K.noise1(t * 0.1, 2) * 1.2, 0);
          }
          ctx.globalCompositeOperation = 'lighter';
          var rw = ripples.width * 2, rh = H - horizon;
          var r1 = (t * 0.45) % rw, r2 = (t * -0.3) % rw;
          ctx.globalAlpha = 0.55 * (1 - 0.5 * p);
          ctx.drawImage(ripples, r1, horizon, rw, rh); ctx.drawImage(ripples, r1 - rw, horizon, rw, rh);
          ctx.globalAlpha = 0.4 * (1 - 0.5 * p);
          ctx.drawImage(ripples, r2, horizon + 2, rw, rh); ctx.drawImage(ripples, r2 + rw, horizon + 2, rw, rh);
          ctx.globalCompositeOperation = 'source-over';

          // Mist on the waterline, a little thicker as the air cools.
          for (var i = 0; i < mists.length; i++) {
            var m = mists[i], mw = m.img.width, span = W + mw;
            var mxp = ((m.x0 + t * m.speed) % span + span) % span - mw;
            ctx.globalAlpha = 0.7 + 0.3 * p;
            ctx.drawImage(m.img, mxp, m.y);
            if (mxp + mw < W) ctx.drawImage(m.img, mxp + span, m.y);
          }
          for (var c = 0; c < clumps.length; c++) {
            var cl = clumps[c];
            cl.spr.set(cl.x, cl.y, cl.amp * K.noise1(t / cl.per, cl.seed));
          }
          headRim.set(0, rimTop, 0, 0.12 + 0.88 * vis);
          // Land and water darken with the sky.
          ctx.globalAlpha = 1;
          var dk = 0.26 * K.smooth(p);
          ctx.fillStyle = K.linear(ctx, 0, horizon - H * 0.1, 0, horizon + H * 0.03, [[0, 'rgba(10, 9, 30, 0)'],
            [1, 'rgba(10, 9, 30, ' + dk.toFixed(3) + ')']]);
          ctx.fillRect(0, horizon - H * 0.1, W, H - horizon + H * 0.1);
        },

        // The near shore: a headland on the side away from the sun, crisp in front.
        // the headland sits in the evening haze (#71627E), thickest at the waterline
        front: function (fx) {
          var hl = K.canvas(SW, SH), hx = hl.getContext('2d');
          hx.fillStyle = '#1b1530'; drawHeadland(hx, 1);
          hx.globalCompositeOperation = 'source-atop';
          hx.fillStyle = K.linear(hx, 0, hz - SH * 0.09, 0, hz, [[0, 'rgba(113, 98, 126, 0.12)'], [1, 'rgba(113, 98, 126, 0.42)']]);
          hx.fillRect(0, hz - SH * 0.12, SW, SH * 0.13);
          fx.drawImage(hl, 0, 0);
        },
      };
    },

    lofi: {
      key: 'D', mode: 'major', bpm: 70, swing: 0.57,
      progs: ['Imaj9 vi9 ii9 V13sus', 'Imaj9 iii7 vi9 V9sus', 'IVmaj9 iii7 ii9 V13sus'],
      keys: { inst: 'piano', style: 'hold', range: [50, 72], size: 3, ep: true, level: 1 },
      lead: { inst: 'vibes', range: [64, 84], level: 0.69, motif: '4.2.3 6.2.2 8.8.1 |' },
      reply: { inst: 'vibes', shift: -12, level: 0.7 },
      bass: { style: 'lofi', level: 0.76 },
      drums: { style: 'boom', snare: 'rim', hat: 'hat', level: 0.76 },
      fx: { tone: 5000, crackle: 0.3, hiss: 0.35, wow: 0.8, room: 0.4, verb: 1.1, echo: 0.75, duck: 0.1 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // Water: brown noise, darkened, rising and falling like a slow tide.
      var wg = K.gain(ac, 0.05, out);
      K.loop(ac, K.noise(ac, 'brown', 6), K.filter(ac, 'lowpass', 420, null, wg), t0);
      K.lfo(ac, 0.07, 0.025, wg.gain, 'sine', t0);
      return function () {};
    },
  });
})();

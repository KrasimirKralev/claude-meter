// Forest clearing - late golden light slanting through tall trunks, beams that
// slowly brighten and fade, dust drifting in them, fireflies waking up in the
// grass, ferns in front.
// Music: folk-tinged lo-fi in G (66 bpm): nylon guitar picking, a kalimba call answered
// by guitar thirds, then silence, upright bass, a soft kick and shaker; birds, leaves.
(function () {
  'use strict';
  var K = window.RelaxKit;

  function fern(fx, rnd, x, y, size, lean, colour) {
    var fronds = 5 + Math.floor(rnd() * 4);
    for (var f = 0; f < fronds; f++) {
      var a = -Math.PI / 2 + lean + (f - (fronds - 1) / 2) * (0.3 + 0.12 * rnd()) + (rnd() - 0.5) * 0.25;
      var len = size * (0.55 + 0.5 * rnd()) * (1 - Math.abs(f - (fronds - 1) / 2) * 0.07);
      var curl = 0.7 + 0.7 * rnd();
      var dx = Math.cos(a), dy = Math.sin(a);
      var side0 = a < -Math.PI / 2 ? -1 : 1;
      var pt = function (s) { return [x + dx * len * s + side0 * len * 0.35 * s * s * curl, y + dy * len * s + len * 0.5 * s * s * curl]; };
      fx.strokeStyle = colour; fx.fillStyle = colour; fx.lineCap = 'round';
      fx.lineWidth = size * 0.012;
      fx.beginPath();
      for (var s = 0; s <= 1; s += 0.05) { var p = pt(s); if (s === 0) fx.moveTo(p[0], p[1]); else fx.lineTo(p[0], p[1]); }
      fx.stroke();
      for (var q = 0.1; q < 0.97; q += 0.04 + 0.015 * rnd()) {
        if (rnd() < 0.06) continue;
        var p0 = pt(q), p1 = pt(q + 0.02);
        var tx = p1[0] - p0[0], ty = p1[1] - p0[1]; var tl = Math.sqrt(tx * tx + ty * ty) || 1; tx /= tl; ty /= tl;
        var ll = size * 0.13 * Math.sin(Math.PI * Math.min(1, q * 1.1)) * (0.7 + 0.45 * rnd());
        for (var side = -1; side <= 1; side += 2) {
          var nx = -ty * side, ny = tx * side;
          fx.beginPath();
          fx.moveTo(p0[0], p0[1]);
          fx.quadraticCurveTo(p0[0] + nx * ll * 0.6 + tx * ll * 0.5, p0[1] + ny * ll * 0.6 + ty * ll * 0.5,
            p0[0] + nx * ll + tx * ll * 0.5, p0[1] + ny * ll + ty * ll * 0.5 + ll * 0.15);
          fx.quadraticCurveTo(p0[0] + nx * ll * 0.4 + tx * ll * 0.1, p0[1] + ny * ll * 0.4 + ty * ll * 0.1, p0[0] + tx * ll * 0.25, p0[1] + ty * ll * 0.25);
          fx.fill();
        }
      }
    }
  }

  // A trunk standing on `base`, w wide, running out of the top of the picture with a
  // slight bend, a root flare and the odd broken branch stub.
  function trunk(x, rnd, cx, base, w, bend, lean) {
    var top = -w * 2, steps = 14, left = [], right = [];
    for (var i = 0; i <= steps; i++) {
      var k = i / steps, y = base + (top - base) * k;
      var off = bend * w * 6 * k * k + (lean || 0) * (base - y) + Math.sin(k * 5 + cx) * w * 0.12;
      var half = w * (0.5 - 0.1 * k) * (1 + 0.04 * Math.sin(k * 23 + cx * 3));
      left.push([cx + off - half, y]); right.push([cx + off + half, y]);
    }
    x.beginPath();
    x.moveTo(cx - w * 1.2, base + w * 0.1);
    x.quadraticCurveTo(left[0][0] + w * 0.05, base - w * 0.1, left[1][0], left[1][1]);
    for (var a = 2; a < left.length; a++) x.lineTo(left[a][0], left[a][1]);
    for (var b = right.length - 1; b >= 1; b--) x.lineTo(right[b][0], right[b][1]);
    x.quadraticCurveTo(right[0][0] - w * 0.05, base - w * 0.1, cx + w * 1.25, base + w * 0.1);
    x.closePath(); x.fill();
    if (rnd() < 0.28) {
      // a fork: a second, thinner stem leaving the trunk part way up
      var fk = 0.3 + 0.3 * rnd(), fd = rnd() < 0.5 ? -1 : 1, fy = base + (top - base) * fk;
      var fx0 = cx + bend * w * 6 * fk * fk + (lean || 0) * (base - fy), fl = fd * (0.12 + 0.14 * rnd());
      x.beginPath();
      x.moveTo(fx0 - w * 0.4, fy + w * 0.6);
      x.lineTo(fx0 + fl * (fy - top) * 0.9 - w * 0.22, top);
      x.lineTo(fx0 + fl * (fy - top) * 0.9 + w * 0.22, top);
      x.lineTo(fx0 + w * 0.4, fy + w * 0.6);
      x.closePath(); x.fill();
    }
    if (rnd() < 0.4) {
      var sy = base - (base - top) * (0.35 + 0.35 * rnd()), sd = rnd() < 0.5 ? -1 : 1;
      var k2 = (base - sy) / (base - top), sx = cx + bend * w * 6 * k2 * k2 + (lean || 0) * (base - sy);
      x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + sd * w * (0.8 + rnd()), sy - w * (0.6 + 0.6 * rnd()));
      x.lineTo(sx + sd * w * 0.1, sy - w * 0.45); x.closePath(); x.fill();
    }
  }

  RelaxBiomes.register({
    id: 'forest-clearing',
    name: 'Forest clearing',
    about: 'Misty forest with soft sunbeams breathing, dust drifting in the light, fireflies waking, ferns. Lo-fi in G: nylon guitar picking, a kalimba call answered by guitar thirds, upright bass, soft kick and shaker, birds, leaves.',
    ink: '255, 246, 222',
    shade: '10, 18, 12',
    vignette: 0.32,
    legible: 0.45,
    scale: 4,
    grade: { shadow: '10, 22, 20', light: '255, 246, 228' },
    level: 1.234, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.378,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var SW = s.SW, SH = s.SH;
      var floor = H * 0.72;
      // One low sun, upper right on the main screen (towards the other screen); its
      // shafts fall into the clearing. The side screen is deeper forest lit from its inner edge.
      var lightX = main ? W * (0.5 + 0.42 * inner) : (inner > 0 ? W * 1.1 : -W * 0.1);
      var lightY = -H * 0.18;
      var clearU = main ? 0.5 - 0.06 * inner : 0.5;
      var far = '#8ca88a', near = '#17352a';
      function ground(u) {
        var rise = main ? H * 0.035 * Math.exp(-Math.pow((u - clearU) / 0.22, 2)) : H * 0.015 * Math.exp(-Math.pow((u - 0.6) / 0.3, 2));
        return floor - rise + H * 0.008 * K.noise1(u * 7, 3);
      }

      // Everything behind the light is painted once: the backlit haze, three depths of
      // trunks (each fainter and closer to the haze), the canopy and the floor.
      var bg = s.layer(), bx = bg.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, 0, floor, [[0, '#18302a'], [0.45, '#3d634c'], [1, '#93a67c']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'lighter';
      bx.fillStyle = K.radial(bx, lightX, H * 0.2, W * 0.6, [[0, 'rgba(236, 238, 184, 0.62)'], [0.35, 'rgba(200, 220, 160, 0.2)'],
        [1, 'rgba(160, 200, 150, 0)']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'source-over';
      var DEPTHS = [
        { n: 20, w: [0.004, 0.008], d: 0.88, clear: 0.0 },
        { n: 12, w: [0.008, 0.014], d: 0.62, clear: 0.12 },
        { n: 8, w: [0.014, 0.024], d: 0.28, clear: 0.2 },
      ];
      DEPTHS.forEach(function (dp, di) {
        // trunks stand in clusters, with a clear opening around the clearing
        var placed = 0, guard = 0;
        while (placed < dp.n && guard++ < 400) {
          var cu = rnd(), k = 2 + Math.floor(rnd() * 3);
          if (main && Math.abs(cu - clearU) < dp.clear) continue;
          for (var j = 0; j < k && placed < dp.n; j++) {
            var u = cu + (rnd() - 0.5) * 0.045;
            if (main && Math.abs(u - clearU) < dp.clear) continue;
            var tw = W * (dp.w[0] + (dp.w[1] - dp.w[0]) * rnd());
            bx.fillStyle = K.aerial(near, far, dp.d + (rnd() - 0.5) * 0.08);
            trunk(bx, rnd, u * W, ground(u) + H * 0.01 * (2 - di), tw, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.1);
            placed++;
          }
        }
        // haze between the depths: lighter towards the sun
        bx.globalCompositeOperation = 'lighter';
        bx.fillStyle = K.radial(bx, lightX, H * 0.25, W * 0.8, [[0, 'rgba(210, 226, 170, ' + (0.14 - di * 0.03) + ')'],
          [1, 'rgba(150, 190, 140, 0)']]);
        bx.fillRect(0, 0, W, floor + H * 0.05);
        bx.globalCompositeOperation = 'source-over';
      });
      // the canopy: dark leaf masses thinning where the light breaks through
      var canopy = K.field(W, Math.round(H * 0.34), function (u, v, out) {
        var hole = Math.exp(-Math.pow((u * W - lightX) / (W * 0.16), 2)) * 0.55;
        var n = K.fbm2(u * 9, v * 4, 4, 41) * 0.5 + 0.5;
        var hang = K.noise1(u * 13, 44) * 0.25;
        var a = K.smooth((n * 1.5 - v * (1.35 + hang) - hole + 0.18) / 0.3);
        if (a <= 0.01) return null;
        var lit = K.smooth((n - 0.55) / 0.2) * (1 - v) * 0.6;
        out[0] = 15 + 45 * lit; out[1] = 34 + 60 * lit; out[2] = 25 + 30 * lit; out[3] = a * 0.96;
        return out;
      });
      bx.filter = 'blur(0.8px)';
      bx.drawImage(canopy, 0, -H * 0.02);
      bx.filter = 'none';
      // the floor: a gentle rise in the clearing, two pools of shade, low plants
      bx.fillStyle = K.linear(bx, 0, floor - H * 0.04, 0, H, [[0, '#7b9a63'], [0.3, '#4f7046'], [1, '#183424']]);
      bx.beginPath(); bx.moveTo(0, H);
      for (var gx = 0; gx <= W + 4; gx += 4) bx.lineTo(gx, ground(gx / W));
      bx.lineTo(W, H); bx.closePath(); bx.fill();
      var pools = K.field(Math.ceil(W / 2), Math.ceil((H - floor + H * 0.05) / 2), function (u, v, out) {
        var n = K.fbm2(u * 4, v * 3, 3, 77);
        var a = K.smooth((n + 0.05) / 0.35) * 0.45 * Math.min(1, v * 3);
        if (a <= 0.01) return null;
        out[0] = 14; out[1] = 32; out[2] = 22; out[3] = a; return out;
      });
      bx.drawImage(pools, 0, floor - H * 0.04, W, H - floor + H * 0.05);
      // warm light where the shafts land
      if (main) {
        bx.globalCompositeOperation = 'lighter';
        bx.save(); bx.translate(W * clearU, ground(clearU) + H * 0.06); bx.scale(1, 0.25);
        bx.fillStyle = K.radial(bx, 0, 0, W * 0.26, [[0, 'rgba(240, 230, 150, 0.32)'], [0.6, 'rgba(220, 210, 130, 0.1)'], [1, 'rgba(220, 210, 130, 0)']]);
        bx.fillRect(-W * 0.3, -W * 0.3, W * 0.6, W * 0.6); bx.restore();
        bx.globalCompositeOperation = 'source-over';
      }
      // low plants in the middle distance, hazed
      for (var lp = 0; lp < 14; lp++) {
        var pu = rnd(); if (main && Math.abs(pu - clearU) < 0.08) pu += 0.16;
        bx.fillStyle = K.aerial(near, far, 0.35 + rnd() * 0.15);
        fern(bx, rnd, pu * W, ground(pu) + H * (0.01 + 0.04 * rnd()), H * (0.03 + 0.04 * rnd()), (rnd() - 0.5) * 0.4, bx.fillStyle);
      }
      // still mist along the ground
      var mist = K.wisps({ w: W, h: Math.round(H * 0.1), rgb: '214, 228, 196', alpha: 0.3, cover: 0.55, seed: 12, stretch: 7 });
      bx.drawImage(mist, 0, floor - H * 0.07);

      // Dappled light on the floor (the canopy's shadow), shifting a few px very slowly.
      var dapple = K.field(Math.ceil(W / 2), Math.ceil(H * 0.14), function (u, v, out) {
        var n = K.fbm2(u * 22, v * 6, 3, 93);
        var c = main ? Math.exp(-Math.pow((u - clearU) / 0.28, 2)) : 0.4;
        var a = K.smooth((n - 0.12) / 0.3) * 0.13 * c * Math.sin(Math.PI * v);
        if (a <= 0.01) return null;
        out[0] = 250; out[1] = 236; out[2] = 170; out[3] = a; return out;
      });

      // Three to five broad shafts from the one sun, pre-rendered twice: the afternoon set
      // and a lower, warmer evening set the scene slowly crossfades to - the shafts swing.
      var clearX = W * clearU;
      // The sun is far away, so its shafts run almost parallel, each from its own gap in
      // the canopy, overlapping where they land; one is clearly the brightest.
      function shafts(angle, rgb, seed, alpha) {
        var c = s.layer(), x = c.getContext('2d'), r = K.seeded(seed), n = main ? 4 : 2;
        var lands = main ? [-0.17, -0.05, 0.04, 0.15] : [0, 0.1];
        var bright = [0.55, 1, 0.75, 0.45];
        for (var i = 0; i < n; i++) {
          var landX = main ? W * (clearU + lands[i]) : (inner > 0 ? W * (0.8 + lands[i]) : W * (0.2 - lands[i]));
          var ang = angle + (r() - 0.5) * 0.05;
          var ox = landX - Math.tan(ang) * (floor + H * 0.05 - lightY);
          x.drawImage(K.rays(W, H, { x: ox, y: lightY, angle: ang, spread: 0, count: 1, length: H * 1.7,
            width: W * (0.035 + 0.035 * r()), rgb: rgb, alpha: alpha * bright[i], seed: seed + i * 5, patchy: 0.55 }), 0, 0);
        }
        return c;
      }
      var a0 = Math.atan2(clearX - lightX, floor - lightY);
      var raysA = shafts(a0 + 0.06 * inner, '221, 230, 172', 3, main ? 0.62 : 0.46);
      var raysB = shafts(a0 - 0.14 * inner, '240, 204, 140', 9, main ? 0.66 : 0.46);

      // Dust: one layer of tiny (2 px) specks at full resolution, drifting 1-3 px a second as a
      // whole (one compositor layer, opacity fixed), plus four soft larger motes on the canvas.
      var SW = s.SW, SH = s.SH, dust = [];
      (function () {
        var dw = Math.round(SW * 0.44), dh = Math.round(SH * 0.56), r2 = K.seeded(400 + (main ? 0 : 9));
        var spr = s.sprite(dw, dh, function (cx) {
          cx.fillStyle = 'rgba(255, 240, 200, 0.9)';
          for (var i = 0; i < 26; i++) {
            var px = dw * (0.08 + 0.84 * r2()), py = dh * (0.05 + 0.9 * r2()), sz = r2() < 0.75 ? 1.5 : 2.2;
            cx.globalAlpha = 0.3 + 0.5 * r2();
            cx.fillRect(px, py, sz, sz);
          }
        });
        spr.el.style.opacity = '0.75';
        dust.push({ spr: spr, x: SW * (clearU - 0.22), y: SH * 0.12, seed: 50, sp: 1 });
      })();
      var motes = [], mote = K.glow(1.5, '255, 238, 196', [[0, 0.6], [1, 0]]);
      for (var m = 0; m < 4; m++) {
        var along = 0.3 + 0.65 * rnd(), across = (rnd() - 0.5) * (main ? 0.5 : 0.3);
        var ang = a0 + across;
        motes.push({ x: lightX + Math.sin(ang) * (floor - lightY) * along / Math.cos(ang), y: lightY + (floor - lightY) * along,
          ph: rnd() * 100, sp: 0.25 + 0.5 * rnd(), a: 0.4 + 0.6 * rnd() });
      }
      var fly = K.glow(3, '225, 255, 150', [[0, 1], [0.3, 0.5], [1, 0]]);
      var flies = [];
      for (var f = 0; f < (main ? 5 : 3); f++) {
        flies.push({ x: W * (0.12 + 0.76 * rnd()), y: floor + H * (0.03 + 0.12 * rnd()), ph: rnd() * 50, on: 0.55 + 0.35 * rnd() });
      }

      // The nearest trunks and ferns are crisp on the front layer; they cut the shafts.
      var r = K.seeded(3131 + (main ? 0 : 7));
      var NEAR = main ? [[0.5 - 0.44 * inner, 0.07, 0.03], [0.5 - 0.33 * inner, 0.045, -0.02], [0.5 + 0.3 * inner, 0.05, 0.04]]
        : [[0.18, 0.06, 0.03], [0.27, 0.035, -0.03], [0.74, 0.075, -0.02]];

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bg, 0, 0);
          // the canopy's shadow drifts 2-5 px over half a minute
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - 0.5 * p;
          ctx.drawImage(dapple, K.noise1(t / 33, 4) * 1.1, floor - H * 0.03 + K.noise1(t / 41, 5) * 0.5, W, H * 0.14);
          // the shafts: they breathe slowly and swing lower and warmer towards evening
          var sw = K.smooth(p);
          var br = 0.8 + 0.2 * K.noise1(t / 23, 7);
          ctx.globalAlpha = (1 - sw) * br; ctx.drawImage(raysA, 0, 0);
          ctx.globalAlpha = sw * br * (1 - 0.25 * p); ctx.drawImage(raysB, 0, 0);
          // dust, bright where the shafts are
          for (var i = 0; i < motes.length; i++) {
            var mo = motes[i];
            var mx = mo.x + K.noise1(t * 0.05 * mo.sp + mo.ph, 1) * W * 0.03 + t * 0.12 * mo.sp;
            var my = mo.y + K.noise1(t * 0.04 * mo.sp + mo.ph, 2) * H * 0.04;
            mx = ((mx % W) + W) % W;
            ctx.globalAlpha = mo.a * (0.55 + 0.45 * K.noise1(t * 0.3 + mo.ph, 3)) * (1 - 0.4 * p);
            ctx.drawImage(mote, mx - 1.5, my - 1.5);
          }
          for (var di2 = 0; di2 < dust.length; di2++) {
            var du = dust[di2];
            du.spr.set(du.x + K.noise1(t / 33 * du.sp, du.seed) * 40, du.y + K.noise1(t / 47 * du.sp, du.seed + 1) * 22, 0);
          }
          // late afternoon: the light warms and the wood darkens a little
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.5 * sw;
          ctx.fillStyle = 'rgb(255, 214, 160)'; ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(30, 28, 16, ' + (0.2 * sw).toFixed(3) + ')';
          ctx.fillRect(0, 0, W, H);
          // a few fireflies wake only in the last minute and a half
          var late = K.smooth((p - 0.6) / 0.2);
          if (late > 0) {
            ctx.globalCompositeOperation = 'lighter';
            for (var j = 0; j < flies.length; j++) {
              var fl = flies[j];
              var pulse = Math.pow(Math.max(0, K.noise1(t * 0.35 + fl.ph, 6)), 2) * 2.2;
              if (pulse < 0.03) continue;
              ctx.globalAlpha = Math.min(1, pulse) * late * fl.on * 0.75;
              ctx.drawImage(fly, fl.x + K.noise1(t * 0.06 + fl.ph, 7) * W * 0.04 - 3, fl.y + K.noise1(t * 0.05 + fl.ph, 8) * H * 0.03 - 3);
            }
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.globalAlpha = 1;
        },

        front: function (fx) {
          // near trunks, dark green rather than black, lit along the edge facing the sun
          var c = K.canvas(SW, SH), x = c.getContext('2d');
          var rims = K.canvas(SW, SH), rx = rims.getContext('2d');
          NEAR.forEach(function (n) {
            var tx0 = n[0] * SW, tw = SW * n[1] * 0.55, facing = clearU > n[0] ? 1 : -1;
            var one = K.canvas(SW, SH), ox = one.getContext('2d');
            // bark shaded across the trunk: darker on the side away from the opening
            ox.fillStyle = K.linear(ox, tx0 - tw * facing, 0, tx0 + tw * facing, 0, [[0, '#0f251c'], [0.6, near], [1, '#24493a']]);
            trunk(ox, r, tx0, SH * (0.96 + 0.02 * r()), tw, n[2] * 3, n[2] * 0.5);
            x.drawImage(one, 0, 0);
            // rim light only on the edge facing the opening
            rx.drawImage(K.rimLayer(one, facing, -0.3, SH * 0.004, '236, 232, 168', 0.5, 1.5), 0, 0);
          });
          // the rim broken up by the bark and fading out towards the roots
          var bark = K.field(Math.ceil(SW / 6), Math.ceil(SH / 6), function (u, v, out) {
            var n = K.noise2(u * 90, v * 7, 5) * 0.6 + K.noise2(u * 30, v * 2, 6) * 0.4;
            out[0] = out[1] = out[2] = 0; out[3] = K.smooth((n + 0.15) / 0.35) * K.smooth((0.93 - v) / 0.22); return out;
          });
          rx.globalCompositeOperation = 'destination-in';
          rx.drawImage(bark, 0, 0, SW, SH);
          x.globalCompositeOperation = 'source-atop';
          x.drawImage(rims, 0, 0);
          fx.drawImage(c, 0, 0);
          // grass and ferns at the bottom, a big fern on the outer side, slightly out of focus
          var g = K.canvas(SW, SH), gx = g.getContext('2d');
          gx.strokeStyle = '#0f2618'; gx.lineCap = 'round';
          for (var i = 0; i < 300; i++) {
            var px = r() * SW, cl = Math.pow(K.noise1(px / SW * 9, 2) * 0.5 + 0.5, 1.5);
            var gh = SH * (0.02 + 0.07 * r()) * (0.3 + cl);
            gx.lineWidth = 1 + r() * 2;
            gx.beginPath(); gx.moveTo(px, SH + 2);
            gx.quadraticCurveTo(px + (r() - 0.5) * gh * 0.4, SH - gh * 0.6, px + (r() - 0.3) * gh * 0.5, SH - gh);
            gx.stroke();
          }
          var outerX = inner > 0 ? 0.06 : 0.94;
          fern(gx, r, SW * outerX, SH * 1.02, SH * 0.38, 0.15 * inner, '#0d2216');
          fern(gx, r, SW * (outerX + 0.09 * inner), SH * 1.03, SH * 0.2, -0.1, '#132c1e');
          fern(gx, r, SW * (1 - outerX - 0.02 * inner), SH * 1.04, SH * 0.16, 0.2, '#132c1e');
          K.rim(g, inner, -0.6, 1.5, '230, 226, 160', 0.35, 1);
          fx.filter = 'blur(1.2px)';
          fx.drawImage(g, 0, 0);
          fx.filter = 'none';
        },
      };
    },

    lofi: {
      key: 'G', mode: 'major', bpm: 66, swing: 0.54, swing8: true,
      progs: ['Imaj9 iii7 IVmaj9 Imaj9', 'Imaj9 vi9 IVmaj9 V9sus', 'IVmaj9 V9sus iii7 vi9'],
      keys: { inst: 'guitar', style: 'arp', range: [52, 76], level: 0.9 },
      lead: { inst: 'kalimba', range: [62, 83], level: 0.32, space: true, motif: '0.2.5 2.2.6 4.8.5 |' },
      reply: { inst: 'guitar', shift: -12, harm: true, level: 0.25 },
      bass: { style: 'lofi', level: 0.42 },
      drums: { style: 'sparse', snare: 'tap', hat: 'shaker', level: 0.44 },
      fx: { tone: 6000, crackle: 0.25, hiss: 0.3, wow: 0.7, room: 0.45, verb: 1.2, echo: 0, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 3.2, 2.8, out, 0.3);
      // Leaves in the wind.
      var leafG = K.gain(ac, 0.05, out);
      K.loop(ac, K.noise(ac, 'pink', 8), K.filter(ac, 'bandpass', 1400, 0.5, leafG), t0);
      K.lfo(ac, 0.06, 0.03, leafG.gain, 'sine', t0);
      var birds = K.filter(ac, 'lowpass', 5200, 0.3, K.gain(ac, 1, out));
      birds.connect(K.gain(ac, 0.5, rv));
      var nextBird = t0 + 3;
      function chirp(at, f0, f1, len, lv, pan) {
        var o = ac.createOscillator(); o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + len);
        var g = ac.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(lv, at + len * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g); g.connect(K.panner(ac, pan, birds)); o.start(at); o.stop(at + len + 0.02);
      }

      return function schedule(until) {
        while (nextBird < until) {
          var pan = Math.random() * 1.6 - 0.8;
          var kind = Math.floor(Math.random() * 3);
          var bt = nextBird, base = 2400 + Math.random() * 1600, lv = 0.006 + Math.random() * 0.006;
          var reps = 2 + Math.floor(Math.random() * 4);
          for (var c = 0; c < reps; c++) {
            if (kind === 0) chirp(bt, base, base * 1.35, 0.07, lv, pan);          // rising peeps
            else if (kind === 1) chirp(bt, base * 1.3, base * 0.8, 0.12, lv, pan); // falling notes
            else { chirp(bt, base, base * 1.2, 0.05, lv, pan); chirp(bt + 0.06, base * 1.2, base * 0.9, 0.08, lv, pan); }
            bt += kind === 1 ? 0.22 : 0.14;
          }
          nextBird = bt + 3 + Math.random() * 7;
        }
      };
    },
  });
})();

// Moonlit sea - a full moon over a calm night sea, thin clouds sliding past it,
// its path glittering on the water, a lighthouse on a dark headland sweeping
// its beam slowly round, surf breaking white at the rocks.
// Music: night lo-fi in C-sharp minor (62 bpm, half time): dusky keys, a nylon-guitar beacon
// note answered by a falling line, cello, upright bass, a slow kick and snare; surf, a bell buoy.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // The near cliff, in fractions of the screen measured from its outer edge (u across, v down):
  // a plateau for the tower, then three unequal breaks down to the sea - a big one under the
  // plateau, a smaller one mid-way, a short one at the foot - with sloping faces between them.
  var CLIFF = [[0, 0.44], [0.05, 0.433], [0.1, 0.43], [0.14, 0.436], [0.158, 0.45], [0.166, 0.49], [0.178, 0.512],
    [0.21, 0.522], [0.245, 0.548], [0.262, 0.556], [0.27, 0.59], [0.284, 0.616], [0.305, 0.64], [0.316, 0.668],
    [0.322, 0.7], [0.31, 0.76], [0.29, 0.84], [0.27, 0.92], [0.255, 1]];
  // The two planes: the long sloping face between the breaks, turned to the moon, and the rest in shadow.
  var LIT = [[0.166, 0.49], [0.178, 0.512], [0.21, 0.522], [0.245, 0.548], [0.262, 0.556], [0.27, 0.59],
    [0.284, 0.616], [0.305, 0.64], [0.29, 0.66], [0.258, 0.63], [0.226, 0.585], [0.19, 0.545]];

  RelaxBiomes.register({
    id: 'moonlit-lighthouse',
    name: 'Moonlit lighthouse',
    about: 'A full moon climbing over a calm night sea, clouds sliding past it, sea mist gathering, a lighthouse slowly sweeping its beam, surf on the rocks. Night lo-fi in C-sharp minor: dusky keys, a nylon-guitar beacon note, cello, upright bass, a slow kick and snare, rolling surf, a bell buoy.',
    ink: '232, 238, 255',
    shade: '2, 6, 18',
    vignette: 0.32,
    scale: 3,
    grade: { shadow: '6, 12, 28', light: '246, 248, 255' },
    grain: 0.02,
    level: 0.857, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.231, // the surf about 11 LU under the music (measured)

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var horizon = Math.round(H * 0.6), outer = -inner;
      function X(u) { return outer < 0 ? u * SW : SW - u * SW; }
      // The moon on the main screen, towards the other one; the side screen gets the
      // open sea, a far point of land and the edge of the moon's light.
      var moonU = main ? 0.5 + 0.19 * inner : (inner < 0 ? -0.25 : 1.25);
      var moonX = W * moonU, moonR = H * 0.046;

      var sky = s.layer(W, horizon + 2), sx = sky.getContext('2d');
      sx.fillStyle = K.linear(sx, 0, 0, 0, horizon, [[0, '#050a1a'], [0.45, '#0c1a35'], [0.85, '#1a2f52'], [1, '#26406a']]);
      sx.fillRect(0, 0, W, horizon + 2);
      var starsAll = K.stars(W, horizon, rnd, { faint: 300, mid: 22, bright: main ? 2 : 3, rgb: '228, 234, 255',
        density: function (v) { return v < 0.8 ? 1 - v * 0.8 : 0; } });
      var stars = { mid: starsAll.mid, still: s.layer(W, horizon) };
      stars.still.getContext('2d').globalAlpha = 0.9;
      stars.still.getContext('2d').drawImage(starsAll.faint, 0, 0);
      stars.still.getContext('2d').globalAlpha = 1;
      stars.still.getContext('2d').drawImage(starsAll.bright, 0, 0);

      // The moon: limb darkening and faint seas, painted once at twice the canvas size,
      // in a warm low-moon tone and a cool high-moon one that crossfade as it climbs.
      function disc(warm) {
        var r = Math.ceil(moonR * 2);
        return K.field(r * 2, r * 2, function (u, v, out) {
          var dx = u * 2 - 1, dy = v * 2 - 1, d = Math.hypot(dx, dy);
          if (d > 1) return null;
          var limb = 0.78 + 0.22 * Math.sqrt(1 - d * d);
          var sea = K.clamp(K.fbm2(u * 3.2 + 4, v * 3.2 + 1, 3, 17) * 1.6 + 0.1, 0, 1) * 0.16;
          var l = limb * (1 - sea);
          out[0] = (warm ? 255 : 240) * l; out[1] = (warm ? 226 : 242) * l; out[2] = (warm ? 182 : 236) * l;
          out[3] = K.clamp((1 - d) * r * 1.2, 0, 1);
          return out;
        });
      }
      var moonWarm = main ? disc(true) : null, moonCool = main ? disc(false) : null;
      var moonGlow = K.bloom('190, 206, 250', 2.4), moonWarmGlow = K.bloom('250, 214, 170', 2);
      var veilGlow = K.glow(64, '200, 214, 250', [[0, 0.5], [0.3, 0.35], [0.6, 0.12], [1, 0]]);

      // Three soft cloud masses with tapered ends, lit silver on top; one drifts across
      // the moon in the middle of the break. The rest of the sky stays clear.
      var clouds = [
        { w: 0.46, h: 0.075, y: 0.17, v: 0.5, seed: 4, a: 0.75 },
        { w: 0.36, h: 0.06, y: 0.36, v: 0.32, seed: 9, a: 0.55 },
        { w: 0.3, h: 0.05, y: 0.07, v: 0.42, seed: 13, a: 0.5 },
      ].map(function (c, i) {
        var img = K.wisps({ w: Math.round(W * c.w), h: Math.round(H * c.h * 1.6), rgb: '120, 138, 180', alpha: c.a,
          cover: 0.62, freq: 2.2, seed: c.seed + (main ? 0 : 20), stretch: 4, oct: 4 });
        var v = c.v * (s.reduced ? 0 : 1) / s.scale;
        // the first one crosses the moon about 100 s in; the others start where they look best
        var x0 = i === 0 && main ? moonX - img.width / 2 - v * 105 : W * (i === 1 ? 0.05 : 0.55) - img.width / 2;
        return { img: img, x0: x0, y: H * c.y, v: v };
      });

      // Far land: a low coast behind the cliff, and on the side screen a long point.
      var far = s.layer(W, horizon + 2), fx2 = far.getContext('2d');
      fx2.fillStyle = K.aerial('#0b1426', '#2a4068', 0.55);
      fx2.fill(K.ridge(-2, W + 2, 2, function (x) {
        var u = outer < 0 ? x / W : 1 - x / W;
        var reach = main ? K.smooth((0.5 - u) / 0.2) : K.smooth((0.42 - u) / 0.3);
        return horizon - H * reach * (0.016 + 0.02 * (main ? 0 : 1) + 0.006 * K.noise1(u * 14, 3)) - (reach > 0.02 ? 0.5 : 0);
      }, horizon + 1));
      if (!main) { fx2.fillStyle = 'rgba(255, 214, 150, 0.9)'; fx2.fillRect(outer < 0 ? W * 0.12 : W * 0.88, horizon - H * 0.03, 1, 1); }

      var sea = s.layer(), ex = sea.getContext('2d');
      ex.fillStyle = K.linear(ex, 0, horizon, 0, H, [[0, '#1f3558'], [0.2, '#13243f'], [1, '#050b18']]);
      ex.fillRect(0, horizon, W, H - horizon);
      ex.fillStyle = K.linear(ex, 0, horizon, 0, horizon + 3, [[0, 'rgba(150, 175, 220, 0.3)'], [1, 'rgba(150, 175, 220, 0)']]);
      ex.fillRect(0, horizon, W, 3);
      // The moon's path: broken silver marks, narrow far out, wider and darker near us.
      function path(seed) {
        var c = s.layer(), x = c.getContext('2d'), r = K.seeded(seed);
        for (var i = 0; i < 52; i++) {
          var d = Math.pow((i + r()) / 52, 1.4);
          var y = horizon + 1 + (H - horizon) * 0.95 * d, spread = W * (0.01 + 0.08 * d);
          for (var m = 0, n = 1 + Math.floor(r() * (1 + d * 3)); m < n; m++) {
            var off = (r() + r() - 1) * spread, len = W * (0.004 + 0.022 * d) * (0.4 + r());
            var a = 0.75 * Math.pow(1 - d, 0.9) * (1 - Math.abs(off) / (spread * 1.05)) * (0.45 + 0.55 * r());
            if (a <= 0.02) continue;
            x.fillStyle = K.mix('#f2f0e4', '#6f88b0', Math.min(1, d * 1.2), a.toFixed(3));
            x.fillRect(moonX + off - len / 2, y, len, 0.6 + d * 1.2);
          }
        }
        return c;
      }
      var paths = main ? [path(5), path(23)] : null;
      var ripples = K.field(Math.ceil(W / 2), H - horizon, function (u, v, out) {
        var n = K.noise2(u * 10, v * 80, 31);
        var a = K.clamp((n - 0.4) * 1.7, 0, 1) * 0.13 * Math.min(1, v * 3 + 0.15);
        if (a <= 0.003) return null;
        out[0] = 168; out[1] = 190; out[2] = 236; out[3] = a; return out;
      });
      var mist = K.wisps({ w: Math.round(W * 1.2), h: Math.round(H * 0.1), rgb: '150, 170, 210', alpha: 0.3, cover: 0.55,
        seed: main ? 7 : 19, stretch: 10 });

      // The cliff, the tower and the keeper's cottage: crisp, on the front layer.
      // Rock edges are never ruled: each segment is subdivided and roughened.
      function rough(pts, closeTo) {
        var p = new Path2D(), r = K.seeded(29), out = [];
        for (var i = 0; i < pts.length - 1; i++) {
          var a = pts[i], b = pts[i + 1], n = 6;
          for (var j = 0; j < n; j++) {
            var f = j / n, jit = j ? (r() - 0.5) * 0.004 : 0;
            out.push([a[0] + (b[0] - a[0]) * f + jit, a[1] + (b[1] - a[1]) * f + (j ? (r() - 0.5) * 0.004 : 0)]);
          }
        }
        out.push(pts[pts.length - 1]);
        if (closeTo) p.moveTo(X(0), SH);
        else p.moveTo(X(out[0][0]), SH * out[0][1]);
        out.forEach(function (q) { p.lineTo(X(q[0]), SH * q[1]); });
        if (closeTo) p.lineTo(X(0), SH);
        p.closePath();
        return p;
      }
      function cliffPath(pts) { return rough(pts, true); }
      var tU = 0.11, tBase = SH * 0.432, tTop = SH * 0.252, tw0 = SW * 0.0155, tw1 = SW * 0.0105;
      var lampX = X(tU), lampY = SH * 0.238;
      function drawCliff(fx) {
        var rock = K.canvas(SW, SH), rx = rock.getContext('2d');
        rx.fillStyle = K.linear(rx, 0, SH * 0.43, 0, SH, [[0, '#0d1626'], [1, '#04070f']]);
        var cliff = cliffPath(CLIFF);
        rx.fill(cliff);
        rx.save(); rx.clip(cliff);
        rx.fillStyle = K.linear(rx, X(0.17), SH * 0.49, X(0.3), SH * 0.66, [[0, 'rgba(37, 55, 77, 0.8)'], [1, 'rgba(26, 40, 60, 0.45)']]);
        rx.fill(rough(LIT, false));
        rx.restore();
        // the tower: moonlit on the side facing the moon, bands dulled by the night
        var lx = X(tU), dir = -outer;
        rx.fillStyle = K.linear(rx, lx - tw0 * dir, 0, lx + tw0 * dir, 0, [[0, '#2a3248'], [0.55, '#6e7a96'], [1, '#a3aec6']]);
        rx.beginPath(); rx.moveTo(lx - tw0, tBase + 2); rx.lineTo(lx - tw1, tTop); rx.lineTo(lx + tw1, tTop); rx.lineTo(lx + tw0, tBase + 2);
        rx.closePath(); rx.fill();
        rx.fillStyle = 'rgba(30, 32, 52, 0.55)';
        [0.3, 0.62].forEach(function (q) {
          var y = tBase - (tBase - tTop) * q, w = tw0 + (tw1 - tw0) * q;
          rx.fillRect(lx - w, y - SH * 0.011, w * 2, SH * 0.022);
        });
        rx.fillStyle = '#0c111e';
        rx.fillRect(lx - tw1 * 1.45, tTop - SH * 0.004, tw1 * 2.9, SH * 0.006);
        rx.fillStyle = 'rgba(232, 215, 172, 0.85)'; rx.fillRect(lx - tw1 * 0.75, tTop - SH * 0.026, tw1 * 1.5, SH * 0.022);
        rx.fillStyle = '#0c111e'; rx.fillRect(lx - tw1 * 0.95, tTop - SH * 0.03, tw1 * 1.9, SH * 0.005);
        rx.beginPath(); rx.moveTo(lx - tw1 * 1.1, tTop - SH * 0.029); rx.lineTo(lx, tTop - SH * 0.046); rx.lineTo(lx + tw1 * 1.1, tTop - SH * 0.029); rx.fill();
        // the keeper's cottage, one window lit
        var cx0 = X(0.04), cx1 = X(0.082), cy = SH * 0.434;
        rx.fillStyle = '#0a0f1c';
        rx.fillRect(Math.min(cx0, cx1), cy - SH * 0.03, Math.abs(cx1 - cx0), SH * 0.032);
        rx.beginPath(); rx.moveTo(cx0 - (cx1 - cx0) * 0.08, cy - SH * 0.03); rx.lineTo((cx0 + cx1) / 2, cy - SH * 0.052);
        rx.lineTo(cx1 + (cx1 - cx0) * 0.08, cy - SH * 0.03); rx.fill();
        // moonlight catching every edge that faces it
        // moonlight on the edges that face it, broken where the rock turns away
        var rim = K.rimLayer(rock, -outer, -0.7, 2.4, '96, 124, 170', 0.55, 1);
        var gaps = K.field(Math.ceil(SW / 8), Math.ceil(SH / 8), function (u, v, out) {
          out[0] = out[1] = out[2] = 255; out[3] = K.smooth((K.fbm2(u * 22, v * 12, 3, 61) + 0.1) / 0.35); return out;
        });
        var rx2 = rim.getContext('2d'); rx2.globalCompositeOperation = 'destination-in'; rx2.drawImage(gaps, 0, 0, SW, SH);
        rx.drawImage(rim, 0, 0);
        fx.drawImage(rock, 0, 0);
        var wx = X(0.066), wy = cy - SH * 0.018;
        fx.fillStyle = K.radial(fx, wx, wy, SH * 0.02, [[0, 'rgba(255, 206, 130, 0.5)'], [1, 'rgba(255, 206, 130, 0)']]);
        fx.fillRect(wx - SH * 0.02, wy - SH * 0.02, SH * 0.04, SH * 0.04);
        fx.fillStyle = '#ffd08a'; fx.fillRect(wx - 3, wy - 4, 6, 7);
      }

      // The lantern's warm halo sits on a sprite in front of the tower; the beam is a
      // volume (a narrow core in a faint wide cone) on the canvas behind it.
      var lampSize = Math.round(SH * 0.3);
      var lamp = main ? s.sprite(lampSize, lampSize, function (cx, w, h) {
        cx.drawImage(K.bloom('232, 215, 172', 2.6), 0, 0, w, h);
      }) : null;
      var LW = Math.round(W * 0.95), LH = Math.round(H * 0.24);
      var cone = K.field(Math.round(LW / 2), Math.round(LH / 2), function (u, v, out) {
        var y = Math.abs(v - 0.5) * 2, half = 0.012 + 0.95 * Math.pow(u, 1.1), core = 0.006 + 0.16 * u;
        var a = 0.6 * Math.exp(-Math.pow(y / half, 2) * 2) + 0.42 * Math.exp(-Math.pow(y / core, 2) * 2);
        a *= 0.3 + 0.7 * K.smooth((K.fbm2(u * 5, v * 3, 3, 47) + 0.15) / 0.5); // the haze shows it in patches
        a *= Math.pow(1 - u, 1.25) * (0.6 + 0.4 * K.fbm2(u * 6, v * 2, 3, 41));
        if (a <= 0.003) return null;
        out[0] = 255; out[1] = 238; out[2] = 204; out[3] = Math.min(1, a); return out;
      });
      var ROT = 68; // seconds a turn: slow enough that the sweep is a slow sweep, not a signal
      var surf = main ? [0, 1].map(function (i) {
        var c = s.layer(), x = c.getContext('2d'), r = K.seeded(71 + i * 13);
        x.filter = 'blur(0.9px)';
        for (var k = 0; k < 46; k++) {
          var q = 9 + r() * (CLIFF.length - 10.01), a0 = CLIFF[Math.floor(q)], a1 = CLIFF[Math.floor(q) + 1], f = q % 1;
          var u = a0[0] + (a1[0] - a0[0]) * f + 0.006 + r() * 0.012, v = a0[1] + (a1[1] - a0[1]) * f;
          if (v < 0.6) continue;
          x.fillStyle = 'rgba(214, 226, 252, ' + (0.08 + 0.26 * r() * r()).toFixed(3) + ')';
          x.beginPath(); x.ellipse(X(u + r() * 0.01) / s.scale, SH * v / s.scale, 1 + r() * r() * 7, 0.5 + r() * 1.2, 0, 0, Math.PI * 2); x.fill();
        }
        return c;
      }) : null;

      function at(c, t) {
        var span = W + c.img.width;
        return ((c.x0 + t * c.v + c.img.width) % span + span) % span - c.img.width;
      }

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(sky, 0, 0);
          ctx.drawImage(stars.still, 0, 0);
          ctx.globalAlpha = 0.85 + 0.15 * K.noise1(t * 0.13, 2); ctx.drawImage(stars.mid, 0, 0);
          ctx.globalAlpha = 1;

          // The moon climbs a little over the break, from amber near the sea to white.
          var climb = K.smooth(p), my = H * (0.31 - 0.1 * climb), warm = 1 - K.smooth(p * 1.4);
          K.light(ctx, moonGlow, moonX, my, H * 0.75, 0.22 + 0.1 * climb);
          K.light(ctx, moonWarmGlow, moonX, my, H * 0.5, 0.18 * warm);
          if (moonCool) {
            var md = moonR * 2;
            ctx.globalAlpha = 1; ctx.drawImage(moonCool, moonX - md / 2 * 1.0, my - md / 2, md, md);
            ctx.globalAlpha = warm; ctx.drawImage(moonWarm, moonX - md / 2, my - md / 2, md, md);
            ctx.globalAlpha = 1;
          }
          for (var i = 0; i < clouds.length; i++) {
            ctx.drawImage(clouds[i].img, at(clouds[i], t), clouds[i].y);
          }
          // a wide soft halo over the clouds too, so one passing in front of the moon glows
          K.light(ctx, veilGlow, moonX, my, H * 0.3, 0.3);
          var pf = s.par(0.2);
          ctx.drawImage(far, pf.x, pf.y);

          ctx.drawImage(sea, 0, 0);
          // the clouds again, dim and upside down in the calm sea
          ctx.globalAlpha = 0.18;
          for (var j = 0; j < 1; j++) {
            var c = clouds[j], ry = horizon + (horizon - c.y - c.img.height) * 0.5;
            ctx.save(); ctx.translate(0, ry + c.img.height * 0.5); ctx.scale(1, -0.5);
            ctx.drawImage(c.img, at(c, t), 0); ctx.restore();
          }
          ctx.globalCompositeOperation = 'lighter';
          if (paths) {
            var sh = 0.5 + 0.5 * K.noise1(t * 0.3, 5), pa = 0.55 + 0.45 * climb;
            ctx.globalAlpha = pa * sh; ctx.drawImage(paths[0], K.noise1(t * 0.11, 1) * 1.2, 0);
            ctx.globalAlpha = pa * (1 - sh); ctx.drawImage(paths[1], K.noise1(t * 0.09, 2) * 1.2, 0);
          } else {
            // the edge of the moon's light on the water nearest the other screen
            K.light(ctx, moonGlow, inner < 0 ? 0 : W, horizon + H * 0.1, H * 0.5, 0.12, H * 0.2);
          }
          var rw = ripples.width * 2, rh = H - horizon, r1 = (t * 0.33) % rw;
          ctx.globalAlpha = 0.75;
          ctx.drawImage(ripples, r1, horizon, rw, rh); ctx.drawImage(ripples, r1 - rw, horizon, rw, rh);
          if (surf) {
            // the swell breaking on the rocks: slow, uneven
            var sw = 0.5 + 0.5 * K.flicker(t * 0.09, 6);
            ctx.globalAlpha = 0.35 + 0.65 * sw; ctx.drawImage(surf[0], 0, 0);
            ctx.globalAlpha = 0.35 + 0.65 * (1 - sw); ctx.drawImage(surf[1], 0, 0);
          }
          ctx.globalCompositeOperation = 'source-over';

          // Sea mist gathers through the break - the beam shows more and more in it.
          var haze = 0.3 + 0.7 * K.smooth((p - 0.1) / 0.7);
          var mx = ((t * 0.3 / s.scale) % (W * 0.2)) - W * 0.2;
          ctx.globalAlpha = 0.35 + 0.65 * haze;
          ctx.drawImage(mist, mx, horizon - H * 0.075);
          ctx.globalAlpha = 1;
          ctx.fillStyle = K.linear(ctx, 0, H * 0.25, 0, horizon + H * 0.05, [[0, 'rgba(70, 90, 130, 0)'],
            [1, 'rgba(70, 90, 130, ' + (0.16 * haze).toFixed(3) + ')']]);
          ctx.fillRect(0, H * 0.25, W, horizon + H * 0.05 - H * 0.25);

          // The beam turns once every ROT seconds. Seen side-on it is a long cone through
          // the haze; turned towards us it shortens and the lantern brightens a little.
          var th = (t / ROT + 0.3) * Math.PI * 2, sx = Math.sin(th), toward = Math.cos(th);
          ctx.globalCompositeOperation = 'lighter';
          if (main) {
            var ba = (0.4 + 0.6 * haze) * (0.3 + 0.7 * Math.abs(sx));
            ctx.globalAlpha = Math.min(1, ba);
            ctx.save(); ctx.translate(lampX / s.scale, lampY / s.scale);
            ctx.scale(sx, 1 + 0.7 * Math.max(0, toward));
            ctx.drawImage(cone, 0, -LH / 2, LW, LH);
            ctx.restore();
            lamp.set(lampX - lampSize / 2, lampY - lampSize / 2, 0, 0.75 + 0.25 * K.smooth(Math.max(0, toward)));
          } else {
            // only its far end reaches this screen, when it points this way
            var toUs = Math.max(0, sx * -inner);
            if (toUs > 0.05) {
              ctx.globalAlpha = 0.5 * toUs * (0.3 + 0.7 * haze);
              ctx.save(); ctx.translate(inner < 0 ? -W * 0.45 : W * 1.45, H * 0.238);
              ctx.scale(-inner * 1.3, 1.6); ctx.drawImage(cone, 0, -LH / 2, LW, LH); ctx.restore();
            }
          }
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        },

        front: function (fx) { if (main) drawCliff(fx); else drawSideRocks(fx); },
      };

      // The side screen's foreground: a low shelf of rock at its outer edge.
      function drawSideRocks(fx) {
        var rock = K.canvas(SW, SH), rx = rock.getContext('2d');
        rx.fillStyle = K.linear(rx, 0, SH * 0.78, 0, SH, [[0, '#0d1626'], [1, '#04070f']]);
        var p = new Path2D(); p.moveTo(X(0), SH);
        [[0, 0.8], [0.06, 0.79], [0.1, 0.81], [0.16, 0.86], [0.2, 0.9], [0.23, 0.96], [0.24, 1]].forEach(function (q) {
          p.lineTo(X(q[0]), SH * q[1]);
        });
        p.closePath(); rx.fill(p);
        K.rim(rock, -outer, -0.8, 2, '96, 124, 170', 0.45, 1);
        fx.drawImage(rock, 0, 0);
      }
    },

    lofi: {
      key: 'C#', mode: 'minor', bpm: 62, swing: 0.57,
      progs: ['i9 bVImaj7 iv9 V7b9', 'i9 bIIImaj7 bVImaj7 V9sus', 'iv9 bVII9 bIIImaj7 bVImaj7'],
      keys: { inst: 'piano', style: 'hold', range: [49, 72], size: 3, ep: true, level: 1 },
      lead: { inst: 'guitar', range: [59, 79], level: 0.64, motif: '0.12.10 |' },
      reply: { inst: 'piano', kind: 'descend', range: [60, 76], level: 0.55 },
      pad: { inst: 'cello', range: [37, 52], fifth: true, level: 1.22, in: ['release', 'outro'] },
      bass: { style: 'lofi', level: 0.7 },
      drums: { style: 'half', snare: 'snare', hat: 'hat', level: 0.72 },
      fx: { tone: 4400, crackle: 0.3, hiss: 0.35, wow: 0.9, room: 0.5, verb: 1.3, echo: 0.75, duck: 0.08 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 4, 2.4, out, 0.22);
      // the sea: a slow rolling surf, longer and deeper than a beach's
      var washG = K.gain(ac, 0.06, out);
      K.loop(ac, K.noise(ac, 'brown', 8), K.filter(ac, 'lowpass', 400, 0.4, washG), t0);
      var surf = K.filter(ac, 'lowpass', 1000, 0.3, K.gain(ac, 1, out));
      var surfBuf = K.noise(ac, 'pink', 9);
      var nextWave = t0 + 1, nextBuoy = t0 + 6;
      var buoy = K.filter(ac, 'lowpass', 1600, 0.3, out); buoy.connect(K.gain(ac, 0.8, rv));

      return function schedule(until) {
        while (nextWave < until) {
          var src = ac.createBufferSource(); src.buffer = surfBuf;
          var g = ac.createGain(); var w = nextWave;
          g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(0.09, w + 4.5);
          g.gain.setTargetAtTime(0.0001, w + 4.7, 2.2);
          src.connect(g); g.connect(K.panner(ac, 0.3, surf)); src.start(w, Math.random() * 3); src.stop(w + 13);
          nextWave += 11 + Math.random() * 2;
        }
        while (nextBuoy < until) { // the bell buoy, far out, rocked by the swell
          var bt = nextBuoy;
          var bp = K.panner(ac, -0.5, buoy);
          K.play(ac, K.strike(ac, K.hz(68), K.INSTR.bell, 6, 3), bp, bt, 0.022);
          if (Math.random() < 0.5) K.play(ac, K.strike(ac, K.hz(68), K.INSTR.bell, 6, 3), bp, bt + 1.6, 0.012);
          nextBuoy = bt + 9 + Math.random() * 8;
        }
      };
    },
  });
})();

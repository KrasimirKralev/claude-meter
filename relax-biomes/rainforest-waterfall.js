// Rainforest waterfall - a tall fall pouring down a mossy cliff into a green
// pool, mist rolling up from its foot, rings spreading on the water, jungle on
// both sides, big leaves in front; the morning mist drifts and slowly lifts.
// Music: lo-fi in D dorian (74 bpm): nylon guitar picking a min9 / 9 vamp, a kalimba
// figure leaning on B natural, upright bass, kick, rim and hats; the falls, birds, drips.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // An elephant-ear leaf: a big drooping heart on a long stalk, veins a shade lighter.
  function elephantEar(fx, x, y, size, ang, col, vein) {
    fx.save(); fx.translate(x, y); fx.rotate(ang);
    fx.strokeStyle = col; fx.lineWidth = size * 0.03; fx.lineCap = 'round';
    fx.beginPath(); fx.moveTo(0, size * 0.9); fx.quadraticCurveTo(-size * 0.06, size * 0.4, 0, 0); fx.stroke();
    var tipY = -size * 0.95;
    fx.fillStyle = col;
    fx.beginPath();
    fx.moveTo(0, -size * 0.05);
    fx.bezierCurveTo(-size * 0.15, size * 0.06, -size * 0.55, size * 0.02, -size * 0.52, -size * 0.3);
    fx.bezierCurveTo(-size * 0.48, -size * 0.62, -size * 0.18, -size * 0.8, 0, tipY);
    fx.bezierCurveTo(size * 0.18, -size * 0.8, size * 0.48, -size * 0.62, size * 0.52, -size * 0.3);
    fx.bezierCurveTo(size * 0.55, size * 0.02, size * 0.15, size * 0.06, 0, -size * 0.05);
    fx.fill();
    fx.strokeStyle = vein; fx.lineWidth = size * 0.008;
    fx.beginPath(); fx.moveTo(0, -size * 0.05); fx.lineTo(0, tipY * 0.96); fx.stroke();
    for (var k = 1; k < 7; k++) {
      var vy = -size * 0.08 - k * size * 0.12;
      for (var side = -1; side <= 1; side += 2) {
        fx.beginPath(); fx.moveTo(0, vy);
        fx.quadraticCurveTo(side * size * 0.2, vy - size * 0.02, side * size * (0.42 - k * 0.045), vy - size * 0.1);
        fx.stroke();
      }
    }
    fx.restore();
  }
  // Long leaves drooping from a stem that curves in from the top edge (a heliconia
  // or a young palm reaching into the clearing).
  function droop(fx, x, y, size, dir, col, rnd) {
    fx.fillStyle = col; fx.strokeStyle = col; fx.lineCap = 'round'; fx.lineWidth = size * 0.014;
    var sx = x, sy = y - size * 0.3, cx = x + dir * size * 0.32, cy = y + size * 0.05, ex = x + dir * size * 0.42, ey = y + size * 0.55;
    fx.beginPath(); fx.moveTo(sx, sy); fx.quadraticCurveTo(cx, cy, ex, ey); fx.stroke();
    for (var i = 0; i < 11; i++) {
      var q = 0.3 + i * 0.065 + rnd() * 0.03;
      var px = (1 - q) * (1 - q) * sx + 2 * (1 - q) * q * cx + q * q * ex;
      var py = (1 - q) * (1 - q) * sy + 2 * (1 - q) * q * cy + q * q * ey;
      var L = size * (0.2 + 0.18 * Math.sin(Math.PI * q)) * (0.75 + 0.4 * rnd());
      var a = Math.PI / 2 + (i % 2 ? 1 : -1) * (0.12 + 0.3 * rnd()) + dir * 0.15;
      var tx = px + Math.cos(a) * L, ty = py + Math.sin(a) * L, w = L * (0.1 + 0.05 * rnd());
      var nx = -Math.sin(a), ny = Math.cos(a);
      fx.beginPath(); fx.moveTo(px, py);
      fx.quadraticCurveTo(px + Math.cos(a) * L * 0.45 + nx * w, py + Math.sin(a) * L * 0.45 + ny * w, tx, ty);
      fx.quadraticCurveTo(px + Math.cos(a) * L * 0.45 - nx * w, py + Math.sin(a) * L * 0.45 - ny * w, px, py);
      fx.fill();
    }
  }
  // One irregular mass of rainforest foliage, painted pixel by pixel inside a box (x0, y0,
  // w, h in canvas px). inside(x, y) is a smooth shape (> 0.5 inside, rising inwards); a
  // leaf-scale noise is added before the cut, so the edge comes out ragged, with small gaps
  // near it and none inside, and with no outline. The fill is flat apart from a gentle
  // darkening towards the bottom and soft lit patches near the top - never a rim.
  function mass(x0, y0, w, h, inside, col, seed, leafScale, mottle) {
    var c = K.rgb(col), ls = leafScale || 26, mo = mottle === undefined ? 1 : mottle;
    return { x: x0, y: y0, img: K.field(Math.ceil(w), Math.ceil(h), function (u, v, out) {
      var x = x0 + u * w, y = y0 + v * h;
      var m = inside(x, y);
      if (m < 0.1) return null;
      var rag = 0.6 * K.fbm2(x / ls, y / (ls * 0.8), 3, seed) + 0.2 * K.noise2(x / (ls * 0.3), y / (ls * 0.28), seed + 3);
      var a = K.smooth((m + rag - 0.5) / 0.06);
      if (a <= 0.01) return null;
      // inside: soft lighter clumps where the canopy bulges towards the light, darker below them
      var cl = K.fbm2(x / (ls * 1.7), y / (ls * 1.3), 3, seed + 11);
      var k = 1 - 0.32 * v * mo + (0.15 * K.smooth((cl - 0.02) / 0.14) * (1 - 0.5 * v) - 0.08 * K.smooth((-cl - 0.1) / 0.14)) * mo;
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; out[3] = a;
      return out;
    }) };
  }

  RelaxBiomes.register({
    id: 'rainforest-waterfall',
    name: 'Rainforest waterfall',
    about: 'A waterfall pouring into a green pool, morning mist drifting and slowly lifting off the jungle, soft light shafts, rings on the water, big leaves. Lo-fi in D dorian: nylon guitar, kalimba, upright bass, kick, rim and hats, the roar of the falls, birds.',
    ink: '240, 255, 246',
    shade: '4, 22, 16',
    vignette: 0.32,
    legible: 0.35,
    scale: 3,
    grade: { shadow: '8, 24, 20', light: '252, 250, 236' },
    level: 1.176, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.796, // the falls about 11 LU under the music (measured)

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var SW = s.SW, SH = s.SH;
      var poolY = H * 0.68;
      // The fall stands on the main screen, on its outer half, so the breathing circle and
      // the open pool are clear; the light comes from the inner side, over the canopy.
      var fallX = W * (0.5 + 0.21 * outer), lip = H * 0.1;
      var haze = '#b9d4c2', deep = '#1d4632';

      // Morning sky and mist behind everything, then two depths of far jungle hills.
      var bg = s.layer(), bx = bg.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, 0, poolY, [[0, '#e2ecdc'], [0.45, '#c2d8c4'], [1, '#9fc0a8']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'lighter';
      bx.fillStyle = K.radial(bx, W * (0.5 + 0.5 * inner), 0, W * 0.8, [[0, 'rgba(255, 240, 200, 0.42)'], [1, 'rgba(240, 236, 210, 0)']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'source-over';
      // the three greens: near, middle and hazy
      var NEAR = '#173e32', MIDG = '#315d46', HAZY = '#76967a';
      // two bands of far jungle hills, hazed into the morning
      [[0.4, 0.85, 3], [0.5, 0.6, 9]].forEach(function (L) {
        var base = H * L[0];
        var col = K.mixRgb(HAZY, haze, L[1]);
        var m = mass(0, base - H * 0.14, W, poolY + 2 - (base - H * 0.14), function (x, y) {
          var top = base - H * 0.06 * (0.6 + 0.4 * K.noise1(x / W * 3, L[2])) - H * 0.025 * K.noise1(x / W * 9, L[2] + 1);
          return 0.5 + (y - top) / (H * 0.035);
        }, col, L[2] + 20, 26, 0.45);
        bx.drawImage(m.img, m.x, m.y);
      });

      // The hillside the fall comes over: it rises from the jungle on the outer side; its
      // rock is bare only where the water has cut it - a dark wet recess behind the fall and
      // a few broken diagonal strata - and its top is lost in the canopy.
      var xo = outer < 0 ? 0 : W; // the outer edge
      function hillTop(x) {
        var d = (x - xo) * inner / W, fd = Math.abs(fallX - xo) / W;
        return H * (0.03 + 0.6 * K.smooth((d - fd - 0.04) / 0.24)) + H * 0.03 * K.noise1(x / W * 7, 41);
      }
      function rockL(y) { var v = (y - lip) / (poolY - lip); return fallX - outer * W * (0.09 + 0.12 * v) + W * (0.028 * K.noise1(v * 3.5, 23) + 0.006 * K.noise1(v * 37, 25)) * -outer; }
      function rockR(y) { var v = (y - lip) / (poolY - lip); return fallX + outer * W * (0.11 + 0.15 * v) + W * (0.028 * K.noise1(v * 3.5, 24) + 0.006 * K.noise1(v * 41, 26)) * outer; }
      function rockTop(x) { return lip - H * 0.035 + H * 0.025 * K.noise1(x / W * 11, 21) + H * 0.05 * Math.pow(Math.abs(x - fallX) / (W * 0.16), 2); }
      // 0 outside the bare rock, 1 well inside; soft over a few px
      function rockIn(x, y) {
        var a = Math.min(rockL(y), rockR(y)), b = Math.max(rockL(y), rockR(y));
        return K.smooth(Math.min(x - a, b - x, (y - rockTop(x)) * 0.6) / (W * 0.006));
      }
      function inRock(x, y) { return rockIn(x, y) > 0.5; }
      if (main) {
        var hx0 = outer < 0 ? 0 : fallX - W * 0.45, hx1 = outer < 0 ? fallX + W * 0.45 : W;
        var hw = Math.ceil(hx1 - hx0), hh = Math.ceil(poolY + 2);
        // the rock
        var rock = K.field(hw, hh, function (u, v, out) {
          var x = hx0 + u * (hx1 - hx0), y = v * hh;
          var ra = rockIn(x, y);
          if (ra <= 0.02 || y < hillTop(x)) return null;
          var n = K.fbm2(u * 9, v * 7, 4, 31);
          // three planes with soft, uneven borders: the shaded side, the wet recess, the lit face
          var d = (x - fallX) * inner / (W * 0.16) + 0.2 * K.noise2(u * 6, v * 4, 12);
          var rec = K.smooth((0.3 - Math.abs(d + 0.05)) / 0.2), litF = K.smooth((d - 0.2) / 0.25) * (1 - rec);
          var c = [62, 78, 70];
          c = [c[0] + (26 - c[0]) * rec, c[1] + (38 - c[1]) * rec, c[2] + (36 - c[2]) * rec];
          c = [c[0] + (96 - c[0]) * litF, c[1] + (112 - c[1]) * litF, c[2] + (98 - c[2]) * litF];
          // a few broken diagonal strata rising towards the outer side
          var sl = v * 7 + u * 3.5 * inner + n * 1.1;
          var seg = K.smooth((K.noise2(u * 5, Math.floor(sl) * 3.1, 8) - 0.15) / 0.2);
          var band = sl - Math.floor(sl);
          var ledge = seg * K.smooth((0.18 - band) / 0.1), lipL = seg * K.smooth((band - 0.18) / 0.05) * K.smooth((0.3 - band) / 0.06);
          var wet = Math.max(0, 1 - Math.abs(x - fallX) / (W * 0.085)) * (0.7 + 0.3 * K.noise2(u * 50, v * 2, 9)) *
            K.smooth((y - lip) / (H * 0.05));
          var moss = ledge > 0.6 && K.noise2(u * 18, v * 30, 5) > 0.45;
          // the lip the water pours over: lit rock and moss, never a dark opening
          var lipLit = K.smooth(1 - (y - rockTop(x)) / (H * 0.035)) * K.smooth(1 - Math.abs(x - fallX) / (W * 0.12));
          var k = 0.92 + 0.26 * n - 0.24 * ledge + 0.16 * lipL * (1 - rec) - 0.4 * wet + 0.35 * lipLit;
          if (moss || lipLit > 0.55 && K.noise2(u * 30, v * 20, 15) > 0) c = [74, 112, 70];
          out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; out[3] = ra;
          return out;
        });
        // the hillside: one middle-green mass everywhere the rock is not bare, and a darker,
        // nearer one hanging over the rock's top edge
        var hill = mass(hx0, 0, hw, hh, function (x, y) {
          var m = 0.5 + (y - hillTop(x)) / (H * 0.055), r = rockIn(x, y);
          return r > 0 ? Math.min(m, 2 - 3 * r) : m;
        }, MIDG, 61, 20);
        var over = mass(hx0, 0, hw, lip + H * 0.12, function (x, y) {
          var a = Math.min(rockL(lip), rockR(lip)) - W * 0.02, b = Math.max(rockL(lip), rockR(lip)) + W * 0.02;
          if (x < a || x > b) return 0;
          var top = rockTop(x) - H * 0.01;
          var hang = top + H * (0.008 + 0.035 * Math.pow(0.5 + 0.5 * K.noise1(x / W * 17, 71), 2));
          return Math.min(0.5 + (y - top) / (H * 0.02), 0.5 + (hang - y) / (H * 0.02)) * K.smooth(Math.min(x - a, b - x) / (W * 0.03));
        }, K.mixRgb(MIDG, '#7ea585', 0.25), 67, 10, 0.6);
        bx.drawImage(rock, hx0, 0);
        bx.drawImage(hill.img, hill.x, hill.y);
        bx.drawImage(over.img, over.x, over.y);
      } else {
        // the side screen: a far cascade on a distant hill, a soft broken ribbon with mist at its foot
        var cx1 = W * (0.5 + 0.25 * outer), ribbonTop = H * 0.27, ribbonBot = H * 0.43;
        var rib = K.field(8, Math.ceil(ribbonBot - ribbonTop), function (u, v, out) {
          var a = Math.pow(Math.sin(Math.PI * u), 2) * (0.2 + 0.3 * K.smooth((K.noise2(u, v * 9, 4) + 0.2) / 0.5)) * (1 - 0.4 * v);
          out[0] = 228; out[1] = 242; out[2] = 234; out[3] = a; return out;
        });
        bx.drawImage(rib, cx1 - 5, ribbonTop, 10, ribbonBot - ribbonTop);
        bx.drawImage(K.wisps({ w: Math.ceil(W * 0.08), h: Math.ceil(H * 0.05), rgb: '230, 242, 236', alpha: 0.45, seed: 33, stretch: 2 }),
          cx1 - W * 0.04, ribbonBot - H * 0.03);
      }
      // the jungle framing the pool: a hazier mass behind a near, dark one on each wall, their
      // edges ragged; leaf detail only along the nearest edge
      function wall(sd, reach, top, seed, col, ls) {
        var w0 = W * (reach + 0.1), x0 = sd < 0 ? 0 : W - w0;
        return mass(x0, top - H * 0.08, w0, poolY + H * 0.1 - top, function (x, y) {
          var d = sd < 0 ? x / W : (W - x) / W; // distance from the screen edge
          var k = K.clamp((y - top) / (poolY - top), 0, 1);
          var r = reach * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.25 + 0.12))) *
            (1 + 0.3 * K.noise1(k * 4, seed) + 0.15 * K.noise1(k * 11, seed + 1));
          return 0.5 + (r - d) / 0.05 - Math.max(0, (top - y) / (H * 0.03));
        }, col, seed, ls);
      }
      // the walls on the inner edge meet across the bezel: kept mid-distance, small and hazy,
      // so they never outweigh the fall
      var walls = [
        wall(inner, main ? 0.13 : 0.09, H * 0.16, 7, K.mixRgb(HAZY, haze, 0.35), 30),
        wall(outer, main ? 0.07 : 0.22, H * 0.06, 4, K.mixRgb(HAZY, '#4a7a5e', 0.35), 30),
        wall(inner, main ? 0.075 : 0.045, H * 0.36, 13, K.mixRgb(MIDG, haze, 0.3), 20),
      ];
      if (!main) walls.push(wall(outer, 0.11, H * 0.2, 12, MIDG, 22));
      walls.forEach(function (m) { bx.drawImage(m.img, m.x, m.y); });
      // a few long leaves sticking out of the nearest wall's edge
      bx.fillStyle = K.mix(MIDG, haze, 0.3);
      for (var lf = 0; lf < (main ? 10 : 6); lf++) {
        var ly = H * (0.4 + 0.26 * rnd()), k2 = (ly - H * 0.36) / (poolY - H * 0.36);
        var lr = (main ? 0.075 : 0.045) * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, k2 * 1.25 + 0.12)));
        var lx = inner > 0 ? W - lr * W : lr * W;
        var la = (inner > 0 ? Math.PI : 0) + (rnd() - 0.5) * 1.2 + 0.3, L = H * (0.02 + 0.02 * rnd());
        bx.beginPath();
        bx.moveTo(lx, ly);
        bx.quadraticCurveTo(lx + Math.cos(la) * L * 0.5 - Math.sin(la) * L * 0.18, ly + Math.sin(la) * L * 0.5 + Math.cos(la) * L * 0.18,
          lx + Math.cos(la) * L, ly + Math.sin(la) * L + L * 0.15);
        bx.quadraticCurveTo(lx + Math.cos(la) * L * 0.5 + Math.sin(la) * L * 0.18, ly + Math.sin(la) * L * 0.5 - Math.cos(la) * L * 0.18, lx, ly);
        bx.fill();
      }
      // a low bank of plants along the far shore breaks the waterline
      var bank = mass(0, poolY - H * 0.06, W, H * 0.07, function (x, y) {
        var top = poolY - H * (0.014 + 0.035 * Math.pow(Math.abs(K.noise1(x / W * 5, 15)), 1.3));
        return 0.5 + (y - top) / (H * 0.016);
      }, K.mixRgb(MIDG, haze, 0.35), 15, 14);
      bx.drawImage(bank.img, bank.x, bank.y);

      // The pool: the cliff and the fall mirrored, then its depth.
      var above = s.layer(W, Math.ceil(poolY) + 2), ax = above.getContext('2d');
      ax.drawImage(bg, 0, 0);
      var pool = s.layer(), px = pool.getContext('2d');
      px.fillStyle = K.linear(px, 0, poolY, 0, H, [[0, 'rgba(30, 80, 72, 0.35)'], [0.35, 'rgba(16, 52, 46, 0.72)'], [1, 'rgba(6, 26, 24, 0.94)']]);
      px.fillRect(0, poolY, W, H - poolY);
      // rocks and a low bank at the pool's edges
      px.fillStyle = '#10261e';
      for (var rk = 0; rk < 7; rk++) {
        var ru = rk < 4 ? (outer < 0 ? rnd() * 0.25 : 1 - rnd() * 0.25) : (inner < 0 ? rnd() * 0.2 : 1 - rnd() * 0.2);
        var rx = ru * W, ry = poolY + H * (0.01 + 0.07 * rnd()), rw = H * (0.02 + 0.035 * rnd());
        px.beginPath(); px.ellipse(rx, ry, rw * 1.4, rw * 0.6, 0, Math.PI, 0); px.fill();
      }

      // The fall: narrow streams at the lip that widen, soften and lose themselves in mist.
      var fw = Math.ceil(W * 0.2), fh = Math.ceil(poolY - lip + H * 0.02), fx0 = fallX - fw / 2;
      // [offset from the middle, width, drift]: uneven widths and gaps; two pairs drift into
      // each other and merge on the way down; all widen towards the foot
      var streams = [[-0.32, 0.025, 0.35], [-0.2, 0.09, 0.05], [-0.05, 0.02, 1.1], [0.05, 0.12, -0.1], [0.21, 0.03, -1.2],
        [0.3, 0.055, -0.2]];
      function density(u, v) {
        var d = 0;
        for (var i = 0; i < streams.length; i++) {
          var c = 0.5 + streams[i][0] * 0.75 + streams[i][2] * 0.12 * Math.pow(v, 1.4);
          var w = streams[i][1] * 0.75 * (0.5 + 3.2 * Math.pow(v, 1.3));
          d += K.smooth(1 - Math.abs(u - c) / w) * (0.75 + 0.25 * K.noise2(i * 3.1, v * 4, 6));
        }
        var veil = 0.18 * K.smooth((v - 0.25) / 0.5) * K.smooth(1 - Math.abs(u - 0.5) / 0.42);
        return Math.min(1, d + veil) * (0.95 - 0.5 * v) * (0.85 + 0.15 * K.noise2(u * 40, v * 3, 2));
      }
      var fallMask = K.field(fw, fh, function (u, v, out) {
        var d = density(u, v) * (1 - K.smooth((v - 0.8) / 0.2) * 0.75);
        if (d <= 0.01) return null;
        out[0] = 211; out[1] = 232; out[2] = 221; out[3] = d * 0.82; return out;
      });
      fallMask = K.blurred(fallMask, 0.8);
      var streaks = K.canvas(fw, fh), sx = streaks.getContext('2d');
      for (var st = 0; st < 120; st++) {
        var su = rnd() * fw, sl = fh * (0.08 + 0.3 * rnd()), sy0 = rnd() * fh, sa = 0.12 + 0.35 * rnd();
        sx.fillStyle = 'rgba(245, 252, 248, ' + sa.toFixed(2) + ')';
        var sw = rnd() < 0.25 ? 1.4 : 0.8;
        sx.fillRect(su, sy0, sw, sl); sx.fillRect(su, sy0 - fh, sw, sl);
      }
      var flow = K.canvas(fw, fh), flx = flow.getContext('2d');
      var spray = K.wisps({ w: Math.ceil(W * 0.42), h: Math.ceil(H * 0.16), rgb: '236, 248, 242', alpha: 0.75, cover: 0.62, seed: 5, stretch: 3 });
      var footMist = K.wisps({ w: Math.ceil(W * 0.6), h: Math.ceil(H * 0.1), rgb: '228, 242, 234', alpha: 0.4, cover: 0.55, seed: 8, stretch: 6 });
      var morning1 = K.wisps({ w: W, h: Math.ceil(H * 0.3), rgb: '232, 242, 234', alpha: 0.55, cover: 0.6, seed: 14, stretch: 5 });
      var morning = K.canvas(W * 2, morning1.height), mo2 = morning.getContext('2d');
      mo2.drawImage(morning1, 0, 0); mo2.drawImage(morning1, W, 0);
      var foot = K.bloom('230, 246, 238', 1.8);
      // two soft bands of mist that hide parts of the fall as they drift across it
      var veils = [0, 1].map(function (i) {
        return K.wisps({ w: Math.ceil(W * 0.32), h: Math.ceil(H * 0.07), rgb: '226, 240, 232', alpha: 0.55, cover: 0.55, seed: 41 + i * 6, stretch: 4 });
      });
      if (main) ax.drawImage(fallMask, fx0, lip);
      var mirror = K.mirror(above, poolY);

      // Shafts of morning light from the inner side, over the canopy, down onto the pool.
      var rays = K.rays(W, H, { x: W * (0.5 + 0.55 * inner), y: -H * 0.3, angle: -0.42 * inner, spread: 0.22, count: 4, length: H * 1.6,
        width: W * 0.07, rgb: '255, 226, 164', alpha: main ? 0.55 : 0.34, seed: 6, patchy: 0.5 });

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bg, 0, 0);
          // the pool
          ctx.fillStyle = '#173d36'; ctx.fillRect(0, poolY, W, H - poolY);
          K.reflect(ctx, mirror, poolY, H, W, t, { bands: 10, amp: 2, speed: 0.3, squash: 1.1, alpha: 0.5 });
          ctx.drawImage(pool, 0, 0);
          if (main) {
            // the body of the water, then streaks sliding down it at two speeds (35-65 px/s)
            ctx.drawImage(fallMask, fx0, lip - H * 0.005);
            flx.globalCompositeOperation = 'copy'; flx.globalAlpha = 1; flx.drawImage(fallMask, 0, 0);
            flx.globalCompositeOperation = 'source-atop';
            var o1 = (t * 12) % fh, o2 = (t * 21) % fh;
            flx.globalAlpha = 0.55; flx.drawImage(streaks, 0, o1); flx.drawImage(streaks, 0, o1 - fh);
            flx.globalAlpha = 0.35; flx.drawImage(streaks, 2, o2); flx.drawImage(streaks, 2, o2 - fh);
            ctx.globalAlpha = 0.4; ctx.drawImage(flow, fx0, lip - H * 0.005);
            K.light(ctx, foot, fallX, lip + H * 0.004, W * 0.06, 0.3, H * 0.014);
            // two mist bands drifting across the fall, 1-2 px a second
            for (var vi = 0; vi < 2; vi++) {
              var vy = lip + (poolY - lip) * (vi ? 0.62 : 0.33), vxo = K.noise1(t / (37 + vi * 11), 30 + vi) * W * 0.05;
              ctx.globalAlpha = 0.75;
              ctx.drawImage(veils[vi], fallX - veils[vi].width / 2 + vxo, vy - veils[vi].height / 2);
            }
            // the foot: a soft glow, spray drifting 1-3 px a second, three faint rings
            K.light(ctx, foot, fallX, poolY, W * 0.12, 0.25, H * 0.06);
            for (var r = 0; r < 2; r++) {
              var ph = (t * 0.07 + r / 2) % 1;
              ctx.strokeStyle = 'rgba(220, 245, 238, ' + (0.18 * (1 - ph)).toFixed(3) + ')'; ctx.lineWidth = 0.8;
              ctx.beginPath(); ctx.ellipse(fallX, poolY + H * 0.025, W * (0.05 + ph * 0.12), H * (0.008 + ph * 0.025), 0, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.globalAlpha = 0.9;
            ctx.drawImage(spray, fallX - spray.width / 2 + K.noise1(t / 30, 2) * W * 0.01, poolY - spray.height * 0.75);
          }
          ctx.globalAlpha = 0.85;
          ctx.drawImage(footMist, (main ? fallX : W * 0.5) - footMist.width / 2 + Math.sin(t / 47) * W * 0.02, poolY - footMist.height * 0.55);
          // the morning mist over the jungle drifts and slowly lifts a little
          var lift = K.smooth(p);
          ctx.globalAlpha = 0.85 * (1 - 0.35 * lift);
          ctx.drawImage(morning, ((t * 0.3) % W) - W, H * (0.32 - 0.06 * lift));
          // the shafts stay as they are, only breathing slightly with the haze (no lighting cycle)
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.6 * (0.85 + 0.15 * K.noise1(t / 25, 4));
          ctx.drawImage(rays, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        },

        // Three framing groups only: big elephant ears low on the outer side, a torn banana
        // leaf hanging in from the inner top corner, small ferns low on the inner side.
        front: function (fx) {
          var r = K.seeded(7070 + (main ? 0 : 3));
          var c = K.canvas(SW, SH), x = c.getContext('2d');
          var ox = outer < 0 ? 0 : SW, d = outer < 0 ? 1 : -1;
          elephantEar(x, ox + d * SW * 0.05, SH * 1.05, SH * 0.48, -0.5 * d, '#0e2a1c', 'rgba(90, 140, 100, 0.32)');
          elephantEar(x, ox + d * SW * 0.15, SH * 1.08, SH * 0.32, 0.25 * d, '#133322', 'rgba(90, 140, 100, 0.28)');
          var ix = inner < 0 ? 0 : SW, e = inner < 0 ? 1 : -1;
          if (main) {
            droop(x, ix - e * SW * 0.01, SH * 0.0, SH * 0.3, e, '#0b2217', r);
            droop(x, ix - e * SW * 0.005, SH * 0.08, SH * 0.2, e, '#12301f', r);
          }
          x.fillStyle = '#10301f';
          for (var f = 0; f < 3; f++) {
            var bx0 = ix + e * SW * (0.06 + 0.06 * f);
            for (var l = 0; l < 7; l++) {
              var a = -Math.PI / 2 + (l - 3) * 0.32 + (r() - 0.5) * 0.2, L = SH * (0.08 + 0.06 * r());
              x.beginPath(); x.ellipse(bx0 + Math.cos(a) * L * 0.5, SH + Math.sin(a) * L * 0.5, L * 0.5, L * 0.1, a, 0, Math.PI * 2); x.fill();
            }
          }
          fx.filter = 'blur(1.4px)';
          fx.drawImage(c, 0, 0);
          fx.filter = 'none';
        },
      };
    },

    lofi: {
      key: 'D', mode: 'dorian', bpm: 74, swing: 0.56,
      progs: ['i9 IV9 i9 IV9', 'i9 IV13 bVIImaj7 i9', 'bIIImaj7 IV9 v7 i9'],
      keys: { inst: 'guitar', style: 'arp', range: [52, 76], level: 0.9 },
      lead: { inst: 'kalimba', range: [62, 83], level: 0.29, motif: '2.2.5 4.2.6 6.6.5 | 0.4.6 6.10.3' },
      reply: { inst: 'guitar', shift: 0, level: 0.44 },
      bass: { style: 'lofi', level: 0.44 },
      drums: { style: 'boom', snare: 'rim', hat: 'hat', level: 0.43 },
      fx: { tone: 6000, crackle: 0.25, hiss: 0.3, wow: 0.8, room: 0.4, verb: 1.0, echo: 0.5, duck: 0.1 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 3, 2.6, out, 0.3);
      // the falls: a steady, rounded roar
      var roar = K.gain(ac, 0.13, out);
      var rh = K.filter(ac, 'highpass', 110, 0.5); var rl = K.filter(ac, 'lowpass', 1500, 0.4, roar); rh.connect(rl);
      K.loop(ac, K.noise(ac, 'pink', 9), rh, t0);
      K.lfo(ac, 0.05, 0.018, roar.gain, 'sine', t0);
      var birds = K.filter(ac, 'lowpass', 4500, 0.3, K.gain(ac, 1, out)); birds.connect(K.gain(ac, 0.5, rv));
      var nextBird = t0 + 4, nextDrip = t0 + 1;

      return function schedule(until) {
        while (nextBird < until) { // a whistle: two falling notes, sometimes answered
          var bt = nextBird, f0 = 1300 + Math.random() * 700, bp = Math.random() * 1.4 - 0.7;
          for (var c = 0; c < (Math.random() < 0.5 ? 2 : 3); c++) {
            var o = ac.createOscillator(); var g = ac.createGain();
            o.frequency.setValueAtTime(f0 * (c === 1 ? 1.25 : 1), bt); o.frequency.exponentialRampToValueAtTime(f0 * (c === 1 ? 0.95 : 0.7), bt + 0.35);
            g.gain.setValueAtTime(0.0001, bt); g.gain.linearRampToValueAtTime(0.008, bt + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.4);
            K.lfo(ac, 18, 25, o.detune, 'sine', bt).stop(bt + 0.42);
            o.connect(g); g.connect(K.panner(ac, bp, birds)); o.start(bt); o.stop(bt + 0.42);
            bt += 0.45;
          }
          nextBird = bt + 6 + Math.random() * 10;
        }
        while (nextDrip < until) {
          var o2 = ac.createOscillator(); var g2 = ac.createGain(); var ff = 1100 + Math.random() * 900;
          o2.frequency.setValueAtTime(ff, nextDrip); o2.frequency.exponentialRampToValueAtTime(ff * 1.6, nextDrip + 0.04);
          g2.gain.setValueAtTime(0.0001, nextDrip); g2.gain.linearRampToValueAtTime(0.006, nextDrip + 0.004); g2.gain.exponentialRampToValueAtTime(0.0001, nextDrip + 0.1);
          o2.connect(g2); g2.connect(K.panner(ac, Math.random() * 1.6 - 0.8, rv)); o2.start(nextDrip); o2.stop(nextDrip + 0.12);
          nextDrip += 0.6 + Math.random() * 2.5;
        }
      };
    },
  });
})();

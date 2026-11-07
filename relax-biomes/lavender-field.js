// Lavender field - rows of lavender running to the hills of Provence, a stone
// farmhouse and cypresses, broad clouds drifting over, the wind moving through
// the flowers in slow waves; late afternoon turns to golden hour.
// Music: a lo-fi waltz in A-flat (3/4, 84 bpm): soft piano oom-pah-pah, a six-bar
// vibraphone melody, upright bass, a brushed kit; breeze, larks.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A sprite's set(), called only when what it shows changes visibly: every style
  // write costs the page a style pass.
  function quiet(spr) {
    var last = '';
    return function (x, y, rot, alpha) {
      var key = x.toFixed(1) + ',' + y.toFixed(1) + ',' + (rot || 0).toFixed(2) + ',' + (alpha === undefined ? 1 : alpha).toFixed(2);
      if (key === last) return;
      last = key; spr.set(x, y, rot, alpha === undefined ? undefined : Math.round(alpha * 100) / 100);
    };
  }
  // A cypress: a tall flame of dark green, lit on one side.
  function cypress(x, bx, by, h, w, dark, lit, dir) {
    x.fillStyle = dark;
    x.beginPath(); x.moveTo(bx, by - h);
    x.bezierCurveTo(bx + w * 0.7, by - h * 0.7, bx + w * 0.62, by - h * 0.12, bx + w * 0.18, by);
    x.lineTo(bx - w * 0.18, by);
    x.bezierCurveTo(bx - w * 0.62, by - h * 0.12, bx - w * 0.7, by - h * 0.7, bx, by - h);
    x.fill();
    x.fillStyle = lit;
    x.beginPath(); x.moveTo(bx, by - h);
    x.bezierCurveTo(bx + dir * w * 0.7, by - h * 0.7, bx + dir * w * 0.62, by - h * 0.12, bx + dir * w * 0.18, by);
    x.lineTo(bx + dir * w * 0.08, by);
    x.bezierCurveTo(bx + dir * w * 0.3, by - h * 0.2, bx + dir * w * 0.3, by - h * 0.65, bx, by - h);
    x.fill();
  }
  // A far tree clump: a few overlapping crowns of uneven size, wider than tall, never a disc.
  function clump(x, cx, by, w, r, dark, lit, dir) {
    var n = 3 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      var u = (i + 0.3 * r()) / n - 0.5, cw = w * (0.22 + 0.2 * r()), ch = cw * (0.35 + 0.25 * r());
      var px = cx + u * w * 0.8, py = by - ch * (0.7 + 0.5 * (1 - Math.abs(u) * 2));
      x.fillStyle = dark; x.beginPath(); x.ellipse(px, py, cw, ch, (r() - 0.5) * 0.4, 0, Math.PI * 2); x.fill();
      if (r() < 0.6) { x.fillStyle = lit; x.beginPath(); x.ellipse(px + dir * cw * 0.35, py - ch * 0.3, cw * 0.45, ch * 0.45, 0, 0, Math.PI * 2); x.fill(); }
    }
    x.fillStyle = dark; x.fillRect(cx - w * 0.42, by - 2, w * 0.84, 3);
  }
  // A cloud, painted once with room to spare round it: a few soft lobes of uneven size
  // along a gently tilted, uneven base, broken up by noise; lit side towards the sun,
  // cool underside. warm (0..1) is the late light on its sunlit side.
  function cloud(w, h, seed, sunDir, warm) {
    var r = K.seeded(seed), lobes = [], n = 9 + Math.floor(r() * 5), big = r() < 0.5 ? 0.36 : 0.64;
    for (var i = 0; i < n; i++) {
      // lobes bunch round one heavier end and thin out towards the other
      var u = big + (r() + r() - 1) * 0.36;
      var size = 0.06 + 0.12 * Math.exp(-Math.pow((u - big) / 0.2, 2)) * (0.6 + 0.6 * r());
      lobes.push([K.clamp(u, 0.24, 0.76), 0.62 - size * (0.5 + 1.2 * r()), size]);
    }
    var tilt = (r() - 0.5) * 0.12, aspect = w / h;
    var lit = K.mixRgb('255, 255, 255', '255, 222, 186', warm), under = K.mixRgb('188, 200, 212', '196, 178, 196', warm);
    var L = K.rgb(lit), U = K.rgb(under);
    function dens(u, v) {
      var d = 0;
      for (var i = 0; i < lobes.length; i++) {
        var dx = (u - lobes[i][0]) * aspect * 0.5, dy = v - lobes[i][1], rr = lobes[i][2];
        d += Math.exp(-(dx * dx + dy * dy) / (rr * rr));
      }
      var base = 0.66 + tilt * (u - 0.5) + 0.04 * K.noise1(u * 6, seed);
      return d * K.smooth((base - v) / 0.1) * (0.3 + 1.25 * (K.fbm2(u * 12 * aspect * 0.3, v * 11, 5, seed + 3) * 0.5 + 0.5));
    }
    return K.field(w, h, function (u, v, out) {
      var d = dens(u, v);
      var a = K.smooth((d - 0.5) / 0.2);
      if (a < 0.004) return null;
      // denser towards the light = this point is inside, in the cloud's own shade
      var occl = K.clamp((dens(u + sunDir * 0.03, v - 0.06) - d) * 1.6 + 0.25, 0, 1);
      var k = K.clamp(occl * 0.75 + (v - 0.3) * 0.5, 0, 1);
      out[0] = L[0] + (U[0] - L[0]) * k; out[1] = L[1] + (U[1] - L[1]) * k; out[2] = L[2] + (U[2] - L[2]) * k;
      out[3] = a * 0.95;
      return out;
    });
  }

  RelaxBiomes.register({
    id: 'lavender-field',
    name: 'Lavender field',
    about: 'Rows of lavender running to Provence hills, a farmhouse and cypresses, broad clouds drifting, wind through the flowers, late afternoon turning to golden hour. A lo-fi waltz in A-flat: soft piano, vibraphone, upright bass, brushed kit, larks.',
    ink: '255, 255, 255',
    shade: '40, 36, 80',
    vignette: 0.24,
    legible: 0.75,
    grade: { shadow: '20, 16, 40', light: '255, 248, 238' },
    grain: 0.018,
    level: 0.772, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.390,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var SW = s.SW, SH = s.SH;
      var hz = 0.52, horizon = Math.round(H * hz);
      // One field for both screens: the rows run to a vanishing point on the main screen,
      // so on the side screen they lean towards it. The sun is low on the main screen's
      // outer side: late afternoon going golden, never setting.
      var mInner = main ? inner : -inner, shift = main ? 0 : -inner; // in screen widths
      var vpU = 0.5 + 0.08 * mInner;
      var sunU = mInner > 0 ? 0.1 : 0.9; // pair x of the sun
      var sunDir = mInner > 0 ? -1 : 1;  // which way the light comes from on screen

      function sky(stops, glow) {
        var c = s.layer(W, horizon + 2), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, stops);
        x.fillRect(0, 0, W, horizon + 2);
        x.save(); x.translate((sunU - shift) * W, horizon * 0.5); x.scale(1.6, 1);
        x.fillStyle = K.radial(x, 0, 0, H * 0.5, [[0, 'rgba(255, 214, 160,' + glow + ')'], [1, 'rgba(255, 214, 160, 0)']]);
        x.fillRect(-H * 0.5, -H * 0.5, H, H);
        x.restore();
        return c;
      }
      var skyEarly = sky([[0, '#5f84bd'], [0.5, '#8eaad0'], [0.85, '#c8cddb'], [1, '#e6dccf']], 0.18);
      var skyLate = sky([[0, '#6a7cb2'], [0.5, '#a2a4c4'], [0.82, '#dcbfac'], [1, '#efc79f']], 0.32);

      // Two or three asymmetric cloud masses with room round them; the middle of the sky open.
      var cloudDefs = main ? [[outer < 0 ? -0.02 : 0.46, 0.0, 0.56, 0.34, 3], [inner > 0 ? 0.56 : -0.02, 0.22, 0.46, 0.2, 9]]
        : [[0.36, 0.02, 0.6, 0.3, 17]];
      var clouds = cloudDefs.map(function (c) {
        var cw = Math.round(W * c[2]), ch = Math.round(H * c[3]);
        return { early: cloud(cw, ch, c[4], sunDir, 0), late: cloud(cw, ch, c[4], sunDir, 1),
          x: W * c[0], y: H * c[1], v: (0.12 + 0.1 * rnd()) * (rnd() < 0.5 ? 1 : -1) };
      });

      // Far hills, blue with distance; the farmhouse ridge is crisp on the front layer.
      var hills = s.layer(W, horizon + 2), hx = hills.getContext('2d');
      var haze = '#c9cfdc';
      hx.fillStyle = K.aerial('#7d8fa8', haze, 0.55);
      hx.fill(K.ridge(-2, W + 2, 2, function (x) { var u = x / W + shift; return horizon - H * (0.05 + 0.028 * Math.sin(u * 3.1 + 1) + 0.01 * K.noise1(u * 8, 2)); }, horizon + 3));
      hx.fillStyle = K.aerial('#6f8a7c', haze, 0.32);
      hx.fill(K.ridge(-2, W + 2, 2, function (x) { var u = x / W + shift; return horizon - H * (0.018 + 0.014 * Math.sin(u * 4.6 + 3) + 0.006 * K.noise1(u * 14, 4)); }, horizon + 3));

      // The middle distance: the rows dissolve into one textured band of bloom that hazes
      // towards the horizon (the near rows are bushes on the front layer). Painted in the
      // afternoon light and in the golden light; the two crossfade.
      var vpx = (vpU - shift) * W;
      function band(late) {
        var bloom = K.rgb(late ? '#957aa8' : '#8c7baa'), earth = K.rgb(late ? '#7a6a50' : '#747456');
        var hazeC = K.rgb(late ? '#c4a8b4' : '#b2a8cc');
        return K.field(W, H - horizon, function (u, v, out) {
          var y = v * (H - horizon), dz = Math.max(0.004, y / (H - horizon)), z = 1 / dz;
          var X = ((u * W - vpx) / W) * z * 1.6;
          var clumps = 0.92 + 0.1 * K.noise2(u * 60, v * 22, 8);
          var cov = 0.74;
          var sunlit = 1 + (late ? 0.14 : 0.06) * K.noise2(X * 6, z * 0.5, 4);
          for (var i = 0; i < 3; i++) out[i] = (earth[i] + (bloom[i] * clumps - earth[i]) * cov) * sunlit;
          var hk = K.smooth((z - 4) / 26) * 0.6;
          for (var j = 0; j < 3; j++) out[j] += (hazeC[j] - out[j]) * hk;
          out[3] = 1;
          return out;
        });
      }
      var bandEarly = band(false), bandLate = band(true);
      var sheen = K.wisps({ w: Math.round(W * 0.45), h: Math.round(H * 0.12), rgb: '236, 220, 255', alpha: 0.5, seed: 77, stretch: 4, cover: 0.6 });
      var winds = [[17, 0.3, 0.12], [23, 0.62, 0.2]];
      var sunCore = K.bloom('255, 232, 190', 1);
      var sunHalo = K.bloom('255, 196, 130', 2.2);
      var sunR = Math.ceil(H * 0.036), sunDisc = K.canvas(sunR * 2, sunR * 2), sdx = sunDisc.getContext('2d');
      sdx.fillStyle = K.radial(sdx, sunR, sunR, sunR, [[0, 'rgba(255, 250, 238, 1)'], [0.75, 'rgba(255, 238, 206, 0.95)'], [1, 'rgba(255, 222, 176, 0)']]);
      sdx.fillRect(0, 0, sunR * 2, sunR * 2);

      // The near field and the farmhouse ridge, crisp: rows of overlapping rounded lavender
      // bushes, each with its own contact shadow away from the sun. Painted twice - in the
      // afternoon light (front layer) and in the golden light (a sprite that fades in) - so
      // the light changes through the surfaces: lower sun, longer shadows, warm rims.
      var hzp = SH * hz, zFar = 16, groundTop = Math.floor(hzp - SH * 0.11);
      var vps = (vpU - shift) * SW;
      function ground(x, late) {
        var r = K.seeded(808 + (main ? 0 : 5)), dir = -sunDir;
        // the ridge: hedges, tree clumps, the farmhouse, cypress groups
        var dark = K.aerial('#34503a', haze, 0.36), lit = K.aerial(late ? '#86915a' : '#6d8a5c', haze, 0.33);
        for (var hx0 = 0; hx0 < SW;) {
          var run = 30 + r() * 160;
          for (var q = hx0; q < hx0 + run && q < SW; q += 3 + r() * 4) {
            var hr = 2.5 + r() * 3.5;
            x.fillStyle = r() < 0.5 ? dark : K.aerial('#46613f', haze, 0.36);
            x.beginPath(); x.ellipse(q, hzp + 1, hr * 1.4, hr, 0, Math.PI, 0); x.fill();
          }
          hx0 += run + 20 + r() * 120;
        }
        for (var o = 0; o < 5; o++) clump(x, SW * (0.06 + 0.88 * r()), hzp + 1, SH * (0.035 + 0.035 * r()), r, dark, lit, dir);
        if (main) {
          var fu = outer < 0 ? 0.24 : 0.76, fhx = SW * fu, fhy = hzp - 2, fw = SW * 0.045, fh = SH * 0.03;
          var wall = K.aerial(late ? '#e0c09a' : '#d6c2a2', haze, 0.22), wallShade = K.aerial(late ? '#9a8070' : '#a8937a', haze, 0.22);
          x.fillStyle = wall; x.fillRect(fhx, fhy - fh, fw, fh);
          x.fillStyle = wallShade; x.fillRect(dir > 0 ? fhx : fhx + fw * 0.7, fhy - fh, fw * 0.3, fh);
          x.fillStyle = K.aerial('#b4664a', haze, 0.22);
          x.beginPath(); x.moveTo(fhx - 4, fhy - fh); x.lineTo(fhx + fw * 0.5, fhy - fh - SH * 0.013); x.lineTo(fhx + fw + 4, fhy - fh); x.fill();
          x.fillStyle = wallShade; x.fillRect(fhx + fw, fhy - fh * 0.62, fw * 0.45, fh * 0.62);
          x.fillStyle = K.aerial('#9e5a42', haze, 0.22);
          x.beginPath(); x.moveTo(fhx + fw, fhy - fh * 0.62); x.lineTo(fhx + fw * 1.45 + 3, fhy - fh * 0.62); x.lineTo(fhx + fw, fhy - fh * 0.85); x.fill();
          x.fillStyle = 'rgba(70, 60, 50, 0.7)';
          for (var wn = 0; wn < 3; wn++) x.fillRect(fhx + fw * (0.18 + wn * 0.28), fhy - fh * 0.65, 3, 5);
          [[fu - 0.022, 0.085], [fu - 0.012, 0.07], [fu - 0.031, 0.06], [fu + 0.07, 0.075], [fu + 0.078, 0.06], [fu + 0.21 * (outer < 0 ? 1 : -1), 0.05]].forEach(function (c) {
            var ch = SH * c[1];
            cypress(x, SW * c[0], hzp, ch, ch * 0.2, K.aerial('#2c4630', haze, 0.22), K.aerial(late ? '#7a8650' : '#5e7a50', haze, 0.22), dir);
          });
        } else {
          var lu = outer > 0 ? 0.68 : 0.32;
          cypress(x, SW * lu, hzp, SH * 0.06, SH * 0.012, K.aerial('#2c4630', haze, 0.28), K.aerial(late ? '#7a8650' : '#5e7a50', haze, 0.28), dir);
          cypress(x, SW * (lu + 0.012), hzp, SH * 0.045, SH * 0.009, K.aerial('#2c4630', haze, 0.28), K.aerial(late ? '#7a8650' : '#5e7a50', haze, 0.28), dir);
        }
        // the earth between the near rows, fading in where the bushes begin
        var yCut = hzp + (SH - hzp) / zFar;
        x.fillStyle = K.linear(x, 0, yCut - SH * 0.01, 0, SH, [[0, late ? 'rgba(170, 150, 160, 0)' : 'rgba(168, 158, 186, 0)'],
          [0.05, late ? 'rgba(160, 140, 150, 1)' : 'rgba(160, 152, 180, 1)'], [0.3, late ? '#7e6c5c' : '#7a7062'], [1, late ? '#5c4c48' : '#5e5650']]);
        x.fillRect(0, yCut - SH * 0.03, SW, SH - yCut + SH * 0.03);
        // The rows: each a mounded hedge of lavender running to the vanishing point, narrower
        // than the row spacing (earth furrows between), its top lumpy where the bushes join.
        // Seen from the middle, a row left of the vanishing point shows its top and right
        // side, one on the right its top and left side; inner rows hide outer ones, so the
        // outer rows are painted first.
        var sp = 0.072, rb = K.seeded(4242 + (main ? 0 : 11));
        var elev = late ? 0.2 : 0.55; // the sun's height: shadows lengthen as it sinks
        var hh = 0.09 * SH, w2 = sp * 0.36, t2 = sp * 0.22;
        var y0 = hzp + (SH - hzp) / zFar;
        function vgrad(c0, c1) {
          return K.linear(x, 0, y0, 0, SH, [[0, K.aerial(c0, '#b4a8cc', 0.62)], [0.12, K.aerial(c0, '#b4a8cc', 0.35)], [0.35, K.aerial(c0, '#b4a8cc', 0.1)], [1, c1]]);
        }
        // near contrast kept low: the field is a quiet ground for the ring and timer
        var gTop = vgrad(late ? '#9a7cba' : '#8e7ec0', late ? '#7e60a0' : '#7262aa');
        var gLit = vgrad(late ? '#8a68aa' : '#7c68b0', late ? '#74569a' : '#6a58a6');
        var gShd = vgrad(late ? '#5e4a84' : '#62558e', late ? '#4e3e72' : '#544684');
        var zs = [], BL = 0.075; // BL: a bush's length along its row, in depth units
        for (var z = zFar; z > 0.8; z -= Math.max(0.006, z * 0.011)) zs.push(z);
        zs.push(0.8);
        function px(X, z) { return vps + X * SW / (1.6 * z); }
        function pyb(z) { return hzp + (SH - hzp) / z; }
        var xMin = Math.min(-vps / SW * 1.6 * zFar, -vps / SW * 1.6 * 0.8), xMax = Math.max((SW - vps) / SW * 1.6 * zFar, (SW - vps) / SW * 1.6 * 0.8);
        var rows = [];
        for (var ri = Math.floor(xMin / sp) - 1; ri <= Math.ceil(xMax / sp) + 1; ri++) rows.push((ri + 0.5) * sp);
        rows.sort(function (a, b) { return Math.abs(b) - Math.abs(a); });
        function visible(Xc) {
          return zs.filter(function (z) { var X = px(Xc, z); return X > -60 && X < SW + 60; });
        }
        // shadows on the furrows first, on the side away from the sun
        var sl = sp * (0.1 + 0.3 * (1 - elev));
        x.fillStyle = 'rgba(40, 32, 52, 0.2)';
        rows.forEach(function (Xc) {
          var e0 = Xc - sunDir * w2, e1 = Xc - sunDir * (w2 + sl), zv = visible(Xc);
          if (zv.length < 2) return;
          x.beginPath();
          zv.forEach(function (z, i) { if (i) x.lineTo(px(e0, z), pyb(z)); else x.moveTo(px(e0, z), pyb(z)); });
          for (var j = zv.length - 1; j >= 0; j--) x.lineTo(px(e1, zv[j]), pyb(zv[j]));
          x.fill();
        });
        var rb2 = K.seeded(99 + (main ? 0 : 3)), phs = [];
        rows.forEach(function (Xc, n) {
          var side = Xc < 0 ? 1 : -1, ph = phs[n] = n * 1.7 + rb2() * 6;
          var zv = visible(Xc);
          if (zv.length < 2) return;
          // one rounded dome per bush along the row, of uneven height, with a dip between bushes
          function top(z) {
            var q = (z + ph) / BL, f = q - Math.floor(q), bi = Math.floor(q);
            var dome = Math.sqrt(Math.max(0, 1 - Math.pow(2 * f - 1, 2)));
            // far away a bush is under a few pixels long: the row's top just runs smooth
            var bump = K.smooth(((SH - hzp) / (z * z) * BL - 2) / 6);
            return pyb(z) - hh / z * (0.92 - 0.42 * bump + 0.42 * dome * bump) * (0.88 + 0.24 * K.noise1(bi * 0.9, n) * bump);
          }
          // the side face we see
          x.fillStyle = (side > 0) === (sunDir > 0) ? gLit : gShd;
          x.beginPath();
          zv.forEach(function (z, i) { var X = px(Xc + side * t2, z), Y = top(z); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
          for (var j = zv.length - 1; j >= 0; j--) x.lineTo(px(Xc + side * w2, zv[j]), pyb(zv[j]));
          x.fill();
          // the top
          x.fillStyle = gTop;
          x.beginPath();
          zv.forEach(function (z, i) { var X = px(Xc - side * t2, z), Y = top(z) + hh / z * 0.05; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
          for (var j2 = zv.length - 1; j2 >= 0; j2--) x.lineTo(px(Xc + side * t2, zv[j2]), top(zv[j2]));
          x.fill();
        });
        // flower spikes and a warm rim along the nearest tops
        rows.forEach(function (Xc, n) {
          var side = Xc < 0 ? 1 : -1, ph = phs[n];
          for (var z = 2.2; z > 0.82; z -= z * z * 0.011) {
            var q = (z + ph) / BL, f = q - Math.floor(q), dome = Math.sqrt(Math.max(0, 1 - Math.pow(2 * f - 1, 2)));
            var bx = px(Xc + (rb() - 0.5) * t2 * 2.4, z), yt = pyb(z) - hh / z * (0.5 + 0.42 * dome) * (0.88 + 0.24 * K.noise1(Math.floor(q) * 0.9, n));
            if (bx < -10 || bx > SW + 10) continue;
            x.strokeStyle = rb() < 0.55 ? (late ? '#a888c4' : '#9a86cc') : '#6a54a2';
            x.lineWidth = Math.max(1, 1.8 / z);
            x.beginPath(); x.moveTo(bx, yt + 5 / z); x.lineTo(bx + (rb() - 0.5) * 3 / z, yt - 7 / z); x.stroke();
          }
        });
        // calmer still under the ring, the timer and the place's name: the same lavender, less contrast
        x.fillStyle = K.radial(x, SW / 2, SH * 0.9, SH * 0.24, [[0, late ? 'rgba(112, 88, 150, 0.5)' : 'rgba(104, 90, 158, 0.5)'],
          [0.6, late ? 'rgba(112, 88, 150, 0.22)' : 'rgba(104, 90, 158, 0.22)'], [1, 'rgba(104, 90, 158, 0)']]);
        x.fillRect(SW / 2 - SH * 0.24, SH * 0.66, SH * 0.48, SH * 0.34);
      }
      var lateGround = s.sprite(SW, SH - groundTop, function (cx) { cx.translate(0, -groundTop); ground(cx, true); });
      var setLate = quiet(lateGround);
      setLate(0, groundTop, 0, 0);

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          // late afternoon -> golden hour: one coherent shift in sky, flowers and ground
          var g = K.smooth(p * 1.05);
          if (g < 1) ctx.drawImage(skyEarly, 0, 0);
          if (g > 0) { ctx.globalAlpha = g; ctx.drawImage(skyLate, 0, 0); }
          ctx.globalAlpha = 1;
          var sunX = (sunU - shift) * W, sunY = H * (0.14 + 0.2 * g);
          K.light(ctx, sunHalo, sunX, sunY, H * 0.5, 0.16 + 0.14 * g, H * 0.42);
          if (main) {
            ctx.drawImage(sunDisc, sunX - sunR, sunY - sunR);
            K.light(ctx, sunCore, sunX, sunY, H * 0.15, 0.45 + 0.15 * g);
          }
          for (var i = 0; i < clouds.length; i++) {
            var cl = clouds[i], cx = cl.x + Math.min(t, 600) * cl.v;
            if (g < 1) { ctx.globalAlpha = 1; ctx.drawImage(cl.early, cx, cl.y); }
            if (g > 0) { ctx.globalAlpha = g; ctx.drawImage(cl.late, cx, cl.y); }
          }
          ctx.globalAlpha = 1;
          var pf = s.par(0.15);
          ctx.drawImage(hills, pf.x, pf.y);
          ctx.drawImage(bandEarly, 0, horizon);
          if (g > 0) { ctx.globalAlpha = g; ctx.drawImage(bandLate, 0, horizon); ctx.globalAlpha = 1; }
          ctx.globalCompositeOperation = 'lighter';
          for (var wz = 0; wz < winds.length; wz++) {
            var wd = winds[wz], ph = (t / wd[0] + wd[1]) % 1;
            var yy = horizon + (H - horizon) * wd[2], sc = 0.5 + wd[2] * 1.5;
            ctx.globalAlpha = 0.14 * Math.sin(Math.PI * ph);
            if (ctx.globalAlpha < 0.01) continue;
            ctx.drawImage(sheen, -sheen.width * sc + ph * (W + sheen.width * sc * 2), yy - sheen.height * sc * 0.5,
              sheen.width * sc * 2, sheen.height * sc);
          }
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          setLate(0, groundTop, 0, g);
        },

        front: function (fx) { ground(fx, false); },
      };
    },

    lofi: {
      key: 'Ab', mode: 'major', bpm: 84, meter: 3, swing: 0.56, swing8: true,
      progs: ['Imaj7 vi7 ii7 V7sus', 'Imaj9 IVmaj7 ii9 V9sus', 'IVmaj7 iii7 vi9 V7'],
      keys: { inst: 'piano', style: 'waltz', range: [48, 74], level: 0.95 },
      lead: { inst: 'vibes', range: [65, 86], level: 0.55, phrase: 6, motif: '0.4.3 4.4.5 8.4.6 | 0.12.5' },
      reply: { inst: 'vibes', shift: -12, level: 0.55 },
      bass: { style: 'waltz', level: 0.58 },
      drums: { style: 'waltz', kit: 'brushes', snare: 'tap', level: 0.76 },
      fx: { tone: 5500, crackle: 0.25, hiss: 0.3, wow: 0.8, room: 0.4, verb: 1.1, echo: 1, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 2.6, 3, out, 0.3);
      var breeze = K.gain(ac, 0.055, out);
      var bb = K.filter(ac, 'bandpass', 900, 0.5, breeze);
      K.loop(ac, K.noise(ac, 'pink', 8), bb, t0);
      K.lfo(ac, 0.035, 0.04, breeze.gain, 'sine', t0);
      var larks = K.filter(ac, 'lowpass', 5500, 0.3, K.gain(ac, 1, out));
      larks.connect(K.gain(ac, 0.4, rv));
      var nextLark = t0 + 5;

      return function schedule(until) {
        while (nextLark < until) { // a lark: a fast warble, high and soft
          var lt = nextLark, base = 3000 + Math.random() * 1200, pan = Math.random() * 1.4 - 0.7;
          var notes = 6 + Math.floor(Math.random() * 10);
          for (var k = 0; k < notes; k++) {
            var o = ac.createOscillator(); var g = ac.createGain();
            var f = base * (0.85 + 0.35 * Math.random());
            o.frequency.setValueAtTime(f, lt); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.2 : 0.85), lt + 0.05);
            g.gain.setValueAtTime(0.0001, lt); g.gain.linearRampToValueAtTime(0.0035, lt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, lt + 0.06);
            o.connect(g); g.connect(K.panner(ac, pan, larks)); o.start(lt); o.stop(lt + 0.07);
            lt += 0.06 + Math.random() * 0.05;
          }
          nextLark = lt + 5 + Math.random() * 9;
        }
      };
    },
  });
})();

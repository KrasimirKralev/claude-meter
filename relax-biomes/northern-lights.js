// Northern lights - green and violet curtains folding slowly over a frozen lake,
// snowy mountains and pines; the ice mirrors the sky.
// Music: B lydian (64 bpm, brushed half time): soft vibraphone chords, a rising high-piano
// theme, a bowed vibraphone drone, a long upright bass; cold wind.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A sprite's set(), called only when what it shows changes visibly: every style
  // write costs the page a style pass, and most of these move a fraction of a pixel a frame.
  function quiet(spr) {
    var last = '';
    return function (x, y, rot, alpha) {
      var key = x.toFixed(1) + ',' + y.toFixed(1) + ',' + (rot || 0).toFixed(2) + ',' + (alpha === undefined ? 1 : alpha).toFixed(2);
      if (key === last) return;
      last = key; spr.set(x, y, rot, alpha === undefined ? undefined : Math.round(alpha * 100) / 100);
    };
  }

  // A narrow boreal spruce: ragged drooping branch tips, uneven sides, a little
  // snow on some; `lean` tilts the top, `bare` leaves a few branches missing.
  function spruce(fx, rnd, x, base, h, w, dark, snow, lean, bare) {
    var steps = Math.max(10, Math.round(h / 9));
    var top = base - h, tx = x + (lean || 0) * h;
    var right = [], left = [], caps = [];
    for (var i = 0; i <= steps; i++) {
      var k = i / steps;
      var y = top + h * 0.02 + k * h * 0.9;
      var cx = tx + (x - tx) * k;
      var spread = w * 0.5 * Math.pow(k, 0.85);
      for (var side = -1; side <= 1; side += 2) {
        var half = spread * (0.62 + 0.6 * rnd());
        if (bare && rnd() < bare) half *= 0.3;
        var tipY = y + h * (0.008 + 0.014 * k);
        var notch = [cx + side * half * (0.3 + 0.2 * rnd()), y + h * 0.012];
        var tip = [cx + side * half, tipY];
        (side > 0 ? right : left).push(tip, notch);
        if (k > 0.2 && k < 0.92 && rnd() < 0.13) {
          // a little snow lying on top of the bough, somewhere between its notch and tip
          var f = 0.35 + 0.45 * rnd(), sx = notch[0] + (tip[0] - notch[0]) * f, sy = notch[1] + (tip[1] - notch[1]) * f;
          caps.push([sx, sy - 0.8, half * (0.08 + 0.2 * rnd() * rnd()), Math.atan2(tip[1] - notch[1], tip[0] - notch[0]) + (side < 0 ? Math.PI : 0),
            0.5 + 0.9 * rnd()]);
        }
      }
    }
    fx.fillStyle = dark;
    fx.beginPath();
    fx.moveTo(tx, top);
    right.forEach(function (pt) { fx.lineTo(pt[0], pt[1]); });
    fx.lineTo(x + w * 0.04, base + 2); fx.lineTo(x - w * 0.04, base + 2);
    for (var j = left.length - 1; j >= 0; j--) fx.lineTo(left[j][0], left[j][1]);
    fx.closePath();
    fx.fill();
    if (!snow) return;
    fx.fillStyle = snow;
    caps.forEach(function (c) {
      // flat underneath, lumpy on top: a half-ellipse along the bough plus a smaller lump
      var w = Math.max(1.2, c[2]), t = Math.max(0.8, h * 0.0026 * c[4]);
      fx.save(); fx.translate(c[0], c[1]); fx.rotate(c[3]);
      fx.beginPath(); fx.ellipse(0, 0, w, t, 0, Math.PI, 0); fx.fill();
      if (c[4] > 0.9) { fx.beginPath(); fx.ellipse(w * 0.35, -t * 0.4, w * 0.4, t * 0.8, 0, Math.PI, 0); fx.fill(); }
      fx.restore();
    });
  }

  // One aurora curtain, painted once: a folded ribbon whose lower edge is sharp and
  // bright and whose light thins upwards into violet, with irregular folds, dark gaps
  // and faint rays. Everything that varies along it is computed per column.
  function curtain(w, h, o) {
    var c = K.canvas(w, h), x = c.getContext('2d');
    var img = x.createImageData(w, h), d = img.data;
    var mint = [190, 255, 214], green = [62, 232, 152], teal = [36, 158, 150], violet = [150, 92, 214];
    for (var i = 0; i < w; i++) {
      var u = i / w;
      var edge = o.base + o.amp * (0.7 * K.noise1(u * 2.6 + o.seed, o.seed) + 0.3 * K.noise1(u * 7.5, o.seed + 1)) -
        0.035 * Math.abs(K.noise1(u * 13, o.seed + 6));
      var fold = K.smooth((K.noise1(u * 6.5 + o.seed * 3, o.seed + 4) + 0.15) / 0.6);
      var bump = (o.floor || 0) + (1 - (o.floor || 0)) * Math.exp(-Math.pow((u - o.u0) / (o.reach || 0.24), 2));
      // rays of uneven brightness and length at uneven spacing: a fringe, never a comb
      var ray = Math.pow(0.5 + 0.5 * K.noise1(u * 38, o.seed + 5), 1.6) * 0.7 + 0.3 * (0.5 + 0.5 * K.noise1(u * 105, o.seed + 7));
      // uneven heights along the curtain, and only a few places where its base flares bright
      var len = o.len * (0.45 + 0.8 * ray) * (0.5 + 0.9 * (0.5 + 0.5 * K.noise1(u * 2.2, o.seed + 8)));
      var flare = K.smooth((K.noise1(u * 2.6, o.seed + 9) + 0.15) / 0.6);
      var str = fold * bump * o.alpha;
      if (str < 0.01) continue;
      for (var j = 0; j < h; j++) {
        var dd = edge - j / h;
        if (dd < -0.03) break;
        // the light ends at the lower edge (plain sky below); above it, it lives in the rays:
        // no even sheet that would read as a lit ridge with a dark band under it
        var a = dd < 0 ? K.smooth(1 + dd / 0.022) * (0.15 + 0.85 * ray) :
          (0.12 + 0.5 * flare + 0.3 * ray) * Math.exp(-dd / 0.014) + (0.16 + 0.84 * ray) * Math.exp(-dd / len);
        a = Math.min(1, a * str);
        if (a < 0.004) continue;
        var k = dd < 0 ? 0 : dd / len, c0, c1, f;
        if (k < 0.12) { c0 = mint; c1 = green; f = k / 0.12; }
        else if (k < 0.55) { c0 = green; c1 = teal; f = (k - 0.12) / 0.43; }
        else { c0 = teal; c1 = violet; f = Math.min(1, (k - 0.55) / (o.violet || 0.7)); }
        var p = (j * w + i) * 4;
        d[p] = c0[0] + (c1[0] - c0[0]) * f; d[p + 1] = c0[1] + (c1[1] - c0[1]) * f; d[p + 2] = c0[2] + (c1[2] - c0[2]) * f;
        d[p + 3] = a * 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  RelaxBiomes.register({
    id: 'northern-lights',
    name: 'Northern lights',
    about: 'Green and violet aurora curtains growing and folding over a still lake that mirrors them, snowy mountains and spruces. Slow lo-fi in B lydian: vibraphone chords, a rising high-piano theme, bowed vibraphone, brushes, cold wind.',
    ink: '226, 246, 240',
    shade: '2, 8, 18',
    vignette: 0.32,
    grade: { shadow: '6, 14, 24', light: '240, 250, 255' },
    level: 0.922, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.223,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var horizon = Math.round(H * 0.62);
      var haze = '#1d3d4a';
      // u measured from the outer edge of this screen (0) to the edge facing the other one (1)
      function ou(u) { return outer < 0 ? u : 1 - u; }

      var sky = s.layer(W, horizon + 2), sx = sky.getContext('2d');
      sx.fillStyle = K.linear(sx, 0, 0, 0, horizon, [[0, '#02050c'], [0.4, '#04101d'], [0.78, '#0a212d'], [1, '#12343d']]);
      sx.fillRect(0, 0, W, horizon + 2);
      var stars = K.stars(W, horizon, rnd, { faint: 330, mid: 26, bright: main ? 3 : 2,
        density: function (v) { return v < 0.75 ? 1 - v * 0.6 : 0.15; } });
      // the steady tiers are one picture: one draw a frame instead of two
      var steady = s.layer(W, horizon), stx = steady.getContext('2d');
      stx.globalAlpha = 0.8; stx.drawImage(stars.faint, 0, 0); stx.globalAlpha = 0.75; stx.drawImage(stars.mid, 0, 0);

      // Mountains: a massif on the outer side of the main screen, a low range on the side one.
      function peak(x) {
        var u = x / W, v = ou(u);
        var hgt = main ? 0.15 * Math.exp(-Math.pow((v - 0.2) / 0.16, 2)) + 0.075 * Math.exp(-Math.pow((v - 0.45) / 0.11, 2)) +
          0.035 * Math.exp(-Math.pow((v - 0.8) / 0.2, 2))
          : 0.055 * Math.exp(-Math.pow((v - 0.55) / 0.22, 2)) + 0.03 * Math.exp(-Math.pow((v - 0.15) / 0.15, 2));
        var jag = Math.abs(K.noise1(u * 21, 3)) * 0.3 + Math.abs(K.noise1(u * 57, 5)) * 0.1;
        return horizon - H * (0.018 + hgt * (1 + jag) + 0.006 * K.noise1(u * 9, 4));
      }
      var mtn = K.ridge(-2, W + 2, 1, peak, horizon + 1);
      var land = s.layer(W, horizon + 2), lx = land.getContext('2d');
      lx.fillStyle = K.linear(lx, 0, horizon - H * 0.22, 0, horizon, [[0, K.aerial('#8ea5ba', haze, 0.35)], [0.5, K.aerial('#4c6680', haze, 0.45)],
        [1, K.aerial('#1b2c40', haze, 0.4)]]);
      lx.fill(mtn);
      // shaded faces: the same ridge pushed down-right, darker, inside the mountain
      lx.save(); lx.clip(mtn);
      lx.fillStyle = 'rgba(23, 45, 64, 0.62)';
      lx.fill(K.ridge(-2, W + 2, 1, function (x) { return peak(x - W * 0.014) + H * 0.014; }, horizon + 1));
      lx.fillStyle = 'rgba(23, 45, 64, 0.35)';
      lx.fill(K.ridge(-2, W + 2, 1, function (x) { return peak(x + W * 0.03) + H * 0.035; }, horizon + 1));
      for (var gx = 0; gx < 7; gx++) { // gullies: thin dark streaks running down the faces
        var gu = rnd(), gyTop = peak(gu * W) + 2;
        lx.fillStyle = 'rgba(23, 45, 64, 0.3)';
        lx.beginPath(); lx.moveTo(gu * W, gyTop); lx.lineTo(gu * W + W * 0.02, horizon); lx.lineTo(gu * W + W * 0.006, horizon); lx.fill();
      }
      lx.fillStyle = K.linear(lx, 0, horizon - H * 0.05, 0, horizon, [[0, 'rgba(29, 61, 74, 0)'], [1, 'rgba(29, 61, 74, 0.55)']]);
      lx.fillRect(0, horizon - H * 0.05, W, H * 0.05 + 2);
      lx.restore();
      // the aurora's light on the snow faces, drawn with the aurora's strength
      var lit = s.layer(W, horizon + 2), ltx = lit.getContext('2d');
      ltx.save(); ltx.clip(mtn);
      ltx.fillStyle = K.linear(ltx, 0, horizon - H * 0.2, 0, horizon - H * 0.02, [[0, 'rgba(100, 200, 170, 0.3)'], [1, 'rgba(100, 200, 170, 0)']]);
      ltx.fillRect(0, 0, W, horizon);
      ltx.restore();
      // a distant forest on the far shore, in clusters with gaps, soft with distance
      lx.fillStyle = K.aerial('#06121c', haze, 0.45);
      for (var fx0 = -2; fx0 < W + 2;) {
        var cl = 6 + rnd() * 26, dense = rnd() < 0.72;
        for (var px = fx0; px < fx0 + cl; px += 0.9 + rnd() * 1.6) {
          if (!dense && rnd() < 0.7) continue;
          var ph = H * (0.006 + rnd() * 0.014) * (dense ? 1 : 0.7);
          lx.beginPath(); lx.moveTo(px, horizon - ph); lx.lineTo(px + ph * 0.3, horizon + 1); lx.lineTo(px - ph * 0.3, horizon + 1); lx.fill();
        }
        fx0 += cl + rnd() * 18;
      }

      // The lake: dark open water, still; the mountains mirrored once, the aurora each frame.
      var above = s.layer(W, horizon + 2), ax = above.getContext('2d');
      ax.drawImage(sky, 0, 0); ax.drawImage(land, 0, 0);
      var lake = s.layer(), kx = lake.getContext('2d');
      kx.fillStyle = K.linear(kx, 0, horizon, 0, H, [[0, '#10303a'], [0.25, '#0b2230'], [0.6, '#071622'], [1, '#030912']]);
      kx.fillRect(0, horizon, W, H - horizon);
      K.reflect(kx, K.mirror(above, horizon), horizon, H, W, 0, { bands: 18, amp: 0.8, squash: 1.35, alpha: 0.62 });
      kx.fillStyle = K.linear(kx, 0, horizon, 0, H, [[0, 'rgba(4, 12, 22, 0)'], [0.5, 'rgba(4, 12, 22, 0.35)'], [1, 'rgba(3, 8, 16, 0.75)']]);
      kx.fillRect(0, horizon, W, H - horizon);
      for (var st = 0; st < 14; st++) { // thin skins of ice catching the sky
        var sy = horizon + 3 + Math.pow(rnd(), 1.3) * (H - horizon) * 0.7;
        kx.fillStyle = 'rgba(140, 190, 200, ' + (0.025 + rnd() * 0.04).toFixed(3) + ')';
        kx.fillRect(rnd() * W, sy, W * (0.04 + rnd() * 0.16), 0.6 + (sy - horizon) / H * 2);
      }

      // The curtains: two or three broad ribbons, each a pair of textures drifting apart
      // so the folds slowly change shape; the brightest fold sits off-centre on the main
      // screen, and the side screen carries the ribbon's quieter end.
      var TW = W + 60, TH = horizon;
      var u0 = main ? (inner > 0 ? 0.66 : 0.34) : (inner > 0 ? 0.92 : 0.08);
      var defs = [
        { base: 0.74, amp: 0.1, len: 0.32, u0: u0, alpha: main ? 1 : 0.7, violet: 0.6, seed: 11 + (main ? 0 : 40), floor: 0, reach: 0.38 },
        { base: 0.48, amp: 0.09, len: 0.36, u0: u0 + (inner > 0 ? -0.34 : 0.34), alpha: main ? 0.55 : 0.42, violet: 0.35, seed: 23 + (main ? 0 : 40), reach: 0.26 },
      ];
      var curtains = defs.map(function (o) {
        var b = {}; for (var k in o) b[k] = o[k];
        b.seed = o.seed + 5; b.base = o.base + 0.004; b.u0 = o.u0 + 0.05;
        return [curtain(TW, TH, o), curtain(TW, TH, b)];
      });
      var aur = K.canvas(W, horizon), aux = aur.getContext('2d');
      var skyGlow = K.bloom('80, 210, 160', 2.4);

      // The near shore: an uneven snow bank, high on the outer side and sweeping down;
      // a few irregular spruces there, none on the inner side, so the lake stays open.
      var SW = s.SW, SH = s.SH;
      function bankY(u) {
        var v = ou(u);
        return SH * (main ? 0.985 - 0.2 * Math.exp(-Math.pow(v / 0.3, 2)) - 0.025 * Math.exp(-Math.pow((v - 0.8) / 0.18, 2))
          : 0.99 - 0.12 * Math.exp(-Math.pow(v / 0.22, 2))) + SH * 0.006 * K.noise1(u * 9, 2);
      }
      var bank = new Path2D();
      bank.moveTo(0, SH + 2);
      for (var bu = 0; bu <= 1.0001; bu += 0.005) bank.lineTo(bu * SW, bankY(bu));
      bank.lineTo(SW, SH + 2); bank.closePath();
      var snowTop = Math.floor(SH * 0.74);
      var bankLight = s.sprite(SW, SH - snowTop, function (cx, w, h) {
        var c = K.canvas(w, h), x = c.getContext('2d');
        x.translate(0, -snowTop); x.fillStyle = '#000'; x.fill(bank);
        cx.drawImage(K.rimLayer(c, 0, -1, SH * 0.045, '100, 200, 170', 0.42, 10), 0, 0);
      });

      var setBank = quiet(bankLight);
      // 0..1..0 over a long period: drifts that turn round instead of jumping back
      function tri(x) { var f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; }
      var pf = { x: 0, y: 0 };
      return {
        paint: function (ctx, t, p) {
          // The display builds: one ribbon at first, a second and a third later, taller
          // and turning violet at the top towards the end.
          var strength = 0.42 + 0.58 * K.smooth(p / 0.75);
          var grow = 0.78 + 0.32 * K.smooth(p);
          var alphas = [0.55 + 0.45 * strength, K.smooth((p - 0.12) / 0.35), K.smooth((p - 0.42) / 0.35)];
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(sky, 0, 0);
          ctx.globalAlpha = 0.85 + 0.15 * K.noise1(t * 0.05, 2);
          ctx.drawImage(stars.bright, 0, 0);
          ctx.globalAlpha = 1; ctx.drawImage(steady, 0, 0);
          ctx.globalAlpha = 1;
          K.light(ctx, skyGlow, W * u0, horizon * 0.62, W * 0.6, 0.12 * strength, H * 0.42);

          aux.globalCompositeOperation = 'source-over'; aux.globalAlpha = 1;
          aux.clearRect(0, 0, W, horizon);
          aux.globalCompositeOperation = 'lighter';
          for (var i = 0; i < curtains.length; i++) {
            if (alphas[i] <= 0.01) continue;
            // the two textures of a ribbon drift apart at about 1 px/s and trade
            // weight over 40-60 s: its folds change shape, its total light does not pulse
            var sw = 0.5 + 0.22 * Math.sin(t * 2 * Math.PI / (52 + i * 14) + i * 2);
            var dA = -56 + 50 * tri(t * 0.0045 + i * 0.3), dB = -6 - 50 * tri(t * 0.0037 + i * 0.55);
            var tilt = 0.035 * K.noise1(t / 63 + i * 3, i);
            var gh = TH * grow, gy = TH - gh;
            aux.setTransform(1, tilt, 0, 1, 0, -tilt * W * 0.5);
            aux.globalAlpha = alphas[i] * sw; aux.drawImage(curtains[i][0], dA, gy, TW, gh);
            aux.globalAlpha = alphas[i] * (1 - sw); aux.drawImage(curtains[i][1], dB, gy, TW, gh);
          }
          aux.setTransform(1, 0, 0, 1, 0, 0);
          // the hue shifts over the break: tops go violet, a faint rose fringe appears below
          var vio = 0.18 + 0.5 * K.smooth((p - 0.25) / 0.6);
          aux.globalCompositeOperation = 'source-atop'; aux.globalAlpha = 1;
          aux.fillStyle = K.linear(aux, 0, 0, 0, horizon, [[0, 'rgba(170, 90, 220, ' + vio.toFixed(3) + ')'],
            [0.45, 'rgba(110, 110, 230, ' + (vio * 0.4).toFixed(3) + ')'], [0.7, 'rgba(110, 230, 190, 0)'], [1, 'rgba(110, 230, 190, 0)']]);
          aux.fillRect(0, 0, W, horizon);
          aux.globalCompositeOperation = 'source-over';

          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(aur, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          pf = s.par(0.12);
          ctx.drawImage(land, pf.x, pf.y);
          ctx.globalAlpha = 0.35 + 0.65 * strength; ctx.drawImage(lit, pf.x, pf.y);
          ctx.globalAlpha = 1;
          ctx.drawImage(lake, 0, 0);
          // the aurora in the water: darker, squashed, broken into bands
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.3;
          var n = 6, depth = H - horizon, sq = 1.6;
          for (var b = 0; b < n; b++) {
            var d0 = depth * Math.pow(b / n, 1.4), d1 = depth * Math.pow((b + 1) / n, 1.4);
            var sy0 = horizon - d1 * sq, sy1 = horizon - d0 * sq;
            if (sy1 <= 0) break;
            sy0 = Math.max(0, sy0);
            var off = (1 + b * 0.5) * K.noise1(t * 0.07 + b * 1.9, 5);
            ctx.setTransform(1, 0, 0, -1, off, 2 * horizon);
            ctx.drawImage(aur, 0, sy0, W, sy1 - sy0, 0, horizon - d0 - (sy1 - sy0) / sq, W, (sy1 - sy0) / sq);
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          setBank(0, snowTop, 0, 0.3 + 0.7 * strength);
        },

        front: function (fx) {
          var r = K.seeded(4410 + (main ? 0 : 7));
          // subdued middle trees on a low spit of the far shore, outer side
          var spit = new Path2D(), sx0 = outer < 0 ? 0 : SW, sd = outer < 0 ? 1 : -1, hz = SH * 0.62;
          spit.moveTo(sx0, hz + 1);
          for (var su = 0; su <= 0.3; su += 0.004) spit.lineTo(sx0 + sd * su * SW, hz - SH * 0.012 * K.smooth((0.3 - su) / 0.25));
          spit.lineTo(sx0 + sd * 0.3 * SW, hz + 1); spit.closePath();
          var mid = K.aerial('#071420', haze, 0.3);
          fx.fillStyle = mid; fx.fill(spit);
          for (var m = 0; m < (main ? 26 : 12); m++) {
            var mu = Math.pow(r(), 1.4) * 0.26, mh = SH * (0.02 + 0.035 * r()) * (1 - mu * 2);
            spruce(fx, r, sx0 + sd * mu * SW, hz - SH * 0.008, mh, mh * 0.34, mid, null, (r() - 0.5) * 0.04);
          }
          // the bank on its own layer: drawn under the trees and again over their feet, so they
          // stand in the snow rather than on it
          var bk = K.canvas(SW, SH), bx = bk.getContext('2d');
          bx.fillStyle = K.linear(bx, 0, SH * 0.78, 0, SH, [[0, '#8fa3b9'], [0.3, '#5f7593'], [1, '#1d2b42']]);
          bx.fill(bank);
          // shadows on the bank are cool, #172d40
          bx.save(); bx.clip(bank);
          bx.fillStyle = 'rgba(23, 45, 64, 0.45)';
          for (var dsh = 0; dsh < 5; dsh++) {
            bx.beginPath();
            bx.ellipse(SW * r(), SH * (0.9 + 0.08 * r()), SW * (0.05 + 0.08 * r()), SH * 0.012, 0, 0, Math.PI * 2);
            bx.fill();
          }
          bx.restore();
          fx.drawImage(bk, 0, 0);
          // the few near spruces: irregular, one leaning, one half bare, their bases under the snow line
          var trees = main ? [[0.04, 0.6, 0.1, -0.01, 0], [0.105, 0.43, 0.08, 0.02, 0.25], [0.15, 0.27, 0.06, -0.03, 0],
            [0.215, 0.14, 0.04, 0.01, 0.4]] : [[0.05, 0.34, 0.07, 0.015, 0], [0.1, 0.2, 0.05, -0.02, 0.3]];
          var tl = K.canvas(SW, SH), tx = tl.getContext('2d'), feet = [];
          trees.forEach(function (tr) {
            var u = outer < 0 ? tr[0] : 1 - tr[0], x = SW * u, h = SH * tr[1];
            var base = bankY(u) + h * 0.07;
            feet.push([x, bankY(u), h]);
            spruce(tx, r, x, base, h, SH * tr[2] * 2.2, '#030810', 'rgba(150, 175, 196, 0.85)', tr[3], tr[4]);
          });
          K.rim(tl, 0, -1, 2, '120, 225, 185', 0.35, 1);
          fx.drawImage(tl, 0, 0);
          fx.drawImage(bk, 0, 0);
          // soft contact shadows on the snow, falling away from where the aurora is brightest
          fx.save(); fx.clip(bank); fx.filter = 'blur(6px)';
          feet.forEach(function (f) {
            fx.fillStyle = 'rgba(16, 32, 50, 0.4)';
            fx.beginPath(); fx.ellipse(f[0] - inner * f[2] * 0.06, f[1] + f[2] * 0.012, f[2] * 0.13, f[2] * 0.022, 0, 0, Math.PI * 2); fx.fill();
          });
          fx.restore();
        },
      };
    },

    lofi: {
      key: 'B', mode: 'lydian', bpm: 64, swing: 0.58, swing8: true,
      progs: ['Imaj9 II Imaj7#11 II', 'vi9 II Imaj9 Imaj9', 'Imaj9 iii7 II Imaj7#11'],
      keys: { inst: 'vibes', style: 'hold', range: [57, 79], level: 0.9 },
      lead: { inst: 'piano', range: [66, 88], level: 0.59, motif: '0.4.1 4.4.2 8.8.3 | 2.12.4' },
      reply: { inst: 'piano', shift: -12, level: 0.6 },
      pad: { inst: 'bowed', range: [57, 72], fifth: true, level: 1, in: ['release', 'thin', 'outro'] },
      bass: { style: 'long', level: 0.66 },
      drums: { style: 'half', kit: 'brushes', hat: 'none', level: 0.75 },
      fx: { tone: 5200, crackle: 0.25, hiss: 0.3, wow: 0.8, room: 0.55, verb: 2.2, echo: 0.75, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // Cold wind: pink noise through a slowly wandering band.
      var windG = K.gain(ac, 0.1, out);
      var bp = K.filter(ac, 'bandpass', 520, 0.9, windG);
      K.loop(ac, K.noise(ac, 'pink', 8), bp, t0);
      K.lfo(ac, 0.031, 260, bp.frequency, 'sine', t0);
      K.lfo(ac, 0.047, 0.065, windG.gain, 'sine', t0);
      return function () {};
    },
  });
})();

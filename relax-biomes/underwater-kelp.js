// Underwater kelp - a kelp forest swaying in the swell under a rippling
// surface, soft rays of light reaching down, caustics on the sand, a few
// bubbles now and then; a broad shadow drifts across the light from above.
// Music: lo-fi in D-flat lydian (60 bpm), as if heard through water: dark Rhodes-like
// chords, vibraphone dyads, kalimba, bowed vibes, upright bass, a soft kick; whale call, bubbles.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A giant kelp: a thin stipe anchored on the floor, rising to the surface and lying
  // along it in the current. Its blades are long narrow ribbons (5-8 times longer than
  // wide) with wavy edges and a small gas bladder at the base, trailing up and with the
  // current; a few hang from the stretch at the surface. Built once; `draw` bends it
  // every frame (the tip sways most, a little later than the middle).
  function kelpPlant(rnd, x, base, top, o) {
    var blades = [];
    for (var i = 0; i < o.blades; i++) {
      var q = 0.1 + 0.74 * Math.pow(rnd(), 0.75);
      if (rnd() < 0.25 && q > 0.3 && q < 0.6) continue; // a bare stretch now and then
      blades.push({ q: q, side: rnd() < 0.5 ? 1 : -1, len: o.len * (0.6 + 0.8 * rnd()), w: 0.12 + 0.07 * rnd(),
        lift: rnd(), ph: rnd() * 6.3 });
    }
    for (var h = 0; h < (o.hang || 0); h++) {
      blades.push({ q: 0.88 + 0.1 * rnd(), side: rnd() < 0.5 ? 1 : -1, len: o.len * (0.8 + 0.6 * rnd()), w: 0.11 + 0.05 * rnd(),
        lift: rnd(), ph: rnd() * 6.3 });
    }
    return { x: x, base: base, top: top, blades: blades, ph: rnd() * 6.3, per: o.per * (0.85 + 0.3 * rnd()),
      amp: o.amp * (0.8 + 0.4 * rnd()), lean: o.lean * (0.6 + 0.8 * rnd()), stipe: o.stipe, col: o.col, lit: o.lit || o.col,
      lw: o.lw, run: o.run, floats: o.floats || 0, bow: (o.bow || 0) * (rnd() - 0.5) * 2 };
  }
  function ribbon(ctx, bl, px, py, ang0, t, per, cur, floats) {
    var L = bl.len, n = 8, step = L / n, cx = px, cy = py, left = [], right = [];
    for (var k = 0; k <= n; k++) {
      var sk = k / n;
      // the ribbon bends further into the current along its length and waves slowly
      var a = ang0 + cur * 0.4 * sk * sk + 0.22 * sk * Math.sin(2 * Math.PI * t / (per * 0.8) + bl.ph - sk * 2.6);
      var hw = L * bl.w * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, sk * 1.12 + 0.06)), 0.7) *
        (1 + 0.25 * Math.sin(sk * 15 + bl.ph + t * 0.3));
      var nx = -Math.sin(a), ny = Math.cos(a);
      left.push([cx + nx * hw, cy + ny * hw]); right.push([cx - nx * hw, cy - ny * hw]);
      cx += Math.cos(a) * step; cy += Math.sin(a) * step;
    }
    ctx.moveTo(px, py);
    for (var i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    ctx.lineTo(cx, cy);
    for (var j = right.length - 1; j >= 1; j--) ctx.lineTo(right[j][0], right[j][1]);
    ctx.closePath();
    if (floats) {
      var bx = px + Math.cos(ang0) * floats * 1.4, by = py + Math.sin(ang0) * floats * 1.4;
      ctx.moveTo(bx + floats, by); ctx.ellipse(bx, by, floats, floats * 0.8, ang0, 0, Math.PI * 2);
    }
  }
  function drawKelp(ctx, kp, t, cur) {
    var segs = 16, pts = [];
    for (var i = 0; i <= segs; i++) {
      var q = i / segs;
      var sway = kp.amp * Math.pow(q, 1.5) * Math.sin(2 * Math.PI * t / kp.per + kp.ph - q * 1.6);
      var y = kp.base + (kp.top - kp.base) * q;
      var x = kp.x + kp.lean * q * q + sway + kp.bow * Math.sin(q * 3.2 + kp.ph) * q;
      if (q > 0.7) { var k = K.smooth((q - 0.7) / 0.3); x += cur * kp.run * k * k * 1.1; y += (kp.base - kp.top) * 0.03 * k * k; }
      pts.push([x, y]);
    }
    // the stipe: a ribbon that tapers from a thick base to a thin tip
    var lft = [], rgt = [];
    for (var j = 0; j < pts.length; j++) {
      var a0 = pts[Math.max(0, j - 1)], a1 = pts[Math.min(segs, j + 1)];
      var tx = a1[0] - a0[0], ty = a1[1] - a0[1], tl = Math.hypot(tx, ty) || 1;
      var hw = kp.lw * (1.3 - 0.95 * j / segs);
      lft.push([pts[j][0] - ty / tl * hw, pts[j][1] + tx / tl * hw]); rgt.push([pts[j][0] + ty / tl * hw, pts[j][1] - tx / tl * hw]);
    }
    ctx.fillStyle = kp.stipe;
    ctx.beginPath(); ctx.moveTo(lft[0][0], lft[0][1]);
    for (var l2 = 1; l2 < lft.length; l2++) ctx.lineTo(lft[l2][0], lft[l2][1]);
    for (var r2 = rgt.length - 1; r2 >= 0; r2--) ctx.lineTo(rgt[r2][0], rgt[r2][1]);
    ctx.closePath(); ctx.fill();
    // two passes: the lower blades in shade, the upper ones lit through from the surface
    for (var pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? kp.lit : kp.col;
      ctx.beginPath();
      for (var b = 0; b < kp.blades.length; b++) {
        var bl = kp.blades[b];
        if ((bl.q > 0.5 ? 1 : 0) !== pass) continue;
        var fi = bl.q * segs, i0 = Math.floor(fi), fr = fi - i0, i1 = Math.min(segs, i0 + 1);
        var px = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * fr, py = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * fr;
        var up = Math.atan2(pts[i1][1] - pts[i0][1], pts[i1][0] - pts[i0][0]);
        var ang = bl.q > 0.86 ? Math.PI / 2 + bl.side * (0.15 + 0.35 * bl.lift) - cur * 0.25
          : up + bl.side * (0.12 + 0.3 * bl.lift) + cur * 0.25;
        ribbon(ctx, bl, px, py, ang, t, kp.per, cur, kp.floats);
      }
      ctx.fill();
    }
  }

  RelaxBiomes.register({
    id: 'underwater-kelp',
    name: 'Kelp forest',
    about: 'A kelp forest swaying under a rippling surface, broad rays of light, caustics on the sand, a broad shadow drifting slowly across the light from above. Muffled lo-fi in D-flat lydian: dark electric-piano chords, vibraphone dyads, kalimba, bowed vibraphone, upright bass, a soft kick, whale call, bubbles.',
    ink: '222, 246, 250',
    shade: '2, 16, 30',
    vignette: 0.34,
    scale: 3,
    grade: { shadow: '4, 18, 34', light: '240, 252, 250' },
    level: 0.778, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.543,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var surf = H * 0.085, floorY = H * 0.84;
      // The sun stands over the main screen, a little towards the other one; the current
      // runs towards the outer side.
      var sunX = main ? W * (0.5 + 0.18 * inner) : (inner > 0 ? W * 1.05 : -W * 0.05);
      var cur = outer;

      // The water itself, absorbing light with depth, and the far reef: painted once.
      var bg = s.layer(), bx = bg.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, 0, H, [[0, '#6cc4c6'], [0.09, '#3d9eae'], [0.3, '#1f7a92'], [0.6, '#11546f'],
        [0.86, '#0a3550'], [1, '#062539']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'lighter';
      bx.fillStyle = K.radial(bx, sunX, 0, W * 0.6, [[0, 'rgba(170, 245, 235, 0.32)'], [1, 'rgba(120, 220, 230, 0)']]);
      bx.fillRect(0, 0, W, H);
      bx.globalCompositeOperation = 'source-over';
      // far silhouettes, barely there, then the distant kelp in blue: absorption takes the colour
      var farKelp = s.layer(), fk = farKelp.getContext('2d');
      [[0.97, 9, 0.16], [0.82, 7, 0.28]].forEach(function (layer, li) {
        for (var i = 0; i < layer[1]; i++) {
          var u = rnd();
          if (main && Math.abs(u - 0.5) < 0.1) u += 0.22 * (u < 0.5 ? -1 : 1);
          var kp = kelpPlant(rnd, u * W, floorY - H * 0.05 * (1 - li), surf + H * 0.04, { blades: 7, len: H * 0.09, per: 22, amp: 0,
            lean: W * 0.02 * cur, stipe: K.aerial('#287a80', '#4fa7b6', layer[0], layer[2]), col: K.aerial('#287f98', '#4fa7b6', layer[0], layer[2]),
            lw: 1, run: W * 0.04 });
          drawKelp(fk, kp, 0, cur);
        }
      });
      // the floor: low dunes of sand, a few rocks with soft weed, the reef on the outer side
      bx.fillStyle = K.aerial('#0e4a62', '#2f8ea4', 0.5);
      bx.fill(K.ridge(0, W, 3, function (x) { return floorY - H * (0.04 + 0.03 * K.noise1(x / W * 3, 2) + 0.012 * K.noise1(x / W * 11, 3)); }, H));
      bx.fillStyle = K.linear(bx, 0, floorY - H * 0.02, 0, H, [[0, '#2d6f7a'], [0.4, '#1d5262'], [1, '#0b2c3d']]);
      bx.fill(K.ridge(0, W, 3, function (x) { return floorY + H * 0.018 * K.noise1(x / W * 2.5, 5) + H * 0.006 * K.noise1(x / W * 9, 6); }, H));
      for (var r = 0; r < 6; r++) {
        var ru = rnd(); if (main && Math.abs(ru - 0.5) < 0.08) ru += 0.15;
        var rx = ru * W, ry = floorY + H * (0.03 + 0.08 * rnd()), rw = H * (0.025 + 0.04 * rnd());
        bx.fillStyle = '#0a2d3e';
        bx.beginPath(); bx.ellipse(rx, ry, rw, rw * 0.55, 0, Math.PI, 0); bx.fill();
        bx.fillStyle = 'rgba(110, 190, 190, 0.14)';
        bx.beginPath(); bx.ellipse(rx - rw * 0.15, ry - rw * 0.38, rw * 0.55, rw * 0.13, 0, Math.PI, 0); bx.fill();
      }
      var reefX = outer < 0 ? 0 : W;
      bx.fillStyle = '#0a2a3a';
      bx.beginPath(); bx.moveTo(reefX, H);
      for (var ru2 = 0; ru2 <= 0.2; ru2 += 0.01) {
        bx.lineTo(reefX - outer * ru2 * W, floorY - H * (0.12 * K.smooth((0.2 - ru2) / 0.17) + 0.02 * K.noise1(ru2 * 30, 8)));
      }
      bx.lineTo(reefX - outer * 0.22 * W, H); bx.closePath(); bx.fill();

      // The underside of the surface: it mirrors the water below, broken by the ripples.
      var below = s.layer(W, H - surf), blx = below.getContext('2d');
      blx.drawImage(bg, 0, -surf); blx.drawImage(farKelp, 0, -surf);

      // Caustics: two soft patterns, each distorted differently, crossfaded on the sand.
      function caustic(seed, fx, fy) {
        return K.field(Math.ceil(W / 2), Math.ceil(H * 0.12), function (u, v, out) {
          var wx = u + 0.04 * K.noise2(u * 3, v * 3, seed + 1);
          var n = Math.abs(K.noise2(wx * fx, v * fy, seed) + 0.5 * K.noise2(wx * fx * 2.1, v * fy * 2.1, seed + 3));
          var a = Math.pow(Math.max(0, 1 - n * 2.6), 2.4) * Math.sin(Math.PI * v) * 0.5;
          if (a <= 0.01) return null;
          out[0] = 200; out[1] = 250; out[2] = 236; out[3] = a; return out;
        });
      }
      var causA = caustic(3, 14, 3.2), causB = caustic(17, 11, 2.7);

      // Three broad shafts from the surface, fanning from the sun; a second set a little
      // further over, crossfaded as the sun moves.
      function shafts(dx, seed) {
        return K.rays(W, H, { x: sunX + dx, y: -H * 0.7, angle: 0.08 * cur, spread: main ? 0.42 : 0.25, count: 3, length: H * 1.75,
          width: W * 0.09, rgb: '190, 246, 238', alpha: main ? 0.46 : 0.28, seed: seed, patchy: 0.45 });
      }
      var raysA = shafts(0, 4), raysB = shafts(-cur * W * 0.12, 11);

      // Kelp in three clusters around an open corridor: a near one on the outer side
      // (olive, the most detail), a middle one in teal on the inner side, one far back.
      var plants = [];
      function cluster(cu, n, spread, depth) {
        for (var i = 0; i < n; i++) {
          var u = cu + (rnd() - 0.5) * spread;
          var near = depth > 0.7;
          var baseY = near ? floorY + H * (0.07 + 0.03 * rnd()) : floorY + H * 0.03 * depth;
          plants.push({ d: depth, kp: kelpPlant(rnd, u * W, baseY, surf + H * 0.01, {
            blades: near ? 15 : 9, hang: near ? 3 : 1, len: H * (near ? 0.19 : 0.12), per: 16 + 9 * rnd(), floats: near ? 1.3 : 0.8,
            bow: W * (near ? 0.03 : 0.02),
            amp: W * (near ? 0.016 : 0.01), lean: W * 0.04 * cur, run: W * (near ? 0.12 : 0.08),
            stipe: near ? 'rgba(59, 74, 46, 0.8)' : K.aerial('#1f6670', '#3f9aac', 0.35 + (0.7 - depth) * 0.5, 0.55),
            col: near ? 'rgba(78, 96, 64, 0.88)' : K.aerial('#287a80', '#3f9aac', 0.3 + (0.7 - depth) * 0.5, 0.85),
            lit: near ? 'rgba(124, 134, 78, 0.78)' : K.aerial('#3a8e8a', '#5fb6be', 0.3 + (0.7 - depth) * 0.5, 0.75),
            lw: near ? 2.2 : 0.9 }) });
        }
      }
      if (main) {
        cluster(0.5 + 0.37 * outer, 3, 0.14, 0.85);
        cluster(0.5 + 0.3 * inner, 3, 0.12, 0.5);
        cluster(0.5 - 0.1 * inner, 2, 0.08, 0.3);
      } else {
        cluster(0.5 + 0.3 * outer, 3, 0.18, 0.85);
        cluster(0.5 - 0.15 * outer, 4, 0.22, 0.45);
      }
      plants.sort(function (a, b) { return a.d - b.d; });
      // Only the near cluster bends frame by frame; the farther ones are painted once and
      // drift as a whole by a pixel or two - at that distance nobody sees the difference.
      var midKelp = s.layer(), mk = midKelp.getContext('2d');
      plants = plants.filter(function (pl) { if (pl.d > 0.7) return true; drawKelp(mk, pl.kp, 0, cur); return false; });
      // the near plants' rocks and holdfasts: a dark rounded stone under each, lit on top, with
      // the holdfast's root-like branches gripping it
      var rocksNear = s.layer(), rn = rocksNear.getContext('2d');
      plants.forEach(function (pl) {
        var kp = pl.kp, rw = H * (0.045 + 0.03 * rnd()), rh = rw * (0.55 + 0.2 * rnd());
        var ry = kp.base + rh * 0.35;
        rn.fillStyle = K.linear(rn, 0, ry - rh, 0, ry + rh * 0.6, [[0, '#2e5560'], [0.35, '#173a48'], [1, '#0a2333']]);
        rn.beginPath();
        rn.moveTo(kp.x - rw, ry + rh * 0.6);
        rn.bezierCurveTo(kp.x - rw * 1.05, ry - rh * 0.4, kp.x - rw * 0.3, ry - rh * 1.05, kp.x + rw * 0.15, ry - rh);
        rn.bezierCurveTo(kp.x + rw * 0.75, ry - rh * 0.9, kp.x + rw * 1.1, ry - rh * 0.1, kp.x + rw, ry + rh * 0.6);
        rn.closePath(); rn.fill();
        rn.strokeStyle = 'rgba(52, 66, 40, 0.92)'; rn.lineCap = 'round';
        for (var h = 0; h < 8; h++) {
          var ang = Math.PI * (0.08 + 0.84 * h / 7) + (rnd() - 0.5) * 0.2, len = rw * (0.45 + 0.4 * rnd());
          var ex = kp.x + Math.cos(ang) * len, ey = kp.base + Math.sin(ang) * len * 0.35 - rh * 0.1;
          rn.lineWidth = 1 + rnd() * 1.2;
          rn.beginPath(); rn.moveTo(kp.x, kp.base - 1);
          rn.quadraticCurveTo(kp.x + Math.cos(ang) * len * 0.5, kp.base - rh * 0.25, ex, ey + rh * 0.3);
          rn.stroke();
        }
      });

      // 16 specks in suspension; a few bubbles from the reef now and then.
      var specks = [];
      for (var m = 0; m < 16; m++) specks.push({ x: rnd() * W, y: surf + rnd() * (floorY - surf), ph: rnd() * 50, big: m < 5 });
      var bubble = K.canvas(8, 8), bbx = bubble.getContext('2d');
      bbx.strokeStyle = 'rgba(220, 255, 255, 0.55)'; bbx.lineWidth = 1; bbx.beginPath(); bbx.arc(4, 4, 3, 0, Math.PI * 2); bbx.stroke();
      bbx.fillStyle = 'rgba(255, 255, 255, 0.7)'; bbx.fillRect(2.5, 2.5, 1, 1);
      var bubbleX = reefX - outer * W * 0.12, bubbleEvery = 37;
      var sheen = K.bloom('210, 255, 245', 1.6);
      function underside(seed, fx) {
        return K.field(Math.ceil(W / 2), Math.ceil(surf * 1.7), function (u, v, out) {
          var n = K.noise2(u * fx, v * 5, seed) + 0.5 * K.noise2(u * fx * 2.2, v * 11, seed + 1);
          var net = Math.pow(Math.max(0, 1 - Math.abs(n) * 2.4), 2.2);
          var fade = Math.pow(1 - v, 1.8);
          var cover = K.smooth((K.noise2(u * 3, v * 1.5, seed + 9) + 0.15) / 0.35); // broken, not a ceiling
          var a = net * 0.22 * cover * fade;
          if (a <= 0.004) return null;
          out[0] = 214; out[1] = 252; out[2] = 246; out[3] = a; return out;
        });
      }
      var surfTex = underside(51, 34), surfTex2 = underside(57, 22);
      // broad light under the surface: wide soft patches, brighter towards the sun
      var surfGlow = K.field(Math.ceil(W / 4), Math.ceil(surf * 3 / 2), function (u, v, out) {
        var n = K.fbm2(u * 4, v * 1.2, 3, 81) * 0.5 + 0.5;
        var a = (0.12 + 0.3 * n) * Math.pow(1 - v, 1.5) * (0.6 + 0.4 * Math.exp(-Math.pow((u * W - sunX) / (W * 0.4), 2)));
        out[0] = 196; out[1] = 246; out[2] = 238; out[3] = a; return out;
      });
      // the shadow of something broad passing over the surface, crossing the scene slowly
      var passShade = K.field(64, 32, function (u, v, out) {
        out[0] = 6; out[1] = 26; out[2] = 44; out[3] = 0.42 * Math.pow(Math.sin(Math.PI * u), 2) * (0.85 + 0.15 * v); return out;
      });
      var shadePer = 115, shadeOff = rnd() * shadePer;

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bg, 0, 0);
          var pf = s.par(0.1);
          ctx.drawImage(farKelp, pf.x, 0);
          // the surface from below: the water mirrored and rippling, a bright window over the sun
          // (bands fade out towards the waterline so there is no edge, only the rippled underside)
          for (var rb = 0; rb < 7; rb++) {
            var y0 = surf * rb / 7, y1 = surf * (rb + 1) / 7 + 0.5;
            var off = 3 * (1 - rb / 7) * K.noise1(t * 0.3 + rb * 1.37, 2);
            ctx.globalAlpha = 0.55 * Math.pow(1 - rb / 7, 1.3);
            ctx.drawImage(below, 0, surf - y1, W, y1 - y0, off - 4, y0, W + 8, y1 - y0);
          }
          ctx.globalAlpha = 1;
          var dim = 1 - 0.2 * K.smooth(p); // the sun lower: the source weakens a little
          K.light(ctx, sheen, sunX + Math.sin(t / 19) * W * 0.01, surf * 0.2, W * 0.45, 0.32 * dim, surf * 2.6);
          // the shafts: they drift over with the sun and fade as the light goes
          ctx.globalCompositeOperation = 'lighter';
          var sw = K.smooth(p * 1.1), br = (0.8 + 0.2 * K.noise1(t / 27, 3)) * dim;
          ctx.globalAlpha = (1 - sw) * br; ctx.drawImage(raysA, 0, 0);
          ctx.globalAlpha = sw * br; ctx.drawImage(raysB, 0, 0);
          // caustics on the sand: two patterns crossfading and drifting apart
          var cx = K.noise1(t / 40, 5) * W * 0.03, cf = 0.5 + 0.5 * K.noise1(t / 13, 6);
          ctx.globalAlpha = 0.62 * cf * dim; ctx.drawImage(causA, cx - W * 0.03, floorY - H * 0.01, W * 1.06, H * 0.13);
          ctx.globalAlpha = 0.62 * (1 - cf) * dim; ctx.drawImage(causB, -cx - W * 0.03, floorY + H * 0.01, W * 1.06, H * 0.13);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          // the underside of the surface: a net of bright ripples, two layers drifting apart,
          // fading out downwards so the surface has no edge
          ctx.globalCompositeOperation = 'lighter';
          var u1 = ((t * 0.35) % W + W) % W, u2 = ((-t * 0.22) % W + W) % W, u3 = ((t * 0.12) % W + W) % W;
          ctx.globalAlpha = dim; ctx.drawImage(surfGlow, u3 - W, 0, W, surf * 1.5); ctx.drawImage(surfGlow, u3, 0, W, surf * 1.5);
          ctx.globalAlpha = 0.6 * dim; ctx.drawImage(surfTex, u1 - W, 0, W, surfTex.height); ctx.drawImage(surfTex, u1, 0, W, surfTex.height);
          ctx.globalAlpha = 0.4 * dim; ctx.drawImage(surfTex2, u2 - W, 0, W, surfTex2.height); ctx.drawImage(surfTex2, u2, 0, W, surfTex2.height);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          // the kelp, back to front
          ctx.drawImage(midKelp, K.noise1(t / 21, 12) * W * 0.004, 0);
          for (var k = 0; k < plants.length; k++) drawKelp(ctx, plants[k].kp, t, cur);
          ctx.drawImage(rocksNear, 0, 0);
          // specks in suspension, drifting 1-3 px a second
          ctx.fillStyle = 'rgba(210, 250, 240, 0.55)';
          for (var g = 0; g < 2; g++) {
            ctx.globalAlpha = g ? 0.5 * dim + 0.2 : 0.3;
            ctx.beginPath();
            for (var i = 0; i < specks.length; i++) {
              var sp = specks[i];
              if (sp.big !== (g === 1)) continue;
              var sx = ((sp.x + t * 0.25 * cur + K.noise1(t * 0.05 + sp.ph, 1) * 8) % W + W) % W;
              var sy = sp.y + K.noise1(t * 0.04 + sp.ph, 2) * 10;
              ctx.rect(sx, sy, g ? 1.2 : 0.8, g ? 1.2 : 0.8);
            }
            ctx.fill();
          }
          // a few bubbles from the reef, every half minute or so
          var bt = (t % bubbleEvery) / 6;
          if (bt < 1.6) {
            ctx.globalAlpha = 0.75;
            for (var bI = 0; bI < 5; bI++) {
              var life = bt - bI * 0.13;
              if (life < 0 || life > 1.2) continue;
              var bxp = bubbleX + Math.sin(t * 2 + bI * 1.7) * 1.5 + life * W * 0.01;
              var byp = floorY - H * 0.1 - life * (floorY - surf) * 0.7;
              var sz = 3 + life * 3;
              ctx.drawImage(bubble, bxp - sz / 2, byp - sz / 2, sz, sz);
            }
          }
          ctx.globalAlpha = 1;
          // a broad shadow drifts across the whole scene every couple of minutes, taking the
          // shafts and caustics with it where it passes
          var sxp = (((t + shadeOff) / shadePer) % 1) * W * 1.9 - W * 0.8;
          ctx.drawImage(passShade, sxp, 0, W * 0.8, H);
        },
      };
    },

    lofi: {
      key: 'Db', mode: 'lydian', bpm: 60, swing: 0.56, swing8: true,
      progs: ['Imaj7#11 II Imaj7#11 II', 'Imaj9 vi9 iii7 II', 'vi9 II Imaj9 Imaj9'],
      keys: { inst: 'piano', style: 'hold', range: [50, 72], size: 3, ep: true, tone: 2600, level: 1 },
      lead: { inst: 'vibes', range: [58, 82], level: 0.53, tone: 2800, motif: '0.6.3+5 8.6.5+7 | 0.6.4+6 8.8.2+4' },
      reply: { inst: 'kalimba', shift: 12, level: 0.62 },
      pad: { inst: 'bowed', range: [57, 72], fifth: true, level: 1, in: ['release', 'return', 'outro'] },
      bass: { style: 'long', level: 0.89 },
      drums: { style: 'half', snare: 'tap', hat: 'shaker', level: 0.55 },
      fx: { tone: 3400, drumTone: 4500, crackle: 0.15, hiss: 0.2, wow: 1.2, room: 0.6, verb: 1.3, echo: 0.75, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 5, 2.2, out, 0.18);
      // everything as if through water: a low, slowly moving filter
      var sea = K.filter(ac, 'lowpass', 900, 0.7, out);
      K.lfo(ac, 0.05, 300, sea.frequency, 'sine', t0);
      sea.connect(K.gain(ac, 0.7, rv));
      var nextWhale = t0 + 12, nextBub = t0 + 2;
      // the deep hush
      var deep = K.gain(ac, 0.13, out);
      K.loop(ac, K.noise(ac, 'brown', 8), K.filter(ac, 'lowpass', 200, 0.5, deep), t0);
      K.lfo(ac, 0.06, 0.055, deep.gain, 'sine', t0);

      return function schedule(until) {
        while (nextWhale < until) { // a long low call from far away
          var o = ac.createOscillator(); var og = ac.createGain(); var w = nextWhale;
          var f0 = 180 + Math.random() * 80;
          o.frequency.setValueAtTime(f0, w);
          o.frequency.linearRampToValueAtTime(f0 * (1.4 + Math.random() * 0.4), w + 1.8);
          o.frequency.linearRampToValueAtTime(f0 * 1.15, w + 3.6);
          o.frequency.linearRampToValueAtTime(f0 * 0.8, w + 5);
          og.gain.setValueAtTime(0.0001, w); og.gain.linearRampToValueAtTime(0.03, w + 1.2);
          og.gain.setValueAtTime(0.03, w + 3.8); og.gain.linearRampToValueAtTime(0.0001, w + 5.2);
          K.lfo(ac, 5, 4, o.detune, 'sine', w).stop(w + 5.4);
          o.connect(og); og.connect(K.panner(ac, Math.random() * 1.2 - 0.6, rv)); og.connect(sea);
          o.start(w); o.stop(w + 5.4);
          nextWhale = w + 24 + Math.random() * 18;
        }
        while (nextBub < until) { // bubbles: little upward blips, in clusters
          var bb = nextBub; var n = 2 + Math.floor(Math.random() * 5);
          var pan = Math.random() * 1.4 - 0.7;
          for (var q = 0; q < n; q++) {
            var bo = ac.createOscillator(); var bg = ac.createGain(); var f = 500 + Math.random() * 700;
            bo.frequency.setValueAtTime(f, bb); bo.frequency.exponentialRampToValueAtTime(f * 2.2, bb + 0.05);
            bg.gain.setValueAtTime(0.0001, bb); bg.gain.linearRampToValueAtTime(0.012, bb + 0.005);
            bg.gain.exponentialRampToValueAtTime(0.0001, bb + 0.07);
            bo.connect(bg); bg.connect(K.panner(ac, pan, out)); bo.start(bb); bo.stop(bb + 0.08);
            bb += 0.06 + Math.random() * 0.12;
          }
          nextBub = bb + 1.5 + Math.random() * 4;
        }
      };
    },
  });
})();

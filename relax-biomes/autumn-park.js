// Autumn park - a late golden afternoon: trees in orange, red and yellow, a
// path winding away between them, a bench, a lamp just lit, long shadows on
// the grass, and leaves tumbling slowly down, now and then on a gust.
// Music: mellow jazzy lo-fi in B minor (68 bpm): vibraphone comping, a falling piano
// theme, upright bass walking in the middle, soft snare and hats; wind, dry leaves.
(function () {
  'use strict';
  var K = window.RelaxKit;

  var LEAF_COLS = ['#b9603e', '#c97a3a', '#d99a4a', '#a8442e', '#c4683a', '#8e3a28'];
  var LEAF = 'M -1 0 Q -0.5 -0.55 0 -0.5 Q 0.6 -0.45 1 0 Q 0.6 0.45 0 0.5 Q -0.5 0.55 -1 0 Z';

  // A park tree, full resolution, into x (its base at bx, by; size h): a leaning trunk
  // forking into limbs, foliage in separate clumps with sky between them, shaded away
  // from the low sun at (sunX, sunY) and rimmed with its light.
  function tree(x, rnd, bx, by, h, sunX, sunY, opt) {
    var c = K.canvas(x.canvas.width, x.canvas.height), t = c.getContext('2d');
    var lean = (rnd() - 0.5) * 0.12 + (opt.lean || 0), tw = h * (0.05 + 0.02 * rnd());
    var top = [bx + Math.sin(lean) * h * 0.32, by - h * 0.32];
    t.fillStyle = '#2e1f1a'; t.strokeStyle = '#2e1f1a'; t.lineCap = 'round';
    t.beginPath(); t.moveTo(bx - tw * 0.7, by + 2); t.quadraticCurveTo(bx - tw * 0.4, by - h * 0.2, top[0] - tw * 0.32, top[1]);
    t.lineTo(top[0] + tw * 0.32, top[1]); t.quadraticCurveTo(bx + tw * 0.45, by - h * 0.2, bx + tw * 0.8, by + 2); t.closePath(); t.fill();
    var tips = [];
    var limbs = 5 + Math.floor(rnd() * 3);
    for (var i = 0; i < limbs; i++) {
      var a = -Math.PI / 2 + (i / (limbs - 1) - 0.5) * (2.1 + 0.5 * rnd()) + lean + (rnd() - 0.5) * 0.45;
      var len = h * (0.2 + 0.24 * rnd());
      var ex = top[0] + Math.cos(a) * len, ey = top[1] + Math.sin(a) * len * 0.85;
      t.lineWidth = tw * (0.2 + 0.14 * rnd());
      t.beginPath(); t.moveTo(top[0], top[1] + tw * 0.4);
      t.quadraticCurveTo(top[0] + Math.cos(a) * len * 0.3, top[1] + Math.sin(a) * len * 0.55, ex, ey); t.stroke();
      tips.push([ex, ey, h * (0.15 + 0.09 * rnd())]);
      if (rnd() < 0.6) { // a twig off the limb
        var b = a + (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.4 * rnd()), bl = len * 0.45;
        var mx = top[0] + Math.cos(a) * len * 0.55, my = top[1] + Math.sin(a) * len * 0.5;
        t.lineWidth = tw * 0.16; t.beginPath(); t.moveTo(mx, my); t.lineTo(mx + Math.cos(b) * bl, my + Math.sin(b) * bl * 0.9); t.stroke();
        tips.push([mx + Math.cos(b) * bl, my + Math.sin(b) * bl * 0.9, h * (0.08 + 0.06 * rnd())]);
      }
    }
    // the middle of the crown filled too, so it reads as one mass with a few gaps
    var mid = [top[0] + Math.sin(lean) * h * 0.12, top[1] - h * 0.2];
    tips.push([mid[0], mid[1], h * 0.17]);
    tips.push([mid[0] + (rnd() - 0.5) * h * 0.25, mid[1] - h * 0.1, h * 0.13]);
    // foliage: lobes round each tip, then single leaves along the ragged edge
    var fol = K.canvas(c.width, c.height), f = fol.getContext('2d'), lp = new Path2D(LEAF);
    var body = new Path2D();
    tips.forEach(function (tp) {
      for (var j = 0; j < 11; j++) {
        var aa = rnd() * Math.PI * 2, dd = rnd() * tp[2] * 0.45, rr = tp[2] * (0.26 + 0.2 * rnd());
        var lx = tp[0] + Math.cos(aa) * dd * 1.25, ly = tp[1] + Math.sin(aa) * dd * 0.75;
        // a lobe with a broken outline, never a clean circle
        var sd = rnd() * 50;
        for (var e = 0; e <= 14; e++) {
          var th = e / 14 * Math.PI * 2, rad = rr * (0.8 + 0.35 * (K.noise1(th * 1.6 + sd, 9) * 0.5 + 0.5));
          var ex = lx + Math.cos(th) * rad, ey = ly + Math.sin(th) * rad;
          if (e === 0) body.moveTo(ex, ey); else body.lineTo(ex, ey);
        }
        body.closePath();
      }
    });
    // the ragged edge: single leaves only round the outside of the clumps (about a third of
    // the old count), so the crown reads as masses, not a crunchy texture
    tips.forEach(function (tp) {
      for (var k = 0; k < tp[2] * 3; k++) {
        var aa = rnd() * Math.PI * 2, dd = tp[2] * (0.52 + 0.36 * rnd());
        f.save(); f.translate(tp[0] + Math.cos(aa) * dd * 1.2, tp[1] + Math.sin(aa) * dd * 0.78); f.rotate(rnd() * 6.3);
        var ls = h * (0.009 + 0.006 * rnd()); f.scale(ls * 1.4, ls);
        f.fillStyle = '#a2502f'; f.fill(lp);
        f.restore();
      }
    });
    f.fillStyle = '#a2502f'; f.fill(body);
    // three broad masses: the middle tone (the body), the side facing the sun, the side
    // and underside turned away; soft-edged, laid inside the crown's silhouette
    var cx = tips.reduce(function (s0, q) { return s0 + q[0]; }, 0) / tips.length, cy = tips.reduce(function (s0, q) { return s0 + q[1]; }, 0) / tips.length;
    var dx = sunX - cx, dy = sunY - cy, dl = Math.hypot(dx, dy) || 1, ux = dx / dl;
    function mass(col, ox, oy, sx, sy) {
      var m = K.canvas(fol.width, fol.height), mx = m.getContext('2d');
      mx.filter = 'blur(' + Math.round(h * 0.035) + 'px)'; mx.fillStyle = col;
      for (var q = 0; q < 4; q++) {
        mx.beginPath();
        mx.ellipse(cx + ox + (rnd() - 0.5) * sx * 0.8, cy + oy + (rnd() - 0.5) * sy * 0.8, sx * (0.5 + 0.4 * rnd()), sy * (0.5 + 0.4 * rnd()), (rnd() - 0.5) * 0.6, 0, Math.PI * 2);
        mx.fill();
      }
      f.globalCompositeOperation = 'source-atop'; f.drawImage(m, 0, 0); f.globalCompositeOperation = 'source-over';
    }
    mass('rgba(110, 44, 30, 0.78)', -ux * h * 0.16, h * 0.1, h * 0.32, h * 0.2);
    mass('rgba(222, 160, 88, 0.55)', ux * h * 0.14, -h * 0.12, h * 0.26, h * 0.16);
    // a few leaves on the lit edge catch the light
    tips.forEach(function (tp) {
      if ((tp[0] - cx) * ux < 0) return;
      for (var k = 0; k < tp[2] * 0.35; k++) {
        var aa = -Math.PI / 2 + (rnd() - 0.5) * 2.4, dd = tp[2] * (0.62 + 0.25 * rnd());
        f.save(); f.translate(tp[0] + Math.cos(aa) * dd * 1.2, tp[1] + Math.sin(aa) * dd * 0.78 - tp[2] * 0.1); f.rotate(rnd() * 6.3);
        var ls = h * 0.01; f.scale(ls * 1.4, ls);
        f.fillStyle = rnd() < 0.5 ? '#d99a4a' : '#e9b462'; f.fill(lp);
        f.restore();
      }
    });
    t.drawImage(fol, 0, 0);
    K.rim(c, dx, dy - h * 0.3, h * 0.01, '255, 214, 150', 0.8, h * 0.004);
    x.drawImage(c, 0, 0);
    return { tips: tips, cx: cx };
  }

  RelaxBiomes.register({
    id: 'autumn-park',
    name: 'Autumn park',
    about: 'A low autumn sun at the end of a park path: rust and amber trees, a bench, long shadows growing longer, dusk, a lamp coming on, a few leaves falling. Jazzy lo-fi in B minor: vibraphone, a falling piano theme, upright bass walking in the middle, soft snare and hats, wind, dry leaves.',
    ink: '255, 242, 226',
    shade: '40, 24, 20',
    vignette: 0.22,
    legible: 0.55,
    grade: { shadow: '26, 16, 28', light: '255, 242, 226' },
    level: 0.855, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.313,

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var horizon = H * 0.53, hzY = SH * 0.53;
      // One low sun at the far end of the path, a little towards the other screen; on the
      // other screen it is off to the side and only its light comes in.
      var sunU = main ? 0.5 + 0.12 * inner : 0.5 + 0.75 * inner;
      var sun = { x: W * sunU, y: horizon - H * 0.07 };

      // ---- sky, two of them: the golden hour and the dusk after it
      function sky(stops, glowA) {
        var c = s.layer(), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, stops); x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = 'lighter';
        x.save(); x.translate(sun.x, horizon); x.scale(1.7, 1);
        x.fillStyle = K.radial(x, 0, 0, H * 0.55, [[0, 'rgba(255, 210, 140, ' + glowA + ')'], [0.4, 'rgba(255, 180, 120, ' + (glowA * 0.3) + ')'], [1, 'rgba(255, 180, 120, 0)']]);
        x.fillRect(-H * 0.6, -H * 0.6, H * 1.2, H * 0.6);
        x.restore();
        return c;
      }
      var skyGold = sky([[0, '#8c9fbb'], [0.45, '#cbbdb0'], [0.8, '#e9c79a'], [1, '#efbf86']], 0.55);
      var skyDusk = sky([[0, '#4a4f72'], [0.5, '#8a7182'], [0.85, '#c98a6e'], [1, '#d7915e']], 0.35);

      // ---- the far tree line, hazy, with a gap where the path goes into the light
      var far = s.layer(), fx = far.getContext('2d');
      var haze = '#e3c39c';
      for (var band = 0; band < 2; band++) {
        var col = K.aerial(band ? '#8a4a32' : '#a0583a', haze, band ? 0.55 : 0.78);
        for (var fi = 0; fi < 9; fi++) {
          var mw = W * (0.14 + 0.12 * rnd()), mh = H * (0.08 + 0.05 * rnd() + band * 0.03);
          var mxp = W * (fi / 8) + (rnd() - 0.5) * W * 0.08 - mw / 2;
          if (main && Math.abs(mxp + mw / 2 - sun.x) < W * 0.07) continue; // the opening
          var cc = K.rgb(col.replace(/rgb\(|\)/g, ''));
          var m = K.mass({ w: Math.round(mw), h: Math.round(mh), light: K.mixRgb(cc, '255, 214, 160', 0.25), dark: cc.join(','), alpha: 0.95,
            cover: 0.62, freq: 3.4, seed: 70 + fi * 5 + band * 50 + (main ? 0 : 200), flat: 0.35, taper: 0.25, oct: 4, edge: 0.3, mottle: 0.3 });
          fx.drawImage(m, mxp, horizon - mh * (0.92 - band * 0.12));
        }
      }

      // ---- the ground: lawn, a path narrowing into the opening, leaves everywhere
      var ground = s.layer(), gx = ground.getContext('2d');
      gx.fillStyle = K.linear(gx, 0, horizon, 0, H, [[0, '#b2985e'], [0.35, '#94834a'], [1, '#6e6034']]);
      gx.fillRect(0, horizon - 1, W, H - horizon + 1);
      var path = null;
      if (main) {
        var L = [], R = [];
        for (var k = 0; k <= 40; k++) {
          var v = k / 40, y = horizon + 1 + (H - horizon) * Math.pow(v, 1.6);
          var wv = W * (0.004 + 0.17 * Math.pow(v, 1.3));
          var cxp = sun.x + (W * (0.47 - 0.05 * inner) - sun.x) * v + Math.sin(v * 5.2 + 1) * W * 0.06 * v * (1 - v) * 2;
          L.push([cxp - wv * (1 + 0.08 * K.noise1(v * 9, 3)), y]); R.push([cxp + wv * (1 + 0.08 * K.noise1(v * 9, 7)), y]);
        }
        path = new Path2D(); path.moveTo(L[0][0], L[0][1]);
        L.forEach(function (q) { path.lineTo(q[0], q[1]); }); for (var rk = R.length - 1; rk >= 0; rk--) path.lineTo(R[rk][0], R[rk][1]);
        path.closePath();
        gx.fillStyle = K.linear(gx, 0, horizon, 0, H, [[0, '#dcc39a'], [0.5, '#c0a582'], [1, '#a68c6a']]);
        gx.fill(path);
        gx.strokeStyle = 'rgba(90, 80, 44, 0.35)'; gx.lineWidth = 0.8; gx.stroke(path); // its worn grass edge
      }
      for (var l = 0; l < 700; l++) { // fallen leaves in the grass, more near us
        var lyp = horizon + Math.pow(rnd(), 0.6) * (H - horizon), d01 = (lyp - horizon) / (H - horizon);
        gx.fillStyle = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)]; gx.globalAlpha = 0.25 + 0.45 * d01;
        gx.beginPath(); gx.ellipse(rnd() * W, lyp, 0.4 + 1.6 * d01 * rnd() + 0.3, 0.3 + 0.6 * d01, rnd() * 3, 0, Math.PI * 2); gx.fill();
      }
      gx.globalAlpha = 1;

      // ---- the trees of the middle distance, crisp: their positions (screen px) and sizes
      var trees = main ? [[0.5 - 0.36 * inner, 0.66, 0.5, -0.04 * inner], [0.5 - 0.22 * inner, 0.62, 0.36, 0.05 * inner], [0.5 + 0.33 * inner, 0.64, 0.42, 0.06 * inner], [0.5 + 0.2 * inner, 0.585, 0.2, 0]]
        : [[0.5 + 0.28 * inner, 0.66, 0.46, 0.03], [0.5 - 0.12 * inner, 0.6, 0.3, -0.04], [0.5 - 0.38 * inner, 0.585, 0.2, 0.02]];
      var sunS = [sun.x * s.scale, sun.y * s.scale];
      // their long shadows, pointing away from the sun across the grass (drawn per frame,
      // so they lengthen as the sun goes down)
      var shadows = trees.map(function (tr) {
        var bx = SW * tr[0], by = SH * tr[1], h = SH * tr[2];
        var c = K.canvas(Math.ceil(h * 1.25 / s.scale), Math.ceil(h * 0.34 / s.scale)), x = c.getContext('2d');
        var cw = c.width, ch = c.height;
        x.fillStyle = 'rgba(78, 72, 44, 0.36)';
        x.beginPath(); x.ellipse(cw * 0.6, ch / 2, cw * 0.3, ch * 0.4, 0, 0, Math.PI * 2); x.fill();
        var b = K.blurred(c, 2.4), bx2 = b.getContext('2d');
        // the trunk's shadow, sharp at the foot and joining the crown's
        bx2.fillStyle = 'rgba(70, 62, 38, 0.5)';
        bx2.beginPath(); bx2.moveTo(0, ch / 2 - 2.2); bx2.lineTo(cw * 0.36, ch / 2 - 1.6); bx2.lineTo(cw * 0.36, ch / 2 + 1.6); bx2.lineTo(0, ch / 2 + 2.2); bx2.fill();
        // on the ground, shadows run straight away from the point under the sun
        return { img: b, x: bx / s.scale, y: by / s.scale, ang: Math.atan2(by - hzY, bx - sunS[0]) };
      });
      var bench = main ? { x: SW * (0.5 + 0.15 * inner), y: SH * 0.8 } : null;
      var lamp = main ? { x: SW * (0.5 - 0.1 * inner), y: SH * 0.72 } : null;

      // A park bench seen a little from the side: its length running slightly away from us,
      // a seat plane you can see (the eye is above it), a backrest, four legs standing on the
      // grass, and shadows from the low sun running back towards us.
      function drawBench(x) {
        var bw = SH * 0.15, sx = inner * -1;
        var Ax = bw, Ay = -bw * 0.1 * sx;            // along the bench
        var Dx = -bw * 0.09 * sx, Dy = -bw * 0.1;    // into the picture (its depth)
        var seatH = SH * 0.034, backH = SH * 0.062;
        var b0x = bench.x - Ax / 2, b0y = bench.y - Ay / 2;
        var P = function (a, d, up) { return [b0x + Ax * a + Dx * d, b0y + Ay * a + Dy * d - up]; };
        var poly = function (pts, col) { x.fillStyle = col; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.closePath(); x.fill(); };
        var ang = Math.atan2(bench.y - hzY, bench.x - sunS[0]), lx = Math.cos(ang) * SH * 0.05, ly = Math.sin(ang) * SH * 0.05;
        // shadows: one soft patch under the seat, a short streak from each foot
        x.save(); x.filter = 'blur(3px)';
        poly([P(0, 0, 0), P(1, 0, 0), [P(1, 1, 0)[0] + lx, P(1, 1, 0)[1] + ly], [P(0, 1, 0)[0] + lx, P(0, 1, 0)[1] + ly]], 'rgba(60, 54, 32, 0.32)');
        x.restore();
        x.strokeStyle = 'rgba(52, 46, 28, 0.5)'; x.lineWidth = 3; x.lineCap = 'round';
        [[0.06, 0], [0.94, 0], [0.06, 1], [0.94, 1]].forEach(function (f) {
          var q = P(f[0], f[1], 0); x.beginPath(); x.moveTo(q[0], q[1]); x.lineTo(q[0] + lx * 0.9, q[1] + ly * 0.9); x.stroke();
        });
        var wood = '#3b2a20', top = '#6e4e36', edge = '#2a1d16';
        [[0.06, 1], [0.94, 1]].forEach(function (f) { var q = P(f[0], f[1], 0); poly([q, [q[0] + 4, q[1]], [q[0] + 4, q[1] - seatH], [q[0], q[1] - seatH]], edge); });
        // backrest: two slats on posts along the back edge
        [0.06, 0.94].forEach(function (a) { var q = P(a, 1, seatH); poly([q, [q[0] + 4, q[1]], [q[0] + 4, q[1] - backH], [q[0], q[1] - backH]], edge); });
        poly([P(0, 1, seatH + backH * 0.55), P(1, 1, seatH + backH * 0.55), P(1, 1, seatH + backH * 0.8), P(0, 1, seatH + backH * 0.8)], wood);
        poly([P(0, 1, seatH + backH * 0.85), P(1, 1, seatH + backH * 0.85), P(1, 1, seatH + backH), P(0, 1, seatH + backH)], wood);
        // the seat: its top plane (catching the sky and the low sun) and its front edge
        poly([P(0, 0, seatH), P(1, 0, seatH), P(1, 1, seatH), P(0, 1, seatH)], top);
        x.strokeStyle = 'rgba(42, 30, 22, 0.6)'; x.lineWidth = 1;
        [0.33, 0.66].forEach(function (d) { var a0 = P(0, d, seatH), a1 = P(1, d, seatH); x.beginPath(); x.moveTo(a0[0], a0[1]); x.lineTo(a1[0], a1[1]); x.stroke(); });
        poly([P(0, 0, seatH), P(1, 0, seatH), P(1, 0, seatH - SH * 0.008), P(0, 0, seatH - SH * 0.008)], edge);
        // the front legs, in front of everything
        [[0.06, 0], [0.94, 0]].forEach(function (f) { var q = P(f[0], f[1], 0); poly([q, [q[0] + 4.5, q[1]], [q[0] + 4.5, q[1] - seatH], [q[0], q[1] - seatH]], edge); });
      }

      // ---- the front: trees, bench, lamp post, the big trunk at the edge, a leaf pile
      var treesC = K.canvas(SW, SH), tcx = treesC.getContext('2d');
      trees.slice().sort(function (a, b) { return a[1] - b[1]; }).forEach(function (tr, i) {
        var r = K.seeded(400 + i * 31 + (main ? 0 : 77));
        tree(tcx, r, SW * tr[0], SH * tr[1], SH * tr[2], sunS[0], sunS[1], { lean: tr[3] });
      });
      function front(x) {
        x.drawImage(treesC, 0, 0);
        trees.forEach(function (tr) {
          x.fillStyle = 'rgba(46, 34, 24, 0.45)'; // where the trunk meets the grass
          x.beginPath(); x.ellipse(SW * tr[0], SH * tr[1] + 2, SH * tr[2] * 0.06, SH * 0.006, 0, 0, Math.PI * 2); x.fill();
        });
        if (bench) drawBench(x);
        if (lamp) {
          x.fillStyle = '#2a1e1a';
          x.fillRect(lamp.x - 2, lamp.y - SH * 0.17, 4, SH * 0.17);
          x.fillRect(lamp.x - 6, lamp.y - 3, 12, 4);
          x.beginPath(); x.moveTo(lamp.x - 9, lamp.y - SH * 0.17); x.lineTo(lamp.x + 9, lamp.y - SH * 0.17);
          x.lineTo(lamp.x + 6, lamp.y - SH * 0.195); x.lineTo(lamp.x - 6, lamp.y - SH * 0.195); x.closePath(); x.fill();
          x.beginPath(); x.moveTo(lamp.x - 7, lamp.y - SH * 0.195); x.lineTo(lamp.x, lamp.y - SH * 0.21); x.lineTo(lamp.x + 7, lamp.y - SH * 0.195); x.fill();
        }
        // the old tree on the outer edge, close by
        var ox = inner > 0 ? 0 : SW, od = inner > 0 ? 1 : -1, r2 = K.seeded(3737 + s.seed);
        var trunkC = K.canvas(SW, SH), tk = trunkC.getContext('2d');
        tk.fillStyle = '#261a15';
        tk.beginPath(); tk.moveTo(ox - od * SW * 0.02, SH); tk.lineTo(ox + od * SW * 0.08, SH);
        tk.quadraticCurveTo(ox + od * SW * 0.055, SH * 0.6, ox + od * SW * 0.065, SH * 0.2); tk.lineTo(ox + od * SW * 0.035, 0);
        tk.lineTo(ox - od * SW * 0.02, 0); tk.closePath(); tk.fill();
        K.rim(trunkC, sunS[0] - ox, -0.2, 3, '255, 200, 130', 0.5, 1.2);
        x.drawImage(trunkC, 0, 0);
        var lp = new Path2D(LEAF);
        for (var i = 0; i < 220; i++) { // leaves heaped at its foot
          var lx = ox + od * r2() * SW * 0.26 * Math.pow(r2(), 0.5), ly = SH * (0.955 + 0.05 * r2());
          x.save(); x.translate(lx, ly); x.rotate(r2() * 6.3); x.scale(SH * 0.009, SH * 0.0055);
          x.fillStyle = LEAF_COLS[Math.floor(r2() * LEAF_COLS.length)]; x.fill(lp);
          if (r2() < 0.4) { x.fillStyle = 'rgba(50, 20, 12, 0.35)'; x.fill(lp); }
          x.restore();
        }
      }

      // ---- the branch reaching over from that tree, a little out of focus, barely moving
      var bw2 = Math.round(SW * 0.62), bh2 = Math.round(SH * 0.34), bxo = inner > 0 ? 0 : SW - bw2;
      var branch = s.sprite(bw2, bh2, function (cx, w, h) {
        var c = K.canvas(w, h), x = c.getContext('2d'), r = K.seeded(91 + s.seed);
        if (inner < 0) { x.translate(w, 0); x.scale(-1, 1); }
        x.strokeStyle = '#2a1c16'; x.lineCap = 'round';
        x.lineWidth = SH * 0.02;
        x.beginPath(); x.moveTo(0, SH * 0.1); x.quadraticCurveTo(w * 0.3, -SH * 0.01, w * 0.6, SH * 0.05); x.stroke();
        x.lineWidth = SH * 0.008;
        x.beginPath(); x.moveTo(w * 0.32, SH * 0.045); x.quadraticCurveTo(w * 0.42, SH * 0.12, w * 0.48, SH * 0.19); x.stroke();
        var lp = new Path2D(LEAF);
        // leaves in loose clusters, gaps between them
        [[0.1, 0.09, 0.05], [0.24, 0.04, 0.06], [0.46, 0.18, 0.05], [0.58, 0.05, 0.06]].forEach(function (cl) {
          for (var i = 0; i < 110; i++) {
            var a = r() * 6.3, d = Math.pow(r(), 0.6) * SH * cl[2];
            var lx = w * cl[0] + Math.cos(a) * d * 1.4, ly = SH * cl[1] + Math.sin(a) * d * 0.8;
            if (ly > h - 4 || ly < 2) continue;
            x.save(); x.translate(lx, ly); x.rotate(r() * 6.3); x.scale(SH * 0.011, SH * 0.007);
            x.fillStyle = LEAF_COLS[Math.floor(r() * LEAF_COLS.length)]; x.fill(lp);
            if (Math.sin(a) > 0.2) { x.fillStyle = 'rgba(50, 18, 12, 0.35)'; x.fill(lp); }
            x.restore();
          }
        });
        cx.filter = 'blur(1.4px)'; cx.drawImage(c, 0, 0);
      }, inner > 0 ? 0 : bw2, SH * 0.1);
      branch.set(bxo, 0, 0);

      // ---- leaves in the air: a dozen, falling slowly in small arcs. They share one
      // full-screen sprite redrawn at 7.5 fps: a dozen small layers of their own measured
      // about +1 % GPU, one shared layer costs next to nothing
      var leaves = [];
      for (var li = 0; li < (main ? 12 : 8); li++) {
        var sz = 5 + rnd() * 4, colL = LEAF_COLS[Math.floor(rnd() * LEAF_COLS.length)];
        var img = K.canvas(Math.ceil(sz * 2.2), Math.ceil(sz * 1.5)), ix = img.getContext('2d');
        ix.translate(img.width / 2, img.height / 2); ix.scale(sz, sz * 0.62); ix.fillStyle = colL; ix.fill(new Path2D(LEAF));
        leaves.push({ img: img, x0: rnd() * SW, y0: rnd() * SH, vy: 5 + 7 * rnd(), arc: 14 + 18 * rnd(), per: 6 + 5 * rnd(), ph: rnd() * 6.3,
          spin: 0.2 + 0.4 * rnd(), box: null });
      }
      var leafSpr = s.sprite(SW, SH, function () {}), lfx = leafSpr.el.getContext('2d');

      // ---- dusk: one full-screen veil whose opacity rises as the sun goes; the lamp's
      // light sits above it
      // Dusk takes the light off surfaces unevenly: the crowns (lit only by the sun) go
      // darkest, the lawn less, the pale path keeps the sky's light longest.
      var veil = s.sprite(SW, SH, function (x, w, h) {
        x.fillStyle = K.linear(x, 0, 0, 0, h, [[0, 'rgba(44, 34, 64, 0.5)'], [0.5, 'rgba(70, 44, 60, 0.34)'], [1, 'rgba(40, 26, 30, 0.42)']]);
        x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = K.radial(x, sunS[0], hzY, SH * 0.5, [[0, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]);
        x.fillRect(0, 0, w, h);
        if (path) {
          x.save(); x.scale(s.scale, s.scale); x.fillStyle = 'rgba(0,0,0,0.55)'; x.fill(path); x.restore();
        }
        x.globalCompositeOperation = 'source-over';
        var tm = K.canvas(w, h), tmx = tm.getContext('2d');
        tmx.drawImage(treesC, 0, 0, w, h);
        tmx.globalCompositeOperation = 'source-in'; tmx.fillStyle = 'rgba(34, 16, 20, 0.6)'; tmx.fillRect(0, 0, w, h);
        x.drawImage(tm, 0, 0);
      });
      var lampSpr = null;
      if (lamp) {
        var lr = Math.round(SH * 0.16);
        lampSpr = s.sprite(lr * 2, lr * 2 + Math.round(SH * 0.2), function (x, w) {
          var bl = K.bloom('255, 206, 130', 1.4);
          x.globalCompositeOperation = 'lighter';
          x.drawImage(bl, 0, 0, w, w);
          x.fillStyle = 'rgba(255, 236, 190, 0.95)'; x.fillRect(w / 2 - 5, w / 2 - 3, 10, 6);
          x.fillStyle = K.radial(x, w / 2, w / 2 + SH * 0.19, lr * 0.9, [[0, 'rgba(255, 196, 120, 0.28)'], [1, 'rgba(255, 196, 120, 0)']]);
          x.save(); x.translate(0, w / 2 + SH * 0.19); x.scale(1, 0.25); x.fillRect(0, -lr, w, lr * 2); x.restore();
        });
        lampSpr.pos = [lamp.x - lr, lamp.y - SH * 0.183 - lr];
      }
      var sunBloom = K.bloom('255, 214, 150', 1.8);
      var step = -1, shadowStep = -1, veilA = -1;
      var shadowLayer = s.layer(), shx = shadowLayer.getContext('2d');
      var warmth = s.layer(), wmx = warmth.getContext('2d');
      wmx.fillStyle = K.radial(wmx, sun.x, horizon, W * 0.8, [[0, 'rgba(255, 190, 120, 0.16)'], [1, 'rgba(255, 190, 120, 0)']]);
      wmx.fillRect(0, 0, W, H);

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          var dusk = K.smooth(p);
          ctx.drawImage(skyGold, 0, 0);
          ctx.globalAlpha = dusk; ctx.drawImage(skyDusk, 0, 0); ctx.globalAlpha = 1;
          // the sun sinks into the far trees
          var sy = sun.y + H * 0.1 * p, vis = K.clamp((horizon - H * 0.02 - sy) / (H * 0.06) + 0.3, 0, 1);
          if (main) {
            K.light(ctx, sunBloom, sun.x, sy, H * 0.38, 0.5 * (0.35 + 0.65 * vis), H * 0.3);
            ctx.fillStyle = 'rgba(255, 238, 200, ' + (0.9 * vis).toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(sun.x, sy, H * 0.022, 0, Math.PI * 2); ctx.fill();
          } else {
            K.light(ctx, sunBloom, sun.x, horizon, H * 0.7, 0.35 * (1 - 0.6 * dusk), H * 0.35);
          }
          var pf = s.par(0.2);
          ctx.drawImage(far, pf.x, pf.y);
          ctx.drawImage(ground, 0, 0);
          // shadows lengthen as the sun drops: re-laid every two seconds into one layer,
          // drawn as one image in between (rotated draws each frame cost more than all the rest)
          var sk = Math.floor(t / 2);
          if (sk !== shadowStep) {
            shadowStep = sk;
            var grow = 1 + 0.9 * dusk;
            shx.setTransform(1, 0, 0, 1, 0, 0); shx.clearRect(0, 0, W, H);
            for (var i = 0; i < shadows.length; i++) {
              var sh = shadows[i];
              shx.setTransform(Math.cos(sh.ang) * grow, Math.sin(sh.ang) * grow, -Math.sin(sh.ang), Math.cos(sh.ang), sh.x, sh.y);
              shx.drawImage(sh.img, 0, -sh.img.height / 2);
            }
            shx.setTransform(1, 0, 0, 1, 0, 0);
          }
          ctx.globalAlpha = 0.85 * (1 - 0.45 * dusk);
          ctx.drawImage(shadowLayer, 0, 0);
          // warm light lying low across everything, fading with the sun
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1 - dusk * 0.8;
          ctx.drawImage(warmth, 0, 0);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';

          var va = Math.round(85 * dusk) / 100;
          if (va !== veilA) { veilA = va; veil.set(0, 0, 0, va); }
          // leaves and the branch move about a pixel a step: every other frame is enough
          var st = Math.floor(t * 7.5);
          if (st === step) return;
          step = st;
          if (lampSpr) {
            var on = K.smooth((p - 0.3) / 0.35);
            lampSpr.set(lampSpr.pos[0], lampSpr.pos[1], 0, on * (0.94 + 0.06 * K.flicker(t, 5, 0.4)));
          }
          branch.set(bxo, 0, 0.18 * K.noise1(t * 0.045, 11));
          for (var j = 0; j < leaves.length; j++) { // clear where they were, then draw them all again
            var bx0 = leaves[j].box;
            if (bx0) lfx.clearRect(bx0[0], bx0[1], bx0[2], bx0[2]);
          }
          for (var k = 0; k < leaves.length; k++) {
            var lf = leaves[k];
            var y = (lf.y0 + t * lf.vy) % (SH + 40) - 20;
            var x = lf.x0 + Math.sin(t * 2 * Math.PI / lf.per + lf.ph) * lf.arc + t * 2;
            x = ((x % (SW + 40)) + SW + 40) % (SW + 40) - 20;
            var flip = Math.cos(t * lf.spin * 3 + lf.ph), r0 = lf.img.width * 0.6 + 2;
            lfx.save(); lfx.translate(x, y); lfx.rotate(Math.sin(t * lf.spin + lf.ph) * 1.2); lfx.scale(1, 0.3 + 0.7 * Math.abs(flip));
            lfx.drawImage(lf.img, -lf.img.width / 2, -lf.img.height / 2);
            lfx.restore();
            lf.box = [x - r0, y - r0, r0 * 2];
          }
        },
        front: function (fx) { front(fx); },
      };
    },

    lofi: {
      key: 'B', mode: 'minor', bpm: 68, swing: 0.6,
      progs: ['i9 iv9 bVII13 bIIImaj7', 'bVImaj7 iiø7 V7b9 i9', 'i9 bVImaj7 iv9 V7b9'],
      keys: { inst: 'vibes', style: 'comp', range: [57, 79], level: 0.9 },
      lead: { inst: 'piano', range: [66, 86], level: 0.72, motif: '0.4.5 4.4.4 8.8.3 | 2.12.1' },
      reply: { inst: 'vibes', shift: -12, level: 0.45 },
      bass: { style: 'lofi', walk: true, level: 0.67 },
      drums: { style: 'boom', snare: 'snare', hat: 'hat', level: 0.61 },
      fx: { tone: 5000, crackle: 0.3, hiss: 0.35, wow: 0.9, room: 0.4, verb: 1.1, echo: 0.75, duck: 0.1 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var wind = K.gain(ac, 0.1, out);
      var wbp = K.filter(ac, 'bandpass', 500, 0.6, wind);
      K.loop(ac, K.noise(ac, 'pink', 8), wbp, t0);
      K.lfo(ac, 0.03, 0.07, wind.gain, 'sine', t0);
      K.lfo(ac, 0.027, 220, wbp.frequency, 'sine', t0);
      var rustle = K.filter(ac, 'bandpass', 3200, 0.8, K.gain(ac, 1, out));
      var rBuf = K.noise(ac, 'white', 2);
      var nextRustle = t0 + 1;

      return function schedule(until) {
        while (nextRustle < until) { // dry leaves: a soft crackle that swells and fades
          var src = ac.createBufferSource(); src.buffer = rBuf; src.loop = true;
          var g = ac.createGain(); var rt = nextRustle, len = 0.8 + Math.random() * 1.6;
          g.gain.setValueAtTime(0.0001, rt); g.gain.linearRampToValueAtTime(0.006 + Math.random() * 0.006, rt + len * 0.4);
          g.gain.linearRampToValueAtTime(0.0001, rt + len);
          src.connect(g); g.connect(K.panner(ac, Math.random() * 1.6 - 0.8, rustle));
          src.start(rt, Math.random()); src.stop(rt + len + 0.05);
          nextRustle = rt + len + 1 + Math.random() * 4;
        }
      };
    },
  });
})();

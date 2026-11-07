// Zen garden - a raked gravel courtyard in soft morning light, three mossy
// stones with rings drawn round them, a temple wall with blossoming cherry
// trees behind it, a branch in the corner, and petals drifting down.
// Music: very sparse, in A minor (58 bpm, no drums): a soft piano letting chords ring and
// its two-note answer, kalimba echoes, long silences; stream, bamboo knocker.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // A cherry branch: tapering limbs that fork, with clusters of dusty-pink blossom.
  function branch(fx, rnd, x0, y0, len, ang, width, depth, blooms) {
    var x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    var cx = (x0 + x1) / 2 + Math.cos(ang + Math.PI / 2) * len * 0.1 * (rnd() - 0.5) * 2;
    var cy = (y0 + y1) / 2 + Math.sin(ang + Math.PI / 2) * len * 0.1 * (rnd() - 0.5) * 2;
    fx.strokeStyle = '#3a2a2e'; fx.lineCap = 'round'; fx.lineWidth = width;
    fx.beginPath(); fx.moveTo(x0, y0); fx.quadraticCurveTo(cx, cy, x1, y1); fx.stroke();
    if (depth > 0) {
      var kids = depth > 2 ? 1 : 2;
      for (var k = 0; k < kids; k++) {
        var at = 0.4 + 0.5 * rnd();
        branch(fx, rnd, x0 + (x1 - x0) * at, y0 + (y1 - y0) * at, len * (0.4 + 0.25 * rnd()),
          ang + (rnd() < 0.5 ? -1 : 1) * (0.35 + 0.45 * rnd()), width * 0.58, depth - 1, blooms);
      }
      branch(fx, rnd, x1, y1, len * 0.62, ang + (rnd() - 0.5) * 0.45, width * 0.66, depth - 1, blooms);
    } else {
      blooms.push([x1, y1]);
      if (rnd() < 0.6) blooms.push([(x0 + x1) / 2, (y0 + y1) / 2]);
    }
  }
  function blossom(fx, rnd, x, y, r) {
    var rot = rnd() * Math.PI, tone = rnd();
    fx.fillStyle = tone < 0.55 ? '#d99eae' : (tone < 0.88 ? '#e3b3bf' : '#efd0d6');
    for (var i = 0; i < 5; i++) {
      var a = rot + i * Math.PI * 2 / 5;
      fx.beginPath(); fx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.38, a, 0, Math.PI * 2); fx.fill();
    }
    fx.fillStyle = '#b4687e';
    fx.beginPath(); fx.arc(x, y, r * 0.2, 0, Math.PI * 2); fx.fill();
  }
  // A weathered stone, full resolution: broad at the foot, a lopsided crown that leans, two
  // or three broad planes of light and shade (never crystal facets), its foot sunk in the gravel.
  function stone(x, cx, base, w, h, lean, seed, light) {
    var r = K.seeded(seed), pts = [], n = 10, peakAt = 0.5 + lean * 1.2 + (r() - 0.5) * 0.15;
    for (var i = 0; i <= n; i++) {
      var u = i / n, a = Math.PI * (1 - u);
      var shoulder = 1 - 0.3 * Math.pow(Math.abs(u - peakAt) * 1.6, 1.3); // the crown is off-centre
      var y = base - h * Math.pow(Math.sin(a), 0.6) * shoulder * (0.88 + 0.24 * r());
      var xx = cx + Math.cos(a) * w * 0.5 * (1 + 0.1 * (r() - 0.5)) + lean * h * Math.pow(Math.sin(a), 2);
      pts.push([xx, y]);
    }
    var p = new Path2D();
    p.moveTo(pts[0][0], base + h * 0.05);
    for (var q = 0; q < pts.length; q++) {
      var nx = q + 1 < pts.length ? pts[q + 1] : pts[q];
      p.quadraticCurveTo(pts[q][0], pts[q][1], (pts[q][0] + nx[0]) / 2, (pts[q][1] + nx[1]) / 2);
    }
    p.lineTo(pts[n][0], base + h * 0.05); p.closePath();
    // contact shadow, tight to the foot
    x.fillStyle = K.radial(x, cx, base, w * 0.6, [[0, 'rgba(60, 46, 52, 0.34)'], [0.7, 'rgba(60, 46, 52, 0.12)'], [1, 'rgba(60, 46, 52, 0)']]);
    x.save(); x.translate(0, base); x.scale(1, 0.14); x.beginPath(); x.arc(cx, 0, w * 0.6, 0, Math.PI * 2); x.restore(); x.fill();
    x.fillStyle = K.linear(x, cx + w * 0.5 * light, base - h, cx - w * 0.4 * light, base, [[0, '#9a9092'], [0.55, '#736a6e'], [1, '#4c444a']]);
    x.fill(p);
    x.save(); x.clip(p);
    // the plane facing the sun: from the crown down the lit flank, its inner edge an irregular curve
    var pk = Math.round(n * peakAt), lit = new Path2D(), sh = new Path2D();
    var sideLit = light < 0 ? 0 : n, sideSh = n - sideLit;
    lit.moveTo(pts[pk][0], pts[pk][1] - 2);
    for (var j = pk; j !== sideLit; j += sideLit > pk ? 1 : -1) lit.lineTo(pts[j][0], pts[j][1] - 2);
    lit.lineTo(pts[sideLit][0], base + 4);
    var ix = cx + light * w * (0.05 + 0.08 * r());
    lit.lineTo(ix - light * w * 0.08, base + 4);
    lit.bezierCurveTo(ix + light * w * 0.05, base - h * 0.35, ix - light * w * 0.12, base - h * 0.65, pts[pk][0] + light * w * 0.04, pts[pk][1]);
    lit.closePath();
    x.fillStyle = 'rgba(255, 242, 228, 0.2)'; x.fill(lit);
    // the plane turned away: the far flank in shade, its edge another loose curve
    sh.moveTo(pts[pk][0], pts[pk][1] - 2);
    for (var k = pk; k !== sideSh; k += sideSh > pk ? 1 : -1) sh.lineTo(pts[k][0], pts[k][1] - 2);
    sh.lineTo(pts[sideSh][0], base + 4);
    var jx = cx - light * w * (0.18 + 0.1 * r());
    sh.lineTo(jx, base + 4);
    sh.bezierCurveTo(jx - light * w * 0.08, base - h * 0.4, jx + light * w * 0.06, base - h * 0.7, pts[pk][0] - light * w * 0.08, pts[pk][1] + h * 0.05);
    sh.closePath();
    x.fillStyle = 'rgba(38, 28, 36, 0.34)'; x.fill(sh);
    for (var m = 0; m < 7; m++) { // a little moss low on the shaded side
      x.fillStyle = r() < 0.5 ? 'rgba(92, 100, 64, 0.42)' : 'rgba(110, 116, 74, 0.36)';
      x.beginPath(); x.ellipse(cx - light * w * (0.1 + 0.35 * r()), base - h * (0.01 + 0.07 * r()), w * (0.03 + 0.05 * r()), h * (0.015 + 0.02 * r()), 0, 0, Math.PI * 2); x.fill();
    }
    x.restore();
    // its foot buried: the gravel's colour rising unevenly up the stone, soft-edged
    x.save(); x.clip(p);
    for (var b = 0; b < 6; b++) {
      var bx1 = cx - w * 0.5 + w * (b + r() * 0.5) / 6, bh = h * (0.05 + 0.06 * r());
      x.fillStyle = K.radial(x, bx1, base + h * 0.02, w * 0.16, [[0, 'rgba(206, 196, 184, 0.75)'], [1, 'rgba(206, 196, 184, 0)']]);
      x.save(); x.translate(bx1, base + h * 0.02); x.scale(1, bh / (w * 0.16)); x.beginPath(); x.arc(0, 0, w * 0.16, 0, Math.PI * 2); x.restore(); x.fill();
    }
    x.restore();
    return p;
  }

  RelaxBiomes.register({
    id: 'zen-garden',
    name: 'Zen garden',
    about: 'Raked gravel round mossy stones, a temple wall with cherry trees behind it, a blossoming branch, a few petals drifting down, the morning light warming. Very sparse lo-fi in A minor: soft piano and its two-note answer, kalimba echoes, long silences, stream, bamboo knocker.',
    ink: '82, 58, 68',
    shade: '236, 226, 220',
    vignette: 0,
    legible: 0.6,
    grade: { shadow: '22, 18, 30', light: '255, 246, 236' },
    level: 1.175, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.833,

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var wallTop = H * 0.35, wallBase = H * 0.47;
      // The gravel as a ground plane: eye height EYE over it, horizon behind the wall.
      var Y0 = 0.3, A = 0.7, EYE = 0.55;
      function proj(X, Z) { return [SW * 0.5 + (X * A * SH / EYE) / Z, SH * Y0 + A * SH / Z]; }
      var light = -1; // the sun is up behind on the left: shadows fall right and towards us
      var groups = main ? [{ X: -0.3, Z: 1.85, R: 0.25, stones: [[0, 0, 0.25, 0.12, 0.16], [0.17, 0.05, 0.16, 0.058, -0.12], [-0.16, 0.07, 0.09, 0.034, 0.22]] },
        { X: 0.3, Z: 1.38, R: 0.14, stones: [[0, 0, 0.16, 0.055, -0.1], [0.11, -0.02, 0.07, 0.028, 0.18]] }]
        : [{ X: -0.1 * inner, Z: 1.62, R: 0.13, stones: [[0, 0, 0.16, 0.06, 0.08], [0.11, 0.04, 0.07, 0.027, -0.14]] }];
      if (main && inner < 0) groups.forEach(function (g) { g.X = -g.X; });

      // ---- the far world behind the wall (soft, the moving canvas)
      var bg = s.layer(), bx = bg.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, 0, wallBase, [[0, '#cfc7d2'], [0.6, '#dbd0d2'], [1, '#e2d5cf']]);
      bx.fillRect(0, 0, W, H);
      var haze = '#d6ced4';
      bx.fillStyle = K.aerial('#8e8496', haze, 0.7);
      bx.fill(K.ridge(-2, W + 2, 2, function (x) { return wallTop - H * (0.07 + 0.035 * K.noise1(x / W * 3.4 + (main ? 0 : 5), 1) + 0.012 * K.noise1(x / W * 11, 2)); }, wallBase));
      bx.fillStyle = K.aerial('#8e8496', haze, 0.5);
      bx.fill(K.ridge(-2, W + 2, 2, function (x) { return wallTop - H * (0.03 + 0.02 * K.noise1(x / W * 5 + 2, 4)); }, wallBase));
      if (main) { // a pagoda far off in the haze
        var px = W * (0.5 + 0.22 * inner), pb = wallTop + H * 0.01;
        bx.fillStyle = K.aerial('#5e5060', haze, 0.45);
        for (var tier = 0; tier < 5; tier++) {
          var ty = pb - tier * H * 0.043, tw = H * (0.066 - tier * 0.009);
          bx.beginPath(); bx.moveTo(px - tw, ty); bx.quadraticCurveTo(px - tw * 0.5, ty - H * 0.011, px - tw * 0.3, ty - H * 0.017);
          bx.lineTo(px + tw * 0.3, ty - H * 0.017); bx.quadraticCurveTo(px + tw * 0.5, ty - H * 0.011, px + tw, ty); bx.closePath(); bx.fill();
          bx.fillRect(px - tw * 0.33, ty - H * 0.043 + H * 0.017, tw * 0.66, H * 0.027);
        }
        bx.fillRect(px - 0.6, pb - H * 0.25, 1.2, H * 0.04);
      }
      // far blossom on the hills behind: only a faint haze (the near trees are drawn crisp
      // on the front layer)
      for (var ct = 0; ct < (main ? 5 : 4); ct++) {
        var cw = W * (0.12 + 0.1 * rnd()), ch = H * (0.06 + 0.04 * rnd());
        var m = K.mass({ w: Math.round(cw), h: Math.round(ch), light: '226, 202, 208', dark: '198, 170, 180', alpha: 0.5, cover: 0.7,
          freq: 3, seed: 40 + ct * 3 + (main ? 0 : 50), flat: 0.7, taper: 0.3, oct: 4, edge: 0.4, mottle: 0.2 });
        bx.drawImage(m, W * ((ct + 0.2 + 0.6 * rnd()) / (main ? 5 : 4)) - cw / 2, wallTop - H * 0.035 - ch * 0.8);
      }
      // the wall: a tiled coping, clay plaster between irregularly spaced timber posts
      bx.fillStyle = K.linear(bx, 0, wallTop + H * 0.02, 0, wallBase, [[0, '#c4b39e'], [0.5, '#cdbca6'], [1, '#c6b5a0']]);
      bx.fillRect(0, wallTop + H * 0.02, W, wallBase - wallTop - H * 0.02);
      var postX = -rnd() * W * 0.1;
      while (postX < W) {
        bx.fillStyle = '#8c7a70'; bx.fillRect(postX, wallTop + H * 0.02, W * 0.007, wallBase - wallTop - H * 0.02);
        bx.fillStyle = 'rgba(255, 240, 224, 0.18)'; bx.fillRect(postX, wallTop + H * 0.02, W * 0.0018, wallBase - wallTop - H * 0.02);
        postX += W * (0.13 + 0.09 * rnd());
      }
      // the coping's shadow on the plaster, soft
      bx.fillStyle = K.linear(bx, 0, wallTop + H * 0.02, 0, wallTop + H * 0.05, [[0, 'rgba(80, 60, 66, 0.3)'], [1, 'rgba(80, 60, 66, 0)']]);
      bx.fillRect(0, wallTop + H * 0.02, W, H * 0.03);
      bx.fillStyle = '#5e545b';
      bx.fillRect(0, wallTop, W, H * 0.02);
      bx.fillStyle = '#776a72'; bx.fillRect(0, wallTop - H * 0.005, W, H * 0.007);
      for (var tl = 0; tl < W; tl += H * 0.011) { bx.fillStyle = 'rgba(30, 24, 30, 0.22)'; bx.fillRect(tl, wallTop + H * 0.003, 0.8, H * 0.016); }

      // the gravel's base colour: warm near, cooler and paler towards the wall
      bx.fillStyle = K.linear(bx, 0, wallBase, 0, H, [[0, '#d0c8c2'], [0.4, '#d6cdc1'], [1, '#d9d0c2']]);
      bx.fillRect(0, wallBase, W, H - wallBase);
      // where the wall meets the gravel: a soft shade both ways, no line
      bx.fillStyle = K.linear(bx, 0, wallBase - H * 0.03, 0, wallBase + H * 0.035, [[0, 'rgba(90, 72, 72, 0)'], [0.45, 'rgba(90, 72, 72, 0.16)'],
        [0.5, 'rgba(90, 72, 72, 0.14)'], [1, 'rgba(90, 72, 72, 0)']]);
      bx.fillRect(0, wallBase - H * 0.03, W, H * 0.065);
      // moss in low mounds along the foot of the wall, so its base is not a ruled line
      for (var mo = 0; mo < 5; mo++) {
        var mw = W * (0.05 + 0.08 * rnd()), mhh = H * (0.018 + 0.014 * rnd());
        var mm = K.mass({ w: Math.round(mw), h: Math.round(mhh), light: '136, 136, 110', dark: '110, 112, 92', alpha: 0.6, cover: 0.6,
          freq: 3, seed: 120 + mo * 7 + (main ? 0 : 60), flat: 0.6, taper: 0.35, oct: 3, edge: 0.45, mottle: 0.3 });
        bx.drawImage(mm, rnd() * (W - mw), wallBase - mhh * 0.55);
      }
      if (!main) { // a roofed gate in the wall
        var gx = W * (0.5 - 0.12 * inner), gw = W * 0.05;
        bx.fillStyle = '#6a5850'; bx.fillRect(gx - gw * 0.8, wallTop + H * 0.02, gw * 1.6, wallBase - wallTop - H * 0.02);
        bx.fillStyle = 'rgba(255, 236, 214, 0.14)'; bx.fillRect(gx - 0.4, wallTop + H * 0.03, 0.8, wallBase - wallTop - H * 0.04);
        bx.fillStyle = '#4e423e';
        bx.fillRect(gx - gw, wallTop - H * 0.045, W * 0.006, wallBase - wallTop + H * 0.045);
        bx.fillRect(gx + gw - W * 0.006, wallTop - H * 0.045, W * 0.006, wallBase - wallTop + H * 0.045);
        bx.fillStyle = '#4a4048';
        bx.beginPath(); bx.moveTo(gx - gw * 1.55, wallTop - H * 0.04); bx.quadraticCurveTo(gx, wallTop - H * 0.058, gx + gw * 1.55, wallTop - H * 0.04);
        bx.lineTo(gx + gw * 1.2, wallTop - H * 0.072); bx.lineTo(gx - gw * 1.2, wallTop - H * 0.072); bx.closePath(); bx.fill();
        bx.fillStyle = '#6a5e66'; bx.fillRect(gx - gw * 1.2, wallTop - H * 0.076, gw * 2.4, H * 0.005);
      }

      // morning light: a cool cast early, warm sun later; soft shafts through the trees
      var rays = K.rays(W, H, { x: main ? W * 0.06 : -W * 0.3, y: -H * 0.2, angle: main ? 0.5 : 0.62, spread: 0.35, count: 4,
        length: H * 1.4, width: W * 0.07, rgb: '255, 232, 196', alpha: main ? 0.22 : 0.14, seed: 23 + (main ? 0 : 9), patchy: 0.6 });

      // ---- on the main screen the wall turns towards us on the outer side: a second wall in
      // shade, its top running down towards the viewer (it breaks the horizontal bands)
      var ZW = A / (wallBase / H - Y0), HW = (wallBase - wallTop) / H * ZW * EYE / A;
      var sideWall = null;
      if (main) {
        var uc = 0.5 - inner * 0.41, XC = (uc - 0.5) * SW * EYE * ZW / (A * SH), ZN = 1.25;
        var top = function (Z) { var q = proj(XC, Z); return [q[0], SH * Y0 + (A * SH / Z) * (1 - HW / EYE)]; };
        var b0 = proj(XC, ZW), b1 = proj(XC, ZN), t0 = top(ZW), t1 = top(ZN);
        sideWall = new Path2D();
        sideWall.moveTo(b0[0], b0[1]); sideWall.lineTo(b1[0], b1[1]); sideWall.lineTo(t1[0], t1[1] - SH * 0.02 * ZW / ZN); sideWall.lineTo(t0[0], t0[1] - SH * 0.02);
        sideWall.closePath();
        var k = 1 / s.scale;
        bx.save(); bx.scale(k, k);
        bx.fillStyle = K.linear(bx, b0[0], 0, b1[0], 0, [[0, '#b3a493'], [1, '#a0917f']]);
        bx.beginPath(); bx.moveTo(b0[0], b0[1]); bx.lineTo(b1[0], b1[1]); bx.lineTo(t1[0], t1[1]); bx.lineTo(t0[0], t0[1]); bx.closePath(); bx.fill();
        bx.fillStyle = '#5e545b'; // its coping, thicker as it comes closer
        bx.beginPath(); bx.moveTo(t0[0], t0[1] + SH * 0.003); bx.lineTo(t1[0], t1[1] + SH * 0.003 * ZW / ZN);
        bx.lineTo(t1[0], t1[1] - SH * 0.02 * ZW / ZN); bx.lineTo(t0[0], t0[1] - SH * 0.02); bx.closePath(); bx.fill();
        bx.fillStyle = 'rgba(70, 56, 60, 0.35)'; // the corner post, and the shade where the walls meet
        bx.fillRect(t0[0] - SW * 0.004, t0[1], SW * 0.008, b0[1] - t0[1]);
        bx.restore();
      }

      // ---- the raked gravel at full resolution: lines that run straight across and bend
      // round each group of stones, rings close round them, fading into a smooth plane far off
      var lantern = main ? null : { X: 0.8 * -inner, Z: 2.9 };
      function rake(fx) {
        var dz = 0.021;
        fx.save();
        if (sideWall) { var cl = new Path2D(); cl.rect(0, 0, SW, SH); cl.addPath(sideWall); fx.clip(cl, 'evenodd'); }
        function stroke(pts, a) {
          if (pts.length < 2 || a <= 0.01) return;
          fx.strokeStyle = 'rgba(112, 96, 92, ' + (0.32 * a).toFixed(3) + ')'; fx.lineWidth = 1;
          fx.beginPath(); fx.moveTo(pts[0][0], pts[0][1] + 0.8); for (var i = 1; i < pts.length; i++) fx.lineTo(pts[i][0], pts[i][1] + 0.8); fx.stroke();
          fx.strokeStyle = 'rgba(255, 250, 242, ' + (0.42 * a).toFixed(3) + ')';
          fx.beginPath(); fx.moveTo(pts[0][0], pts[0][1]); for (var j = 1; j < pts.length; j++) fx.lineTo(pts[j][0], pts[j][1]); fx.stroke();
        }
        var fade = function (Z) { return K.smooth((3.1 - Z) / 1.3); };
        var rr = K.seeded(5 + s.seed);
        for (var Z = 0.98; Z < 4.2; Z += dz * (0.92 + 0.16 * rr())) {
          var a = fade(Z);
          if (a <= 0.01) break;
          var pts = [], halfW = (SW * 0.6) * Z * EYE / (A * SH);
          for (var X = -halfW; X <= halfW; X += halfW / 160) {
            var z2 = Z, hide = false;
            for (var g = 0; g < groups.length; g++) {
              var gr = groups[g], ro = gr.R + 6.6 * dz, d = Math.hypot(X - gr.X, Z - gr.Z);
              if (d < ro) { hide = true; break; }
              // lines close to a ring lean a little round it before running straight on
              var band = 3 * dz;
              if (d < ro + band) z2 += Math.sign(Z - gr.Z || 1) * (ro + band - d) * 0.22;
            }
            if (lantern && Math.hypot(X - lantern.X, (Z - lantern.Z) * 1.6) < 0.2) hide = true;
            if (hide) { stroke(pts, a); pts = []; continue; }
            pts.push(proj(X, z2));
          }
          stroke(pts, a);
        }
        groups.forEach(function (gr) {
          for (var k = 0; k < 7; k++) {
            var R = gr.R + k * dz, pts = [];
            for (var i = 0; i <= 120; i++) {
              var th = i / 120 * Math.PI * 2;
              pts.push(proj(gr.X + Math.cos(th) * R, gr.Z + Math.sin(th) * R));
            }
            stroke(pts, fade(gr.Z) * (0.85 + 0.15 * (k / 6)));
          }
        });
        // the grain of the gravel itself
        var tile = fx.createImageData(128, 128), q = K.seeded(17);
        for (var tI = 0; tI < tile.data.length; tI += 4) {
          var v = q() < 0.5 ? 70 : 255; tile.data[tI] = v; tile.data[tI + 1] = v - 6; tile.data[tI + 2] = v - 10;
          tile.data[tI + 3] = q() < 0.35 ? Math.floor(q() * 34) : 0;
        }
        var tc = K.canvas(128, 128); tc.getContext('2d').putImageData(tile, 0, 0);
        fx.fillStyle = fx.createPattern(tc, 'repeat');
        fx.fillRect(0, wallBase * s.scale, SW, SH - wallBase * s.scale);
        // a few petals that have already come down
        for (var fp = 0; fp < 14; fp++) {
          fx.fillStyle = fp % 3 ? 'rgba(217, 158, 174, 0.8)' : 'rgba(232, 190, 198, 0.8)';
          fx.beginPath(); fx.ellipse(rr() * SW, SH * (0.52 + 0.46 * Math.pow(rr(), 0.7)), 3.4, 2, rr() * 3, 0, Math.PI * 2); fx.fill();
        }
        fx.restore();
        if (lantern) stoneLantern(fx);
      }
      // a stone lantern on a moss island (the other screen's quiet focal point)
      function stoneLantern(fx) {
        var b = proj(lantern.X, lantern.Z), u = (A * SH / lantern.Z) / EYE; // screen px per true unit at that depth
        var mx = b[0], my = b[1];
        var isl = K.mass({ w: Math.round(u * 0.42), h: Math.round(u * 0.12), light: '128, 130, 104', dark: '104, 108, 88', alpha: 0.75, cover: 0.7,
          freq: 2.5, seed: 77, flat: 0.3, taper: 0.3, oct: 3, edge: 0.4, mottle: 0.3 });
        fx.drawImage(isl, mx - isl.width / 2, my - isl.height * 0.55);
        var c = K.canvas(Math.ceil(u * 0.3), Math.ceil(u * 0.36)), x = c.getContext('2d'), cw = c.width, ch = c.height, m = cw / 2;
        var part = function (y0, y1, w0, w1) { x.beginPath(); x.moveTo(m - w0, y0); x.lineTo(m + w0, y0); x.lineTo(m + w1, y1); x.lineTo(m - w1, y1); x.closePath(); x.fill(); };
        x.fillStyle = '#7e7678';
        part(ch, ch * 0.9, cw * 0.2, cw * 0.17);           // base
        part(ch * 0.9, ch * 0.55, cw * 0.07, cw * 0.06);   // pillar
        part(ch * 0.55, ch * 0.5, cw * 0.18, cw * 0.15);   // platform
        part(ch * 0.5, ch * 0.33, cw * 0.12, cw * 0.12);   // light box
        x.fillStyle = '#3e363a'; x.fillRect(m - cw * 0.05, ch * 0.37, cw * 0.1, ch * 0.09); // its window
        x.fillStyle = '#6e6668';
        x.beginPath(); x.moveTo(m - cw * 0.46, ch * 0.33); x.quadraticCurveTo(m - cw * 0.2, ch * 0.3, m - cw * 0.1, ch * 0.18);
        x.lineTo(m + cw * 0.1, ch * 0.18); x.quadraticCurveTo(m + cw * 0.2, ch * 0.3, m + cw * 0.46, ch * 0.33); x.closePath(); x.fill(); // roof
        part(ch * 0.18, ch * 0.08, cw * 0.035, cw * 0.02); // finial
        x.beginPath(); x.arc(m, ch * 0.07, cw * 0.04, 0, Math.PI * 2); x.fill();
        K.rim(c, light, -0.6, 2.5, '255, 242, 226', 0.45, 0.8);
        x.globalCompositeOperation = 'source-atop'; // the flank away from the sun in shade
        x.fillStyle = 'rgba(40, 30, 38, 0.25)'; x.fillRect(m - light * cw * 0.02, 0, -light * cw * 0.5, ch);
        fx.drawImage(c, mx - cw / 2, my - ch + 2);
      }

      // ---- cherry trees behind the wall, mid-distance: dark trunks and limbs, crowns of
      // blossom clumps with lighter tops and gaps, cut off by the coping in front of them
      function trees(fx) {
        var r = K.seeded(808 + (main ? 0 : 41));
        var copeY = (wallTop - H * 0.005) * s.scale;
        var pag = main ? SW * (0.5 + 0.22 * inner) : -1e4;
        // one asymmetric group that runs across the gap between the monitors (three on the main
        // screen's inner side, the nearest leaning out over the wall, two more on the other screen),
        // with long open stretches of wall either side
        var spots = main ? [[0.5 + 0.46 * inner, 0], [0.5 + 0.385 * inner, 1], [0.5 + 0.3 * inner, 0]]
          : [[0.5 + 0.43 * inner, 1], [0.5 + 0.33 * inner, 0]];
        spots.forEach(function (sp, i) {
          var u = sp[0], over = sp[1];
          fx.save();
          fx.beginPath(); fx.rect(0, 0, SW, copeY + (over ? SH * 0.05 : 0)); fx.clip();
          var bx0 = SW * (u + (r() - 0.5) * 0.03);
          if (Math.abs(bx0 - pag) < SW * 0.1) bx0 += (bx0 < pag ? -1 : 1) * SW * 0.08; // leave the pagoda clear
          var h = SH * (0.12 + 0.07 * r()) * (over ? 1.25 : 1), cw = SW * (0.08 + 0.05 * r()) * (over ? 1.3 : 1);
          var lean = (r() - 0.5) * 0.25;
          var topX = bx0 + lean * h * 0.4, topY = copeY - h * 0.28;
          fx.strokeStyle = '#7a666b'; fx.lineCap = 'round';
          fx.lineWidth = SH * 0.006;
          fx.save(); fx.beginPath(); fx.rect(0, 0, SW, copeY); fx.clip(); // the trunk stays behind the wall
          fx.beginPath(); fx.moveTo(bx0, copeY + 4); fx.quadraticCurveTo(bx0 + lean * h * 0.2, copeY - h * 0.2, topX, topY); fx.stroke();
          fx.restore();
          var ends = [];
          // limbs spread wide and low: a cherry is an umbrella, not a ball
          for (var l = 0; l < 5; l++) {
            var a = -Math.PI / 2 + (l / 4 - 0.5) * 2.5 + (r() - 0.5) * 0.35 + (over ? inner * 0.25 : 0), len = h * (0.3 + 0.25 * r());
            var ex = topX + Math.cos(a) * len * 1.7, ey = topY + Math.sin(a) * len * 0.8;
            fx.lineWidth = SH * (0.0022 + 0.0016 * r());
            fx.beginPath(); fx.moveTo(topX, topY); fx.quadraticCurveTo(topX + Math.cos(a) * len * 0.5, topY + Math.sin(a) * len * 0.3, ex, ey); fx.stroke();
            ends.push([ex, ey]);
          }
          ends.push([topX, topY - h * 0.22]);
          // blossom: small dots in lumpy clumps; noise leaves gaps where the hills show
          ends.forEach(function (e, k) {
            var rx = cw * (0.36 + 0.16 * r()), ry = h * (0.17 + 0.08 * r()), seed = i * 17 + k * 5 + (main ? 0 : 300);
            for (var d = 0; d < 340; d++) {
              var ang = r() * Math.PI * 2, rad = Math.sqrt(r());
              var px = e[0] + Math.cos(ang) * rad * rx, py = e[1] + Math.sin(ang) * rad * ry;
              var nz = K.noise2(px / (SH * 0.03), py / (SH * 0.03), seed);
              if (nz < -0.35 + rad * 0.5) continue;
              var v = (py - (e[1] - ry)) / (2 * ry); // 0 top .. 1 bottom of the clump
              var lit = K.clamp(1 - v * 1.1 + (e[0] - px) / rx * 0.15 + nz * 0.25, 0, 1);
              fx.fillStyle = K.mix('#c4a0ac', '#e9d6da', lit, 0.9);
              fx.beginPath(); fx.arc(px, py, SH * (0.0028 + 0.003 * r()), 0, Math.PI * 2); fx.fill();
            }
          });
          // dark limbs showing through the gaps in the blossom
          fx.strokeStyle = 'rgba(110, 88, 94, 0.32)'; fx.lineWidth = 1.3;
          ends.forEach(function (e, k) {
            if (k % 2) return;
            fx.beginPath(); fx.moveTo(topX, topY); fx.quadraticCurveTo((topX + e[0]) / 2, (topY + e[1]) / 2 - h * 0.05, e[0], e[1]); fx.stroke();
          });
          fx.restore();
        });
      }

      // ---- the stones' shadows (they shorten and swing as the sun climbs), then the stones
      var shadows = [];
      groups.forEach(function (gr, gi) {
        var c = proj(gr.X, gr.Z);
        var sw = Math.round(SW * 0.26), shh = Math.round(SH * 0.12);
        var spr = s.sprite(sw, shh, function (x, w, h) {
          var tmp = K.canvas(w, h), tx = tmp.getContext('2d');
          gr.stones.forEach(function (st) {
            var sc = proj(gr.X + st[0], gr.Z + st[1]);
            var hgt = st[3] * SH * 1.8 / gr.Z, wid = st[2] * SW * 0.62 / gr.Z;
            var ox = sc[0] - c[0], oy = sc[1] - c[1];
            ox += w * 0.25;
            tx.fillStyle = 'rgba(70, 56, 66, 0.42)';
            tx.beginPath(); tx.moveTo(ox - wid * 0.3, h / 2 + oy - wid * 0.1); tx.quadraticCurveTo(ox + hgt * 1.6, h / 2 + oy - wid * 0.2, ox + hgt * 2.3, h / 2 + oy + wid * 0.02);
            tx.quadraticCurveTo(ox + hgt * 1.4, h / 2 + oy + wid * 0.22, ox - wid * 0.3, h / 2 + oy + wid * 0.12); tx.closePath(); tx.fill();
          });
          x.filter = 'blur(3px)'; x.drawImage(tmp, 0, 0);
        });
        spr.el.style.transformOrigin = (sw * 0.25) + 'px ' + (shh / 2) + 'px';
        shadows.push({ el: spr.el, x: c[0] - sw * 0.25, y: c[1] - shh / 2, last: '' });
        void gi;
      });
      var stoneSpr = s.sprite(SW, SH, function (x) {
        var list = [];
        groups.forEach(function (gr) { gr.stones.forEach(function (st) { list.push([gr, st]); }); });
        list.sort(function (a, b) { return (b[0].Z + b[1][1]) - (a[0].Z + a[1][1]); }); // far ones first
        list.forEach(function (e, i) {
          var gr = e[0], st = e[1], sc = proj(gr.X + st[0], gr.Z + st[1]);
          stone(x, sc[0], sc[1], st[2] * SW * 0.62 / gr.Z * (main ? 1 : 1), st[3] * SH * 1.8 / gr.Z, st[4], 300 + i * 17 + (main ? 0 : 99), light);
        });
      });
      void stoneSpr;

      // ---- the branch in the upper corner (main screen only), a touch out of focus
      var sway = null;
      if (main) {
        var bw = Math.round(SW * 0.46), bh = Math.round(SH * 0.42), bxo = inner > 0 ? 0 : SW - bw;
        sway = s.sprite(bw, bh, function (cx, w, h) {
          var c = K.canvas(w, h), x = c.getContext('2d'), r = K.seeded(606 + s.seed);
          if (inner < 0) { x.translate(w, 0); x.scale(-1, 1); }
          var blooms = [];
          branch(x, r, -w * 0.04, h * 0.05, w * 0.42, 0.3, SH * 0.02, 3, blooms);
          branch(x, r, w * 0.1, -h * 0.04, w * 0.28, 0.95, SH * 0.011, 2, blooms);
          blooms.forEach(function (b) {
            var n = 2 + Math.floor(r() * 4);
            for (var i = 0; i < n; i++) blossom(x, r, b[0] + (r() - 0.5) * SH * 0.04, b[1] + (r() - 0.5) * SH * 0.03, SH * (0.008 + 0.006 * r()));
          });
          cx.filter = 'blur(1.1px)'; cx.drawImage(c, 0, 0);
        }, inner > 0 ? 0 : bw, 0);
        sway.base = bxo;
      }

      // ---- petals: about ten in the air, drifting down slowly, each its own sprite
      var petals = [];
      for (var pi = 0; pi < (main ? 10 : 6); pi++) {
        var pr = 4 + rnd() * 3;
        var spr = s.sprite(Math.ceil(pr * 3), Math.ceil(pr * 3), (function (rad, tone) {
          return function (x, w, h) {
            x.fillStyle = tone ? '#dba4b2' : '#e7bec7';
            x.beginPath(); x.ellipse(w / 2, h / 2, rad, rad * 0.62, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = 'rgba(180, 104, 126, 0.35)';
            x.beginPath(); x.ellipse(w / 2 + rad * 0.5, h / 2, rad * 0.35, rad * 0.2, 0, 0, Math.PI * 2); x.fill();
          };
        })(pr, rnd() < 0.6), Math.ceil(pr * 1.5), Math.ceil(pr * 1.5));
        petals.push({ el: spr.el, x0: rnd() * SW, y0: rnd() * SH, vx: (2 + 3 * rnd()) * inner * (main ? 1 : -1), vy: 4 + 5 * rnd(),
          seed: pi * 3.7, spin: 0.15 + 0.25 * rnd(), last: '' });
      }

      // a soft darkening at the edges of the picture (the page's own vignette is a pale one)
      var edges = s.layer(), ex = edges.getContext('2d');
      ex.fillStyle = K.radial(ex, W / 2, H * 0.48, W * 0.72, [[0.55, 'rgba(70, 56, 64, 0)'], [1, 'rgba(70, 56, 64, 0.14)']]);
      ex.fillRect(0, 0, W, H);
      var step = -1;

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(bg, 0, 0);
          // early: a cool, lavender cast; later the sun warms everything
          var warm = K.smooth(p);
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = K.mix('#ebe7f1', '#fff6ea', warm); ctx.fillRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.25 + 0.55 * warm;
          ctx.drawImage(rays, 0, 0);
          ctx.globalAlpha = 1;
          ctx.fillStyle = K.linear(ctx, 0, wallTop, 0, H, [[0, 'rgba(255, 214, 170, ' + (0.03 + 0.07 * warm).toFixed(3) + ')'], [1, 'rgba(255, 214, 170, 0)']]);
          ctx.fillRect(0, wallTop, W, H - wallTop);
          ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(edges, 0, 0);

          // shadows shorten and swing as the sun climbs
          var len = 1 - 0.45 * warm, ang = 10 + 7 * warm;
          for (var i = 0; i < shadows.length; i++) {
            var sh = shadows[i];
            var tr = 'translate(' + sh.x.toFixed(1) + 'px,' + sh.y.toFixed(1) + 'px) rotate(' + ang.toFixed(2) + 'deg) scale(' + len.toFixed(3) + ',' + (0.9 + 0.1 * len).toFixed(3) + ')';
            if (tr !== sh.last) { sh.el.style.transform = tr; sh.last = tr; }
          }
          // the petals drift a pixel or so a step: moving them on every other frame halves
          // the page's work and looks the same
          var st = Math.floor(t * 7.5);
          if (st === step) return;
          step = st;
          if (sway) sway.set(sway.base, 0, 0.12 * K.noise1(t * 0.05, 3));
          for (var j = 0; j < petals.length; j++) {
            var pt = petals[j];
            var py = (pt.y0 + t * pt.vy) % (SH + 40) - 20;
            var px = ((pt.x0 + t * pt.vx + K.noise1(t * 0.12 + pt.seed, 2) * 30) % (SW + 40) + SW + 40) % (SW + 40) - 20;
            var flip = Math.cos(t * pt.spin * 2 + pt.seed);
            var ptr = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px) rotate(' + ((t * pt.spin * 40 + pt.seed * 50) % 360).toFixed(1) + 'deg) scale(1,' + (0.35 + 0.65 * Math.abs(flip)).toFixed(2) + ')';
            if (ptr !== pt.last) { pt.el.style.transform = ptr; pt.last = ptr; }
          }
        },
        front: function (fx) { rake(fx); trees(fx); },
      };
    },

    lofi: {
      key: 'A', mode: 'minor', bpm: 58, swing: 0.55, swing8: true,
      progs: ['i9 bVImaj7 iv9 v7', 'i9 i9 bVImaj7 bVImaj7', 'iv9 v7 i9 i9'],
      keys: { inst: 'piano', style: 'sparse', range: [52, 76], level: 0.9 },
      lead: { inst: 'piano', range: [64, 86], level: 0.58, space: true, motif: '4.4.5 8.8.3 |' },
      reply: { inst: 'kalimba', shift: 0, level: 0.38 },
      bass: null,
      drums: null,
      fx: { tone: 5000, crackle: 0.2, hiss: 0.25, wow: 0.7, room: 0.6, verb: 1.3, echo: 0, duck: 0 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      var rv = K.reverb(ac, 3.4, 2.6, out, 0.3);
      var nextKnock = t0 + 20;
      // the stream: a soft wash and tiny bright water notes
      var stream = K.gain(ac, 0.075, out);
      K.loop(ac, K.noise(ac, 'pink', 6), K.filter(ac, 'bandpass', 1300, 0.7, stream), t0);
      var babble = K.filter(ac, 'lowpass', 2800, 0.3, K.gain(ac, 1, out));
      var nextDrop = t0 + 0.3;

      return function schedule(until) {
        while (nextKnock < until) { // the bamboo knocker tipping over: one hollow "tok"
          var kt = nextKnock;
          [[420, 0.045, 0.09], [890, 0.018, 0.04]].forEach(function (pp) {
            var o = ac.createOscillator(); var og = ac.createGain();
            o.frequency.setValueAtTime(pp[0] * 1.06, kt); o.frequency.exponentialRampToValueAtTime(pp[0], kt + 0.02);
            og.gain.setValueAtTime(0.0001, kt); og.gain.linearRampToValueAtTime(pp[1], kt + 0.003);
            og.gain.exponentialRampToValueAtTime(0.0001, kt + pp[2] + 0.12);
            o.connect(og); og.connect(K.panner(ac, 0.45, out)); og.connect(rv); o.start(kt); o.stop(kt + 0.3);
          });
          nextKnock = kt + 32 + Math.random() * 18;
        }
        while (nextDrop < until) {
          var o2 = ac.createOscillator(); var g2 = ac.createGain(); var ff = 900 + Math.random() * 1400;
          o2.frequency.setValueAtTime(ff, nextDrop); o2.frequency.exponentialRampToValueAtTime(ff * 1.5, nextDrop + 0.03);
          g2.gain.setValueAtTime(0.0001, nextDrop); g2.gain.linearRampToValueAtTime(0.004 + Math.random() * 0.004, nextDrop + 0.004);
          g2.gain.exponentialRampToValueAtTime(0.0001, nextDrop + 0.05);
          o2.connect(g2); g2.connect(K.panner(ac, 0.3 + Math.random() * 0.4, babble)); o2.start(nextDrop); o2.stop(nextDrop + 0.06);
          nextDrop += 0.05 + Math.random() * 0.25;
        }
      };
    },
  });
})();

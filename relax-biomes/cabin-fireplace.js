// Cabin fireplace - a log cabin at night: a fire in a stone hearth throwing
// warm, flickering light over the room, embers rising, a candle on the
// mantel, and through the window snow falling on dark pines.
// Music: slow lo-fi piano in B-flat (62 bpm): held maj9 chords, a theme from the upper
// sixth with a low answer, upright bass, brushes; the fire crackling, the wind.
(function () {
  'use strict';
  var K = window.RelaxKit;

  // Paint a layer's colours multiplied by a light colour, keeping its alpha: the same
  // room under the fire, under the embers or in the dark.
  function lightLayer(src, rgb) {
    var c = K.canvas(src.width, src.height), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = 'rgb(' + rgb + ')'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-over';
    return c;
  }
  // Keep only what a light at (x, y) reaches: full near it, nothing beyond r.
  function falloff(c, x0, y0, r, stops) {
    var x = c.getContext('2d');
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = K.radial(x, x0, y0, r, (stops || [[0, 1], [0.22, 0.8], [0.5, 0.36], [0.8, 0.1], [1, 0]]).map(function (q) {
      return [q[0], 'rgba(0,0,0,' + q[1] + ')'];
    }));
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
    return c;
  }

  RelaxBiomes.register({
    id: 'cabin-fireplace',
    name: 'Cabin fireplace',
    about: 'A log cabin at night: a fire in a stone hearth slowly burning down to embers, a candle, a cat asleep on the rug, snow falling outside. Slow lo-fi piano in B-flat with a low answer, upright bass, brushes, the fire, wind.',
    ink: '255, 236, 214',
    shade: '18, 9, 5',
    vignette: 0.32,
    grade: { shadow: '14, 10, 16', light: '255, 238, 220' },
    level: 0.894, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.919,

    scene: function (s) {
      var W = s.W, H = s.H, SW = s.SW, SH = s.SH, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      // One perspective for the whole room: eye height a little below the middle, the
      // vanishing point towards the other screen, so the floor runs on across both.
      var VP = { x: W * (main ? 0.5 + 0.06 * inner : 0.5 - 0.95 * inner), y: H * 0.46 };
      var floorY = H * 0.72;
      function toward(x, y, k) { return [VP.x + (x - VP.x) * k, VP.y + (y - VP.y) * k]; }
      var outer = -inner;
      // the hearth (main screen only), on the side away from the other screen
      var cx0 = W * (0.5 + outer * 0.2) - W * 0.16, cx1 = cx0 + W * 0.32; // chimney breast front face
      var dz = H * 0.035, kBack = (floorY - VP.y) / (floorY + dz - VP.y);
      var fire = { x: (cx0 + cx1) / 2, y: floorY + dz - H * 0.035 };
      var ow = W * 0.17, oh = H * 0.24, oBase = floorY + dz;
      var mantelY = H * 0.335;
      var win = main ? { x: W * (0.5 + inner * 0.25) - W * 0.09, y: H * 0.15, w: W * 0.18, h: H * 0.34 }
        : { x: W * (0.5 - 0.04 * inner) - W * 0.17, y: H * 0.13, w: W * 0.34, h: H * 0.42 };

      // ---- the outside, seen through the window: a cold night, pines, snow on the ground
      var outside = s.layer(), ox = outside.getContext('2d');
      ox.fillStyle = K.linear(ox, 0, win.y, 0, win.y + win.h, [[0, '#0a1430'], [0.55, '#1a2b52'], [1, '#33476f']]);
      ox.fillRect(win.x, win.y, win.w, win.h);
      ox.save(); ox.beginPath(); ox.rect(win.x, win.y, win.w, win.h); ox.clip();
      var moonX = win.x + win.w * (inner > 0 ? 0.25 : 0.75), moonY = win.y + win.h * 0.2;
      ox.fillStyle = K.radial(ox, moonX, moonY, win.w * 0.5, [[0, 'rgba(170, 190, 230, 0.35)'], [1, 'rgba(170, 190, 230, 0)']]);
      ox.fillRect(win.x, win.y, win.w, win.h);
      var stR = K.seeded(13 + s.seed);
      for (var si = 0; si < 40; si++) {
        ox.fillStyle = 'rgba(230, 238, 255, ' + (0.2 + 0.5 * stR() * stR()).toFixed(3) + ')';
        ox.fillRect(win.x + stR() * win.w, win.y + stR() * win.h * 0.45, 0.6, 0.6);
      }
      // far ridge, then two rows of pines, nearer ones darker and bigger
      ox.fillStyle = '#22335a';
      ox.fill(K.ridge(win.x, win.x + win.w, 1, function (x) { return win.y + win.h * (0.62 - 0.05 * K.noise1(x * 0.08, 3)); }, win.y + win.h));
      [[0.7, 0.24, '#182648', 11], [0.8, 0.42, '#0d1631', 7]].forEach(function (row, ri) {
        ox.fillStyle = row[2];
        for (var pi = 0; pi < row[3]; pi++) {
          var px = win.x + win.w * ((pi + stR() * 0.8) / row[3]), pb = win.y + win.h * (row[0] + 0.04 * stR());
          var ph = win.h * row[1] * (0.6 + 0.5 * stR()), pw = ph * 0.2;
          ox.beginPath(); ox.moveTo(px, pb - ph);
          for (var tier = 1; tier <= 5; tier++) {
            var ty = pb - ph + ph * tier / 5, tw = pw * (0.35 + 0.65 * tier / 5);
            ox.lineTo(px + tw, ty); ox.lineTo(px + tw * 0.45, ty - ph * 0.04);
          }
          for (var tier2 = 5; tier2 >= 1; tier2--) {
            var ty2 = pb - ph + ph * tier2 / 5, tw2 = pw * (0.35 + 0.65 * tier2 / 5);
            ox.lineTo(px - tw2 * 0.45, ty2 - ph * 0.04); ox.lineTo(px - tw2, ty2);
          }
          ox.closePath(); ox.fill();
        }
      });
      ox.fillStyle = K.linear(ox, 0, win.y + win.h * 0.84, 0, win.y + win.h, [[0, '#7d92bd'], [1, '#56698f']]);
      ox.fillRect(win.x, win.y + win.h * 0.85, win.w, win.h * 0.15);
      ox.restore();

      // ---- the room's own colours (albedo), lit later by the fire, the embers or the night
      var A = s.layer(), ax = A.getContext('2d'), r = K.seeded(71 + s.seed);
      // a log wall: rounded logs with pale chinking between them
      var logH = H * 0.058;
      for (var ly = -logH * 0.4; ly < floorY; ly += logH) {
        ax.fillStyle = K.linear(ax, 0, ly, 0, ly + logH, [[0, '#a07250'], [0.25, '#8a5f40'], [0.8, '#5e3e28'], [1, '#3c2618']]);
        ax.fillRect(0, ly, W, logH);
        ax.fillStyle = 'rgba(196, 170, 140, 0.55)';
        ax.fillRect(0, ly + logH - 1.1, W, 1.1);
        for (var kn = 0; kn < 5; kn++) { // knots and checks in the wood
          ax.fillStyle = 'rgba(40, 24, 14, 0.35)';
          ax.fillRect(r() * W, ly + logH * (0.3 + 0.4 * r()), W * (0.02 + 0.05 * r()), 0.6);
        }
      }
      // a ceiling beam across the top
      ax.fillStyle = K.linear(ax, 0, 0, 0, H * 0.05, [[0, '#2a190f'], [1, '#5a3a24']]);
      ax.fillRect(0, 0, W, H * 0.05);
      // the window opening: frame, the reveal on the far side, a deep sill
      ax.clearRect(win.x, win.y, win.w, win.h);
      ax.fillStyle = '#6a4a32';
      var fw = W * 0.008;
      ax.fillRect(win.x - fw, win.y - fw, win.w + 2 * fw, fw); ax.fillRect(win.x - fw, win.y + win.h, win.w + 2 * fw, fw * 1.8);
      ax.fillRect(win.x - fw, win.y, fw, win.h); ax.fillRect(win.x + win.w, win.y, fw, win.h);
      ax.fillStyle = '#4a3020';
      ax.fillRect(win.x + win.w / 2 - fw * 0.35, win.y, fw * 0.7, win.h); ax.fillRect(win.x, win.y + win.h * 0.5 - fw * 0.35, win.w, fw * 0.7);

      // the floor: planks running towards the vanishing point, joints staggered
      ax.fillStyle = '#7a5236'; ax.fillRect(0, floorY, W, H - floorY);
      var kBottom = (H - VP.y) / (floorY - VP.y);
      for (var pb2 = -W * 2; pb2 < W * 3; pb2 += W * 0.036) {
        var b0 = toward(pb2, floorY, kBottom);
        var shade = 0.82 + 0.3 * r();
        ax.fillStyle = 'rgba(' + Math.round(122 * shade) + ',' + Math.round(82 * shade) + ',' + Math.round(54 * shade) + ',0.9)';
        var b1 = toward(pb2 + W * 0.036, floorY, kBottom);
        ax.beginPath(); ax.moveTo(pb2, floorY); ax.lineTo(pb2 + W * 0.036, floorY); ax.lineTo(b1[0], b1[1]); ax.lineTo(b0[0], b0[1]); ax.fill();
        ax.strokeStyle = 'rgba(30, 16, 8, 0.6)'; ax.lineWidth = 0.6;
        ax.beginPath(); ax.moveTo(pb2, floorY); ax.lineTo(b0[0], b0[1]); ax.stroke();
        for (var jn = 0; jn < 2; jn++) { // a butt joint somewhere along the plank
          var kj = 1 + (kBottom - 1) * r(), j0 = toward(pb2, floorY, kj), j1 = toward(pb2 + W * 0.036, floorY, kj);
          ax.beginPath(); ax.moveTo(j0[0], j0[1]); ax.lineTo(j1[0], j1[1]); ax.stroke();
        }
      }
      // the wall meets the floor in shadow
      ax.fillStyle = K.linear(ax, 0, floorY - H * 0.02, 0, floorY + H * 0.03, [[0, 'rgba(20, 10, 6, 0)'], [0.45, 'rgba(20, 10, 6, 0.6)'], [1, 'rgba(20, 10, 6, 0)']]);
      ax.fillRect(0, floorY - H * 0.02, W, H * 0.05);

      if (main) {
        // the chimney breast: its side face, receding to the wall
        var sx1 = VP.x + (cx1 - VP.x) * kBack, sx0 = VP.x + (cx0 - VP.x) * kBack;
        var sideX = VP.x > cx1 ? cx1 : cx0, sideB = VP.x > cx1 ? sx1 : sx0;
        ax.fillStyle = '#6b5e55';
        ax.beginPath(); ax.moveTo(sideX, 0); ax.lineTo(sideX, floorY + dz); ax.lineTo(sideB, floorY); ax.lineTo(sideB, 0); ax.fill();
        // its front face: big interlocking stones, varied, narrow mortar between them
        ax.fillStyle = '#5b524c'; ax.fillRect(cx0, 0, cx1 - cx0, floorY + dz);
        var rowY = 0;
        while (rowY < floorY + dz) {
          var rh = H * (0.03 + 0.03 * r()), sx = cx0 - r() * W * 0.03;
          while (sx < cx1) {
            var sw = W * (0.025 + 0.045 * r()), sh = rh * (0.75 + 0.35 * r());
            var g = 0.85 + 0.35 * r(), tint = r() < 0.3 ? [150, 128, 108] : r() < 0.5 ? [126, 120, 116] : [138, 124, 112];
            var gx0 = Math.max(cx0, sx + 0.7), gx1 = Math.min(cx1, sx + sw - 0.7);
            if (gx1 - gx0 > 1.5) {
              var cy = rowY + rh / 2 + (r() - 0.5) * rh * 0.15;
              var col = Math.round(tint[0] * g) + ',' + Math.round(tint[1] * g) + ',' + Math.round(tint[2] * g);
              // lit from the fire's side: brighter on the edge that faces the opening
              var dirx = fire.x - (gx0 + gx1) / 2, diry = fire.y - cy, dl = Math.hypot(dirx, diry) || 1;
              var hx = (gx0 + gx1) / 2, hy = cy;
              ax.fillStyle = K.linear(ax, hx - dirx / dl * sw * 0.5, hy - diry / dl * sh * 0.5, hx + dirx / dl * sw * 0.5, hy + diry / dl * sh * 0.5,
                [[0, K.mix(col, '#2a221e', 0.45)], [1, K.mix(col, '#e8d2b8', 0.25)]]);
              var rr = Math.min(sh, gx1 - gx0) * 0.35;
              ax.beginPath();
              ax.moveTo(gx0 + rr, cy - sh / 2); ax.lineTo(gx1 - rr * (0.6 + 0.6 * r()), cy - sh / 2 + (r() - 0.5));
              ax.quadraticCurveTo(gx1, cy - sh / 2, gx1, cy - sh / 2 + rr);
              ax.lineTo(gx1 - 0.5 * r(), cy + sh / 2 - rr);
              ax.quadraticCurveTo(gx1, cy + sh / 2, gx1 - rr, cy + sh / 2);
              ax.lineTo(gx0 + rr, cy + sh / 2);
              ax.quadraticCurveTo(gx0, cy + sh / 2, gx0, cy + sh / 2 - rr);
              ax.lineTo(gx0 + 0.5 * r(), cy - sh / 2 + rr);
              ax.quadraticCurveTo(gx0, cy - sh / 2, gx0 + rr, cy - sh / 2);
              ax.fill();
            }
            sx += sw;
          }
          rowY += rh;
        }
        // the firebox: an arched opening with its inner walls in perspective
        var oL = fire.x - ow / 2, oR = fire.x + ow / 2, oTop = oBase - oh;
        var arch = new Path2D();
        arch.moveTo(oL, oBase); arch.lineTo(oL, oTop + oh * 0.28);
        arch.quadraticCurveTo(oL, oTop, fire.x, oTop); arch.quadraticCurveTo(oR, oTop, oR, oTop + oh * 0.28);
        arch.lineTo(oR, oBase); arch.closePath();
        ax.fillStyle = '#3a2a22'; ax.fill(arch);
        var kIn = 0.86, bL = toward(oL, oBase, kIn), bR = toward(oR, oBase, kIn), bT = toward(fire.x, oTop + oh * 0.1, kIn);
        ax.save(); ax.clip(arch);
        ax.fillStyle = '#1e1410'; // the back wall of the firebox, soot-dark
        ax.fillRect(bL[0], bT[1], bR[0] - bL[0], bL[1] - bT[1]);
        ax.fillStyle = '#4a3a30'; // its floor
        ax.beginPath(); ax.moveTo(oL, oBase); ax.lineTo(oR, oBase); ax.lineTo(bR[0], bR[1]); ax.lineTo(bL[0], bL[1]); ax.fill();
        ax.restore();
        // a heavy oak mantel; its underside shows (the eye is below it) and catches the fire
        var mL = cx0 - W * 0.02, mR = cx1 + W * 0.02, mH = H * 0.034;
        ax.fillStyle = '#6e4a2e'; ax.fillRect(mL, mantelY, mR - mL, mH);
        ax.fillStyle = '#c08a58'; ax.fillRect(mL, mantelY + mH, mR - mL, H * 0.008);
        ax.fillStyle = 'rgba(40, 22, 12, 0.5)'; ax.fillRect(mL, mantelY, mR - mL, 1);
        // books and a jar standing on it
        [[0.04, 0.052, '#7a3a30'], [0.06, 0.06, '#3d5654'], [0.075, 0.046, '#8a6a3a']].forEach(function (b) {
          ax.fillStyle = b[2]; ax.fillRect(mL + W * b[0], mantelY - H * b[1], W * 0.013, H * b[1]);
        });
        ax.fillStyle = '#5a6a62'; ax.fillRect(mR - W * 0.06, mantelY - H * 0.032, W * 0.018, H * 0.032);
        // the hearth stone in front: a slab projecting into the room
        var hk = (floorY + dz + H * 0.055 - VP.y) / (floorY + dz - VP.y);
        var h0 = toward(cx0 - W * 0.015, floorY + dz, hk), h1 = toward(cx1 + W * 0.015, floorY + dz, hk);
        ax.fillStyle = '#7a706a';
        ax.beginPath(); ax.moveTo(cx0 - W * 0.015, floorY + dz); ax.lineTo(cx1 + W * 0.015, floorY + dz);
        ax.lineTo(h1[0], h1[1]); ax.lineTo(h0[0], h0[1]); ax.fill();
        ax.fillStyle = '#4a423e'; ax.fillRect(h0[0], h0[1], h1[0] - h0[0], H * 0.012);
        // logs in the grate
        ax.fillStyle = '#3a2416';
        ax.save(); ax.translate(fire.x, oBase - H * 0.022); ax.rotate(-0.1); ax.fillRect(-ow * 0.36, -H * 0.016, ow * 0.72, H * 0.03); ax.restore();
        ax.save(); ax.translate(fire.x + ow * 0.04, oBase - H * 0.04); ax.rotate(0.14); ax.fillRect(-ow * 0.3, -H * 0.014, ow * 0.6, H * 0.026); ax.restore();
        // a rug in front of the hearth, in perspective, and the shadows things cast on the floor
        var rugY = H * 0.885, rugX = fire.x + W * 0.04 * inner;
        ax.fillStyle = 'rgba(20, 10, 6, 0.4)';
        ax.beginPath(); ax.ellipse(rugX + 1, rugY + 1.5, W * 0.215, H * 0.066, 0, 0, Math.PI * 2); ax.fill();
        ax.fillStyle = '#8a3a2c';
        ax.beginPath(); ax.ellipse(rugX, rugY, W * 0.21, H * 0.062, 0, 0, Math.PI * 2); ax.fill();
        ax.strokeStyle = '#c08a50'; ax.lineWidth = 1.2;
        ax.beginPath(); ax.ellipse(rugX, rugY, W * 0.175, H * 0.048, 0, 0, Math.PI * 2); ax.stroke();
        ax.strokeStyle = 'rgba(60, 20, 14, 0.7)'; ax.lineWidth = 0.8;
        ax.beginPath(); ax.ellipse(rugX, rugY, W * 0.12, H * 0.032, 0, 0, Math.PI * 2); ax.stroke();
      } else {
        // the window side: a bench under the window with a folded blanket, a shelf
        var bY = floorY + H * 0.04, bL2 = win.x - W * 0.02, bR2 = win.x + win.w + W * 0.02;
        ax.fillStyle = '#5a3a24'; ax.fillRect(bL2, bY - H * 0.1, bR2 - bL2, H * 0.03);
        ax.fillStyle = '#3e2818'; ax.fillRect(bL2 + W * 0.01, bY - H * 0.07, W * 0.012, H * 0.07); ax.fillRect(bR2 - W * 0.022, bY - H * 0.07, W * 0.012, H * 0.07);
        ax.fillStyle = '#7a4a3a'; ax.fillRect(bL2 + (bR2 - bL2) * 0.6, bY - H * 0.125, W * 0.08, H * 0.026);
        ax.fillStyle = '#8f5a46'; ax.fillRect(bL2 + (bR2 - bL2) * 0.6, bY - H * 0.125, W * 0.08, H * 0.006);
        ax.fillStyle = 'rgba(20, 10, 6, 0.45)';
        ax.beginPath(); ax.ellipse((bL2 + bR2) / 2, bY + H * 0.005, (bR2 - bL2) * 0.52, H * 0.014, 0, 0, Math.PI * 2); ax.fill();
        var shX = W * (0.5 + 0.38 * outer) - W * 0.06;
        ax.fillStyle = '#4a2e1c'; ax.fillRect(shX, H * 0.3, W * 0.13, H * 0.012);
        [[0.008, 0.05, '#6a3a30'], [0.024, 0.044, '#34504c'], [0.038, 0.056, '#7a5a34'], [0.07, 0.03, '#5a6a62']].forEach(function (b) {
          ax.fillStyle = b[2]; ax.fillRect(shX + W * b[0], H * 0.3 - H * b[1], W * 0.012, H * b[1]);
        });
      }

      // ---- the three lights on the room
      var dark = lightLayer(A, '60, 60, 82');
      var dx = dark.getContext('2d');
      // the night's cold light through the window, a pale patch across the floor
      dx.globalCompositeOperation = 'lighter';
      var wb = win.y + win.h;
      var sp = K.canvas(W, H), spx = sp.getContext('2d');
      spx.fillStyle = K.linear(spx, 0, floorY, 0, H, [[0, 'rgba(119, 148, 196, 0.07)'], [1, 'rgba(119, 148, 196, 0)']]);
      spx.beginPath(); spx.moveTo(win.x + win.w * 0.15, floorY + H * 0.01); spx.lineTo(win.x + win.w * 0.85, floorY + H * 0.01);
      spx.lineTo(win.x + win.w * 1.1 - inner * W * 0.06, H); spx.lineTo(win.x - win.w * 0.1 - inner * W * 0.06, H); spx.fill();
      dx.drawImage(K.blurred(sp, 4), 0, 0);
      if (!main) { // the moonlight catches the bench under the window
        dx.fillStyle = 'rgba(119, 148, 196, 0.16)';
        dx.fillRect(bL2, bY - H * 0.1, bR2 - bL2, H * 0.008);
      }
      dx.fillStyle = K.radial(dx, win.x + win.w / 2, wb, win.w * 0.9, [[0, 'rgba(119, 148, 196, 0.1)'], [1, 'rgba(119, 148, 196, 0)']]);
      dx.fillRect(0, 0, W, H);
      // the window wall stays cool: moonlight on the logs round the window
      dx.fillStyle = K.radial(dx, win.x + win.w / 2, win.y + win.h / 2, win.w * 1.7, [[0, 'rgba(119, 148, 196, 0.08)'], [1, 'rgba(119, 148, 196, 0)']]);
      dx.fillRect(0, 0, W, H);
      dx.globalCompositeOperation = 'destination-over';
      dx.drawImage(outside, 0, 0);
      dx.globalCompositeOperation = 'source-over';

      var glowAt = main ? fire : { x: inner > 0 ? W * 1.15 : -W * 0.15, y: floorY };
      // Firelight stays round the hearth and the floor near it (#C9854E), not spread over the
      // whole room; the embers' glow sits low, on the hearth and the rug, and lasts.
      var flameLit = falloff(lightLayer(A, '201, 133, 78'), glowAt.x, glowAt.y + H * 0.04, W * (main ? 0.6 : 0.62),
        [[0, 1], [0.3, 0.85], [0.6, 0.35], [0.85, 0.08], [1, 0]]);
      var emberLit = falloff(lightLayer(A, '196, 84, 44'), glowAt.x, main ? floorY + H * 0.12 : glowAt.y, W * (main ? 0.5 : 0.4),
        [[0, 1], [0.35, 0.65], [0.75, 0.18], [1, 0]]);
      // the window is outside: no firelight on it
      [flameLit, emberLit].forEach(function (c) { c.getContext('2d').clearRect(win.x, win.y, win.w, win.h); });
      if (main) {
        // what the chair and the cat hide from the fire, cast on the floor away from it
        var chX = W * (0.5 + inner * 0.37), shL = K.canvas(W, H), shx = shL.getContext('2d');
        shx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        shx.beginPath(); shx.ellipse(chX + inner * W * 0.05, H * 0.975, W * 0.11, H * 0.02, 0, 0, Math.PI * 2); shx.fill();
        shx.beginPath(); shx.ellipse(fire.x + inner * W * 0.12, H * 0.9, W * 0.05, H * 0.012, 0, 0, Math.PI * 2); shx.fill();
        var shB = K.blurred(shL, 2.5);
        [flameLit, emberLit].forEach(function (c) {
          var x = c.getContext('2d'); x.globalCompositeOperation = 'destination-out'; x.drawImage(shB, 0, 0); x.globalCompositeOperation = 'source-over';
        });
        var dkx = dark.getContext('2d');
        dkx.fillStyle = 'rgba(8, 4, 2, 0.5)';
        dkx.beginPath(); dkx.ellipse(chX, H * 0.985, W * 0.075, H * 0.012, 0, 0, Math.PI * 2); dkx.fill();
        // the cat's contact shadow, under it whatever the light
        var ccx = fire.x + inner * W * 0.07, cs = K.canvas(W, H), csx = cs.getContext('2d');
        csx.fillStyle = 'rgba(10, 4, 2, 0.6)'; csx.beginPath(); csx.ellipse(ccx, H * 0.905, W * 0.042, H * 0.01, 0, 0, Math.PI * 2); csx.fill();
        var csB = K.blurred(cs, 1.2);
        [dark, flameLit, emberLit].forEach(function (c) { c.getContext('2d').drawImage(csB, 0, 0); });
      }

      // ---- the fire itself: four to six overlapping tongues drawn small, scaled up soft
      var FS = 0.5, fwid = ow * 1.05, fhgt = H * 0.24;
      var fcv = K.canvas(fwid * FS, fhgt * FS), fcx = fcv.getContext('2d');
      var flames = [];
      for (var f = 0; f < 6; f++) {
        var c6 = (f - 2.5) / 2.5;
        flames.push({ dx: c6 * ow * 0.27 + (rnd() - 0.5) * ow * 0.06, h: H * (0.07 + 0.08 * (1 - Math.abs(c6))), w: ow * (0.07 + 0.03 * rnd()),
          seed: 11 + f * 5, out: 0.35 + 0.55 * (Math.abs(c6) * 0.6 + rnd() * 0.4) });
      }
      // glowing cracks in the logs: the embers that are left at the end
      var coals = K.field(Math.ceil(ow * 0.8), Math.ceil(H * 0.06), function (u, v, out) {
        var n = K.fbm2(u * 9, v * 4, 3, 27) * 0.5 + 0.5;
        var a = K.smooth((n - 0.45) / 0.25) * Math.sin(Math.PI * v) * K.smooth(Math.min(u, 1 - u) / 0.15);
        if (a <= 0.01) return null;
        out[0] = 255; out[1] = 110 + 90 * n; out[2] = 40; out[3] = a * 0.8; return out;
      });
      coals = K.blurred(coals, 1.2);
      // A tongue of flame drawn in a unit box (base 0, tip -1) and scaled into place, so its
      // gradient is made once, not twice per tongue per frame.
      var OUTER = K.linear(fcx, 0, 0, 0, -1, [[0, 'rgba(255, 200, 120, 0.8)'], [0.3, 'rgba(255, 130, 48, 0.55)'], [0.7, 'rgba(214, 64, 20, 0.22)'], [1, 'rgba(170, 30, 10, 0)']]);
      var CORE = K.linear(fcx, 0, 0, 0, -1, [[0, 'rgba(255, 246, 214, 0.7)'], [0.6, 'rgba(255, 206, 120, 0.3)'], [1, 'rgba(255, 180, 80, 0)']]);
      function flame(ctx, x, base, h, w, sway, grad) {
        var sw = sway / w;
        ctx.save(); ctx.translate(x, base); ctx.scale(w, h);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-1, 0);
        ctx.bezierCurveTo(-1.1, -0.45, sw * 0.4 - 0.4, -0.72, sw, -1);
        ctx.bezierCurveTo(sw * 0.4 + 0.4, -0.72, 1.1, -0.45, 1, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      var fireBloom = K.bloom('255, 168, 90', 1.6), candleBloom = K.bloom('255, 196, 120', 1);
      var candle = { x: cx0 + (cx1 - cx0) * (inner > 0 ? 0.78 : 0.22), y: mantelY };
      // the candle's own small light on the mantel and the stones round it: it stays when the
      // fire is down, so the room keeps one warm point. Only its patch is kept, to draw small.
      var cR = W * 0.15, cbx = Math.max(0, Math.floor(candle.x - cR)), cby = Math.max(0, Math.floor(candle.y - H * 0.05 - cR));
      var candleLit = null;
      if (main) {
        var cl = falloff(lightLayer(A, '255, 190, 120'), candle.x, candle.y - H * 0.05, cR, [[0, 0.9], [0.35, 0.45], [0.7, 0.12], [1, 0]]);
        candleLit = K.canvas(Math.ceil(cR * 2), Math.ceil(cR * 2));
        candleLit.getContext('2d').drawImage(cl, cbx, cby, candleLit.width, candleLit.height, 0, 0, candleLit.width, candleLit.height);
      }

      // ---- snow falling past the window: a crisp sprite, two depths, thinning
      var wsx = Math.round(win.x * s.scale) + 4, wsy = Math.round(win.y * s.scale) + 4;
      var wsw = Math.round(win.w * s.scale) - 8, wsh = Math.round(win.h * s.scale) - 8;
      var snowSpr = s.sprite(wsw, wsh, function () {});
      snowSpr.set(wsx, wsy, 0, 1);
      var snx = snowSpr.el.getContext('2d');
      function snowTex(n, rmin, rmax, seed) {
        var c = K.canvas(wsw, wsh), x = c.getContext('2d'), q = K.seeded(seed);
        for (var i = 0; i < n; i++) {
          var px = q() * wsw, py = q() * wsh, pr = rmin + (rmax - rmin) * q() * q();
          x.fillStyle = 'rgba(236, 242, 255, ' + (0.35 + 0.5 * q()).toFixed(3) + ')';
          for (var k = -1; k <= 1; k++) { x.beginPath(); x.arc(px, py + k * wsh, pr, 0, Math.PI * 2); x.fill(); }
        }
        return c;
      }
      var snowFar = snowTex(main ? 90 : 160, 0.6, 1.3, 31), snowNear = snowTex(main ? 22 : 40, 1.2, 2.6, 37);

      // ---- the chair, a side table and the cat: crisp silhouettes, their fire-facing
      // edges lit (a sprite whose light follows the fire)
      var DARK = '#0f0806';
      function chairAndTable(x) {
        x.fillStyle = DARK;
        if (!main) return;
        // an armchair in profile, facing the fire, and a round side table with a mug
        var cxp = SW * (0.5 + inner * 0.37), u = SH * 0.36, d = -inner, fl = SH * 0.99;
        var P = function (a, b) { return [cxp + d * a * u, fl - b * u]; };
        var poly = function (pts) { x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.closePath(); x.fill(); };
        var q0 = P(-0.42, 0.3), q1 = P(-0.52, 1.02), q2 = P(-0.4, 1.1), q3 = P(-0.27, 1.0), q4 = P(-0.2, 0.42);
        x.beginPath(); x.moveTo(q0[0], q0[1]); x.lineTo(q1[0], q1[1]);
        x.quadraticCurveTo(q2[0], q2[1] - u * 0.04, q3[0], q3[1]); x.lineTo(q4[0], q4[1]); x.closePath(); x.fill(); // the back
        poly([P(-0.36, 0.48), P(0.32, 0.46), P(0.38, 0.4), P(0.36, 0.26), P(-0.4, 0.26)]); // the seat
        var a0 = P(-0.26, 0.66), a1 = P(0.36, 0.62);
        x.beginPath(); x.moveTo(a0[0], a0[1]); x.lineTo(a1[0], a1[1] - u * 0.01);
        var a2 = P(0.42, 0.58), a3 = P(0.34, 0.5); x.quadraticCurveTo(a2[0], a2[1], a3[0], a3[1]);
        var a4 = P(-0.26, 0.54); x.lineTo(a4[0], a4[1]); x.closePath(); x.fill(); // the arm
        poly([P(0.25, 0.52), P(0.33, 0.52), P(0.31, 0.26), P(0.27, 0.26)]); // its front post
        poly([P(0.26, 0.27), P(0.33, 0.27), P(0.31, 0), P(0.285, 0)]); poly([P(-0.38, 0.27), P(-0.31, 0.27), P(-0.33, 0), P(-0.355, 0)]);
        var tx = cxp + d * SW * 0.145, ty = SH * 0.79;
        x.beginPath(); x.ellipse(tx, ty, SW * 0.03, SH * 0.007, 0, 0, Math.PI * 2); x.fill();
        x.fillRect(tx - SW * 0.0035, ty, SW * 0.007, SH * 0.16);
        poly([[tx - SW * 0.003, SH * 0.94], [tx + SW * 0.003, SH * 0.94], [tx + SW * 0.024, SH * 0.985], [tx + SW * 0.018, SH * 0.988], [tx, SH * 0.955],
          [tx - SW * 0.018, SH * 0.988], [tx - SW * 0.024, SH * 0.985]]);
        x.beginPath(); x.moveTo(tx - SW * 0.009, ty - SH * 0.032); x.lineTo(tx + SW * 0.007, ty - SH * 0.032);
        x.lineTo(tx + SW * 0.006, ty - SH * 0.002); x.lineTo(tx - SW * 0.008, ty - SH * 0.002); x.closePath(); x.fill();
        x.lineWidth = SH * 0.004; x.strokeStyle = DARK;
        x.beginPath(); x.arc(tx - inner * SW * 0.011, ty - SH * 0.018, SH * 0.008, 0, Math.PI * 2); x.stroke();
      }
      var catX = SW * (fire.x / W + inner * 0.07), catY = SH * 0.875, kr = SW * 0.034;
      function cat(x) {
        x.fillStyle = DARK;
        var f = -Math.sign(catX - fire.x * s.scale) || 1; // face the fire
        x.beginPath(); x.ellipse(catX, catY, kr, kr * 0.6, 0, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.ellipse(catX + f * kr * 0.8, catY - kr * 0.1, kr * 0.38, kr * 0.34, 0, 0, Math.PI * 2); x.fill();
        x.beginPath(); x.moveTo(catX + f * kr * 1.08, catY - kr * 0.28); x.lineTo(catX + f * kr * 1.04, catY - kr * 0.62); x.lineTo(catX + f * kr * 0.88, catY - kr * 0.36); x.fill();
        x.beginPath(); x.moveTo(catX + f * kr * 0.8, catY - kr * 0.42); x.lineTo(catX + f * kr * 0.68, catY - kr * 0.7); x.lineTo(catX + f * kr * 0.58, catY - kr * 0.38); x.fill();
        x.strokeStyle = DARK; x.lineWidth = kr * 0.2; x.lineCap = 'round';
        x.beginPath(); x.moveTo(catX - f * kr * 0.8, catY + kr * 0.25); x.quadraticCurveTo(catX - f * kr * 0.4, catY + kr * 0.85, catX + f * kr * 0.5, catY + kr * 0.5); x.stroke();
      }
      var fireDir = -inner;
      var furniture = null, furnRim = null, catSpr = null, catRim = null;
      if (main) {
        var fc = K.canvas(SW, SH); chairAndTable(fc.getContext('2d'));
        var cc = K.canvas(SW, SH); cat(cc.getContext('2d'));
        furniture = fc;
        furnRim = s.sprite(SW, SH, function (x) { x.drawImage(K.rimLayer(fc, fireDir, -0.25, 3, '233, 150, 80', 0.85, 1), 0, 0); });
        // the cat in a small sprite so it can breathe (a pixel, every five seconds or so)
        var cbx = Math.round(catX - kr * 1.6), cby = Math.round(catY - kr * 1.1), cbw = Math.round(kr * 3.2), cbh = Math.round(kr * 2.2);
        var crop = function (src) { return function (x) { x.drawImage(src, cbx, cby, cbw, cbh, 0, 0, cbw, cbh); }; };
        catSpr = s.sprite(cbw, cbh, crop(cc));
        catRim = s.sprite(cbw, cbh, crop(K.rimLayer(cc, fireDir, -0.6, 3.4, '236, 156, 92', 0.6, 1.2)));
        catSpr.pos = [cbx, cby];
      }

      var lastSnow = -1;
      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          // The fire burns down over the break: tall flames at first, embers at the end;
          // the room dims and turns redder. Room light wavers slowly (4-7 s), the flames quicker.
          var burn = K.smooth(p * 1.05);
          var flameLevel = 1 - 0.75 * burn;
          var slow = 0.93 + 0.07 * K.flicker(t, 3, 0.17);
          var quick = 0.9 + 0.1 * K.flicker(t, 7, 0.6);
          ctx.drawImage(dark, 0, 0);
          ctx.globalAlpha = Math.min(1, flameLevel * slow * (0.92 + 0.08 * quick)); ctx.drawImage(flameLit, 0, 0);
          ctx.globalAlpha = Math.min(1, (0.25 + 0.65 * burn) * (0.9 + 0.1 * K.flicker(t, 13, 0.12))); ctx.drawImage(emberLit, 0, 0);
          if (candleLit) { ctx.globalAlpha = 0.6 * (0.94 + 0.06 * K.flicker(t, 41, 1.1)); ctx.drawImage(candleLit, cbx, cby); }
          ctx.globalAlpha = 1;

          if (main) {
            // the flames
            fcx.setTransform(1, 0, 0, 1, 0, 0); fcx.clearRect(0, 0, fcv.width, fcv.height);
            fcx.setTransform(FS, 0, 0, FS, 0, 0);
            fcx.globalCompositeOperation = 'lighter';
            var fbase = fhgt * 0.94;
            for (var j = 0; j < flames.length; j++) {
              var fm = flames[j];
              var alive = K.smooth((fm.out - burn) / 0.2 + 0.5);
              if (alive <= 0.02) continue;
              var hh = fm.h * flameLevel * (0.75 + 0.35 * K.flicker(t, fm.seed, 0.7)) * alive;
              var sway = fm.w * 1.1 * K.noise1(t * 0.55 + fm.seed, 5);
              if (hh < 1) continue;
              flame(fcx, fwid / 2 + fm.dx, fbase, hh, fm.w * (0.6 + 0.4 * alive), sway, OUTER);
              if (j > 0 && j < flames.length - 1) flame(fcx, fwid / 2 + fm.dx * 0.8, fbase, hh * 0.5, fm.w * 0.5, sway * 0.5, CORE);
            }
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(fcv, fire.x - fwid / 2, oBase - fbase - H * 0.004, fwid, fhgt);
            ctx.globalAlpha = (0.45 + 0.5 * burn) * (0.75 + 0.25 * K.flicker(t, 21, 0.25));
            ctx.drawImage(coals, fire.x - coals.width / 2, oBase - H * 0.055);
            K.light(ctx, fireBloom, fire.x, oBase - H * 0.06, H * (0.16 + 0.1 * flameLevel), (0.35 + 0.3 * flameLevel) * quick, H * 0.12);
            // a candle on the mantel
            var cfl = K.flicker(t, 41, 1.1);
            K.light(ctx, candleBloom, candle.x, candle.y - H * 0.06, H * 0.07, 0.42 + 0.08 * cfl);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#d8c8b0'; ctx.fillRect(candle.x - W * 0.004, candle.y - H * 0.045, W * 0.008, H * 0.045);
            ctx.fillStyle = 'rgba(255, 222, 150, 0.95)';
            ctx.beginPath(); ctx.ellipse(candle.x + 0.3 * K.noise1(t * 0.9, 2), candle.y - H * 0.055, W * 0.0028, H * 0.0095 * (0.92 + 0.08 * cfl), 0, 0, Math.PI * 2); ctx.fill();

            var lit = Math.min(1, (flameLevel * 0.85 + 0.25 * burn) * slow);
            furnRim.set(0, 0, 0, lit * (0.9 + 0.1 * quick));
            var breathe = 0.6 * Math.sin(t * 2 * Math.PI / 4.8);
            catSpr.set(catSpr.pos[0], catSpr.pos[1] + breathe * 0.5, 0, 1);
            catRim.set(catSpr.pos[0], catSpr.pos[1] + breathe * 0.5, 0, lit);
          }
          // snow outside, thinning to a few flakes
          var sk = Math.floor(t * 7.5); // flakes drift a pixel or two a step: half the frame rate is plenty
          if (sk !== lastSnow) {
            lastSnow = sk;
            snx.clearRect(0, 0, wsw, wsh);
            var thin = 1 - 0.75 * K.smooth(p);
            var y1 = (t * 9) % wsh, y2 = (t * 22) % wsh, sx1 = Math.sin(t * 0.07) * 8;
            snx.globalAlpha = 0.8 * thin; snx.drawImage(snowFar, sx1, y1 - wsh); snx.drawImage(snowFar, sx1, y1);
            snx.globalAlpha = 0.9 * thin * thin; snx.drawImage(snowNear, sx1 * 2, y2 - wsh); snx.drawImage(snowNear, sx1 * 2, y2);
            snx.globalAlpha = 1;
          }
        },
        front: function (fx) { if (furniture) fx.drawImage(furniture, 0, 0); },
      };
    },

    lofi: {
      key: 'Bb', mode: 'major', bpm: 62, swing: 0.6, swing8: true,
      progs: ['Imaj9 vi9 ii9 V13sus', 'IVmaj9 iii7 vi9 V9sus', 'ii9 V7b9 Imaj9 VI7b9'],
      keys: { inst: 'piano', style: 'hold', range: [46, 70], level: 0.95 },
      lead: { inst: 'piano', range: [65, 86], level: 0.73, space: true, motif: '0.6.6 6.2.5 8.8.3 | 4.12.2' },
      reply: { inst: 'piano', shift: -12, level: 0.5 },
      bass: { style: 'lofi', level: 0.55 },
      drums: { style: 'brush', kit: 'brushes', level: 0.77 },
      fx: { tone: 4600, crackle: 0.25, hiss: 0.35, wow: 0.8, room: 0.35, verb: 1.0, echo: 0, duck: 0.06 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // the fire: a low breathing roar and random crackles
      var roar = K.gain(ac, 0.1, out);
      K.loop(ac, K.noise(ac, 'brown', 7), K.filter(ac, 'lowpass', 320, 0.5, roar), t0);
      K.lfo(ac, 0.6, 0.03, roar.gain, 'sine', t0);
      var crackBus = K.filter(ac, 'highpass', 900, 0.5, K.gain(ac, 1.5, out));
      // three pitches of crackle, each a shared filter with its place in the hearth: no nodes per pop but two
      var crackTones = [[1500, -0.3], [2600, -0.1], [3800, -0.45]].map(function (c) {
        return K.filter(ac, 'bandpass', c[0], 1.5, K.panner(ac, c[1], crackBus));
      });
      var crackBuf = K.noise(ac, 'white', 1);
      var nextCrack = t0 + 0.3;
      // the wind outside, far and soft
      var wind = K.gain(ac, 0.018, out);
      var wbp = K.filter(ac, 'bandpass', 300, 1.2, wind);
      K.loop(ac, K.noise(ac, 'pink', 8), wbp, t0);
      K.lfo(ac, 0.03, 120, wbp.frequency, 'sine', t0);

      return function schedule(until) {
        while (nextCrack < until) {
          var n = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
          var ct = nextCrack, tone = crackTones[Math.floor(Math.random() * crackTones.length)];
          for (var i = 0; i < n; i++) {
            var src = ac.createBufferSource(); src.buffer = crackBuf;
            var g = ac.createGain(); var lv = 0.02 + Math.random() * 0.06 * (Math.random() < 0.15 ? 2 : 1);
            g.gain.setValueAtTime(0.0001, ct); g.gain.linearRampToValueAtTime(lv, ct + 0.001);
            g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.01 + Math.random() * 0.03);
            src.connect(g); g.connect(tone);
            src.start(ct, Math.random() * 0.9); src.stop(ct + 0.06);
            ct += 0.02 + Math.random() * 0.06;
          }
          nextCrack = ct + 0.12 + Math.random() * 0.9;
        }
      };
    },
  });
})();

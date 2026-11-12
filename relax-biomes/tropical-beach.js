// Tropical beach - the sun going down into a warm sea, long clouds lit from
// below, waves washing up the sand and sliding back as the tide creeps in,
// a palm leaning over it all with its crown swaying.
// Music: bossa-tinged lo-fi in C (80 bpm, straight): nylon guitar comping the bossa and answering
// the vibraphone theme, upright bass, cross-stick clave and shaker; surf every nine seconds.
(function () {
  'use strict';
  var K = window.RelaxKit;
  var WAVE_S = 9;

  // One palm frond against the sky: an arching midrib carrying a connected curtain of
  // leaflets on each side - a broad leaf mass whose lower edge is serrated by the leaflet
  // tips, splitting into separate leaflets only towards the end. sag 0 = a young frond whose
  // leaflets stand out sideways, 1 = an old one whose leaflets hang down; bend curves the
  // midrib sideways so no two fronds share a curve.
  function frond(fx, cx, cy, deg, len, droop, sag, bend, rnd) {
    var a = deg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    function pt(q) {
      var b = len * bend * Math.sin(Math.PI * q);
      return [cx + dx * len * q - dy * b, cy + dy * len * q + dx * b + droop * q * q];
    }
    fx.lineCap = 'round'; fx.lineWidth = len * 0.016;
    fx.beginPath();
    for (var s2 = 0; s2 <= 1.0001; s2 += 0.04) { var pp = pt(s2); if (s2 === 0) fx.moveTo(pp[0], pp[1]); else fx.lineTo(pp[0], pp[1]); }
    fx.stroke();
    for (var side = -1; side <= 1; side += 2) {
      var spine = [], edge = [];
      for (var q = 0.06; q <= 0.985; q += 0.022) {
        var b0 = pt(q), b1 = pt(Math.min(1, q + 0.01));
        var ux = b1[0] - b0[0], uy = b1[1] - b0[1], ul = Math.hypot(ux, uy) || 1;
        ux /= ul; uy /= ul;
        var nx = -uy * side, ny = ux * side;
        var vx = nx * (1 - sag) * 0.8 + ux * 0.4, vy = ny * (1 - sag) * 0.8 + uy * 0.4 + sag;
        var vl = Math.hypot(vx, vy) || 1;
        vx /= vl; vy /= vl;
        var L = len * (0.27 + 0.05 * side) * Math.pow(Math.sin(Math.PI * Math.min(1, q * 1.03)), 0.6) * (0.85 + 0.25 * rnd());
        spine.push(b0);
        // tip, then a notch: shallow along most of the frond, deep (split) near its end
        var notch = q > 0.72 ? 0.25 + 0.2 * rnd() : 0.72 + 0.12 * rnd();
        edge.push([b0[0] + vx * L, b0[1] + vy * L + L * 0.1 * sag]);
        var bn = pt(Math.min(1, q + 0.011));
        edge.push([bn[0] + vx * L * notch, bn[1] + vy * L * notch]);
      }
      fx.beginPath();
      fx.moveTo(spine[0][0], spine[0][1]);
      for (var i = 1; i < spine.length; i++) fx.lineTo(spine[i][0], spine[i][1]);
      var tip = pt(1); fx.lineTo(tip[0], tip[1]);
      for (var j = edge.length - 1; j >= 0; j--) fx.lineTo(edge[j][0], edge[j][1]);
      fx.closePath(); fx.fill();
    }
  }

  // Long low clouds, soft all round with a firmer base, lit from below by the low sun.
  function stratus(w, h, seed, top, bottom, alpha) {
    var tc = K.rgb(top), bc = K.rgb(bottom);
    return K.field(w, h, function (u, v, out) {
      var ends = K.smooth(Math.min(u, 1 - u) / 0.32);
      var prof = K.smooth(v / 0.6) * K.smooth((1 - v) / 0.16);
      var n = K.fbm2(u * 3.2, v * 1.3, 4, seed) * 0.5 + 0.5;
      var al = ends * prof * K.smooth((n - 0.22) / 0.5) * alpha;
      if (al < 0.004) return null;
      var k = K.smooth(v * 1.1);
      out[0] = tc[0] + (bc[0] - tc[0]) * k; out[1] = tc[1] + (bc[1] - tc[1]) * k; out[2] = tc[2] + (bc[2] - tc[2]) * k;
      out[3] = al;
      return out;
    });
  }

  RelaxBiomes.register({
    id: 'tropical-beach',
    name: 'Tropical beach',
    about: 'Sunset over a warm sea: the sun sinking into it, long lit clouds, the tide creeping up the sand, a palm swaying, the evening star. Bossa-tinged lo-fi in C: nylon guitar comping and answering, a vibraphone theme, upright bass, cross-stick and shaker, surf every nine seconds.',
    ink: '255, 240, 228',
    shade: '36, 14, 34',
    vignette: 0.3,
    legible: 0.3,
    scale: 4,
    grade: { shadow: '22, 12, 38', light: '255, 242, 226' },
    level: 0.678, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.846,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var SW = s.SW, SH = s.SH;
      var horizon = Math.round(H * 0.55);
      // The sun stands over the sea on the main screen, towards the other one; the side
      // screen carries on the same bay with only the glow on its inner edge.
      var sunX = W * (main ? 0.5 + 0.12 * inner : (inner > 0 ? 1.15 : -0.15));
      var sunR = H * 0.05;

      function sky(stops, glowA) {
        var c = s.layer(W, horizon + 2), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, stops);
        x.fillRect(0, 0, W, horizon + 2);
        x.save(); x.translate(sunX, horizon); x.scale(2.3, 1);
        x.fillStyle = K.radial(x, 0, 0, H * 0.42, [[0, 'rgba(255, 214, 168, ' + glowA + ')'],
          [0.3, 'rgba(233, 151, 135, ' + (glowA * 0.45).toFixed(3) + ')'], [1, 'rgba(233, 151, 135, 0)']]);
        x.fillRect(-H * 0.42, -H * 0.42, H * 0.84, H * 0.42 + 2);
        x.restore();
        return c;
      }
      var skyEarly = sky([[0, '#2b2254'], [0.32, '#55316b'], [0.58, '#a14b70'], [0.78, '#d97570'], [0.92, '#efa57b'],
        [1, '#f6c58e']], 0.6);
      var skyLate = sky([[0, '#1a173f'], [0.38, '#3a2a5e'], [0.64, '#763f68'], [0.84, '#ad566b'], [0.95, '#cf7b78'],
        [1, '#dc977f']], 0.3);

      // A low island far out on the outer side, lost in the haze.
      var haze = '#d98f8c';
      var isle = s.layer(W, horizon + 2), ix = isle.getContext('2d');
      var iu0 = outer < 0 ? 0.04 : 0.62, iu1 = iu0 + (main ? 0.3 : 0.24);
      ix.fillStyle = K.aerial('#4a2a52', haze, 0.62);
      ix.fill(K.ridge(W * iu0, W * iu1, 1, function (x) {
        var u = (x - W * iu0) / (W * (iu1 - iu0));
        var v = outer < 0 ? u : 1 - u;
        var hump = 0.9 * Math.exp(-Math.pow((v - 0.22) / 0.14, 2)) + 0.35 * Math.exp(-Math.pow((v - 0.5) / 0.2, 2)) + 0.12;
        return horizon - H * 0.045 * hump * K.smooth(Math.min(u, 1 - u) / 0.08) * (1 + 0.15 * K.noise1(u * 11, 4));
      }, horizon + 1));

      // Long clouds lit from below by the low sun: violet on top, peach underneath.
      var clouds = [0, 1, 2].map(function (i) {
        var cw = Math.round(W * (0.38 + 0.2 * rnd())), chh = Math.round(H * (0.05 + 0.025 * rnd()));
        return { img: stratus(cw, chh, 13 + i * 9 + (main ? 0 : 50), '104, 62, 110', i === 1 ? '255, 190, 150' : '236, 148, 136', 0.8),
          y: H * [0.13, 0.33, 0.22][i], x0: rnd() * W, v: -(0.12 + 0.08 * i), a: [0.6, 0.85, 0.5][i] };
      });

      // The sea: the sky mirrored, rippling more towards the shore, under a tint that
      // deepens towards the beach.
      var shore0 = H * 0.79;
      var above = s.layer(W, horizon + 2), ax = above.getContext('2d');
      ax.drawImage(skyEarly, 0, 0); ax.drawImage(isle, 0, 0);
      var mirror = K.mirror(above, horizon);
      var seaTint = s.layer(), tx = seaTint.getContext('2d');
      tx.fillStyle = K.linear(tx, 0, horizon, 0, H, [[0, 'rgba(120, 60, 100, 0.12)'], [0.25, 'rgba(70, 44, 92, 0.45)'],
        [0.6, 'rgba(46, 48, 90, 0.7)'], [1, 'rgba(40, 60, 92, 0.78)']]);
      tx.fillRect(0, horizon, W, H - horizon);
      function path(seed) {
        var c = s.layer(), x = c.getContext('2d'), r = K.seeded(seed);
        for (var i = 0; i < 44; i++) {
          var d = Math.pow((i + r()) / 44, 1.4);
          var y = horizon + 1 + (shore0 - horizon) * 0.95 * d;
          var spread = W * (0.01 + 0.09 * d);
          for (var m = 0, n = 1 + Math.floor(r() * (1 + d * 3)); m < n; m++) {
            var off = (r() + r() - 1) * spread, len = W * (0.004 + 0.026 * d) * (0.4 + r());
            var a = 0.75 * Math.pow(1 - d, 1.1) * (1 - Math.abs(off) / (spread * 1.05)) * (0.5 + 0.5 * r());
            if (a <= 0.02) continue;
            x.fillStyle = K.mix('#ffe2ad', '#e99787', Math.min(1, d * 1.6), a.toFixed(3));
            x.fillRect(sunX + off - len / 2, y, len, 0.5 + d);
          }
        }
        return c;
      }
      var paths = main ? [path(5), path(19)] : null;
      var swell = K.field(Math.ceil(W / 2), Math.ceil(shore0 - horizon), function (u, v, out) {
        var n = K.noise2(u * 8, v * 46, 7);
        var a = K.clamp((n - 0.3) * 1.5, 0, 1) * 0.14 * Math.min(1, v * 2.5 + 0.15);
        if (a <= 0.003) return null;
        out[0] = 255; out[1] = 214; out[2] = 196; out[3] = a; return out;
      });

      // The beach: the waterline is two gentle, irregular curves (the water's edge and
      // the wet sand above it), never a ruler line; it bends towards the outer side.
      function shoreY(u, lift) {
        var bend = (outer < 0 ? 1 - u : u);
        return shore0 - lift + H * (0.016 * K.noise1(u * 2.2, main ? 3 : 8) + 0.006 * K.noise1(u * 6.3, 5) + 0.035 * bend * bend);
      }
      var sand = s.layer(), dx = sand.getContext('2d');
      dx.fillStyle = K.linear(dx, 0, shore0 - H * 0.02, 0, H, [[0, '#9c6c76'], [0.25, '#bb876f'], [0.6, '#a5705f'], [1, '#5e3a44']]);
      dx.beginPath(); dx.moveTo(0, H);
      for (var sx = 0; sx <= W + 4; sx += 4) dx.lineTo(sx, shoreY(sx / W, 0));
      dx.lineTo(W, H); dx.closePath(); dx.fill();
      var sandTex = K.field(Math.ceil(W / 2), Math.ceil(H * 0.3), function (u, v, out) {
        var n = K.fbm2(u * 30, v * 12, 3, 17);
        out[0] = n > 0 ? 255 : 50; out[1] = n > 0 ? 222 : 20; out[2] = n > 0 ? 196 : 34; out[3] = Math.abs(n) * 0.05;
        return out;
      });
      dx.globalCompositeOperation = 'source-atop';
      dx.drawImage(sandTex, 0, H * 0.7, W, H * 0.3);
      // the palm's long soft shadow, cast towards the viewer, away from the sun
      if (main) {
        dx.save(); dx.translate(W * (outer < 0 ? 0.09 : 0.91), H * 0.945);
        dx.filter = 'blur(2.5px)';
        dx.fillStyle = 'rgba(56, 22, 44, 0.24)';
        dx.beginPath(); dx.moveTo(0, -H * 0.006); dx.lineTo(outer * W * 0.16, H * 0.02); dx.lineTo(outer * W * 0.2, H * 0.06);
        dx.lineTo(outer * W * 0.03, H * 0.06); dx.lineTo(0, H * 0.008); dx.closePath(); dx.fill();
        dx.restore();
      }
      var breaker = K.wisps({ w: W, h: Math.round(H * 0.025), rgb: '255, 228, 214', alpha: 0.5, cover: 0.5, seed: 29, stretch: 14 });
      // Two faint, irregular, broken lines left on the wet sand by earlier washes, and the warm
      // afterglow band over the wet sand: painted once, moved with the tide.
      var washLines = s.layer(), wlx = washLines.getContext('2d');
      wlx.setLineDash([12, 5, 4, 9, 20, 6, 7, 3]);
      for (var wl = 0; wl < 2; wl++) {
        wlx.beginPath();
        for (var x3 = 0; x3 <= W + 6; x3 += 6) {
          var wy = shoreY(x3 / W, -H * (0.026 + 0.014 * wl) - H * 0.006 * K.noise1(x3 * 0.02 + wl * 5, 8 + wl));
          if (x3) wlx.lineTo(x3, wy); else wlx.moveTo(0, wy);
        }
        wlx.lineDashOffset = wl * 23;
        wlx.strokeStyle = 'rgba(255, 228, 214, ' + (0.16 - wl * 0.05).toFixed(3) + ')'; wlx.lineWidth = 0.6; wlx.stroke();
      }
      wlx.setLineDash([]);
      var afterglow = s.layer(), agx = afterglow.getContext('2d');
      agx.fillStyle = 'rgb(255, 150, 110)';
      agx.beginPath(); agx.moveTo(0, shoreY(0, 0) - 2);
      for (var x4 = 0; x4 <= W + 6; x4 += 12) agx.lineTo(x4, shoreY(x4 / W, -H * 0.03));
      agx.lineTo(W, shoreY(1, 0) - 2); agx.closePath(); agx.fill();
      var sunCore = K.bloom('255, 226, 173', 1);
      var sunHalo = K.bloom('233, 151, 135', 2.4);
      var evening = K.bloom('255, 240, 225', 0.6);

      // The palm (main screen): the trunk is crisp on the front layer; the crown is two
      // sprites - the far fronds and the near ones - swaying a few px out of step.
      var palmParts = [];
      var trunk = null, palmFoot = null, pfx = null, footBox = null;
      if (main) {
        var dir = -outer; // leans in from the outer edge
        var bx = SW * (outer < 0 ? 0.09 : 0.91), by = SH * 0.94;
        var topX = SW * (outer < 0 ? 0.2 : 0.8), topY = SH * 0.27;
        var ctrlX = SW * (outer < 0 ? 0.06 : 0.94), ctrlY = SH * 0.55;
        trunk = function (fx) {
          var left = [], right = [];
          for (var u = 0; u <= 1.0001; u += 0.02) {
            var a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
            var px = a * bx + b * ctrlX + c * topX, py = a * by + b * ctrlY + c * topY;
            var u2 = Math.min(1, u + 0.01), a2 = (1 - u2) * (1 - u2), b2 = 2 * u2 * (1 - u2), c2 = u2 * u2;
            var qx = a2 * bx + b2 * ctrlX + c2 * topX - px, qy = a2 * by + b2 * ctrlY + c2 * topY - py, ql = Math.hypot(qx, qy) || 1;
            // a root flare at the foot, then the usual taper
            var w = SH * (0.022 - 0.01 * u) * (1 + 0.06 * Math.sin(u * 60)) * (1 + 0.7 * Math.pow(Math.max(0, 1 - u / 0.07), 2));
            left.push([px - qy / ql * w, py + qx / ql * w]); right.push([px + qy / ql * w, py - qx / ql * w]);
          }
          var c3 = K.canvas(SW, SH), x = c3.getContext('2d');
          x.fillStyle = '#1d1120';
          x.beginPath(); x.moveTo(left[0][0], left[0][1]);
          left.forEach(function (pt) { x.lineTo(pt[0], pt[1]); });
          for (var i = right.length - 1; i >= 0; i--) x.lineTo(right[i][0], right[i][1]);
          x.closePath(); x.fill();
          K.rim(c3, dir, 0.35, SH * 0.004, '255, 176, 136', 0.55, 1.2);
          fx.drawImage(c3, 0, 0);
        };
        // At the foot, on the moving canvas (so it darkens with the beach): sand piled
        // around the base - it shows either side of the trunk - and the contact shadow.
        var sc = s.scale, fbx = bx / sc, fby = by / sc, fw0 = SH * 0.024 / sc;
        palmFoot = s.layer(), pfx = palmFoot.getContext('2d');
        footBox = [Math.floor(fbx - fw0 * 3.2), Math.floor(fby - fw0 * 1.6), Math.ceil(fw0 * 6.6), Math.ceil(fw0 * 3)];
        pfx.filter = 'blur(0.7px)';
        pfx.fillStyle = K.linear(pfx, 0, fby - fw0 * 1.1, 0, fby + fw0 * 0.4, [[0, '#c69578'], [1, '#a5705f']]);
        pfx.beginPath(); pfx.ellipse(fbx + dir * fw0 * 0.2, fby - fw0 * 0.1, fw0 * 2.6, fw0 * 0.75, 0, 0, Math.PI * 2); pfx.fill();
        pfx.filter = 'blur(1.5px)';
        pfx.fillStyle = 'rgba(44, 18, 34, 0.5)';
        pfx.beginPath(); pfx.ellipse(fbx + dir * fw0 * 0.4, fby + fw0 * 0.35, fw0 * 2.2, fw0 * 0.45, 0, 0, Math.PI * 2); pfx.fill();
        pfx.filter = 'none';
        var L = SH * 0.32, cw = Math.round(L * 3), chh = Math.round(L * 2.1);
        var ox = cw / 2, oy = chh * 0.28;
        var r = K.seeded(808);
        // 7 fronds of different ages - young ones up, old ones hanging - unevenly spaced, each
        // with its own sideways curve; [angle, length, droop, sag, near, bend]
        var FRONDS = [[-160, 0.9, 0.5, 0.8, 1, 0.06], [-120, 0.95, 0.4, 0.55, 0, -0.08], [-82, 0.66, 0.1, 0.25, 0, 0.1],
          [-44, 1.02, 0.4, 0.6, 1, -0.05], [-8, 1.1, 0.6, 0.85, 1, 0.09], [34, 0.82, 0.75, 1, 0, -0.06], [150, 0.8, 0.78, 1, 1, 0.04]];
        [0, 1].forEach(function (near) {
          var spr = s.sprite(cw, chh, function (cx) {
            var c = K.canvas(cw, chh), x = c.getContext('2d');
            x.fillStyle = near ? '#1b0f1c' : '#29192d'; x.strokeStyle = x.fillStyle;
            FRONDS.forEach(function (f) {
              if (f[4] !== near) return;
              var deg = dir > 0 ? f[0] : 180 - f[0];
              frond(x, ox, oy, deg, L * f[1], L * f[2], f[3], f[5] * (dir > 0 ? 1 : -1), r);
            });
            if (near) {
              [[-0.03, 0.05], [0.025, 0.06], [0, 0.085], [0.045, 0.035]].forEach(function (k) {
                x.beginPath(); x.arc(ox + k[0] * L * dir, oy + k[1] * L, L * 0.03, 0, Math.PI * 2); x.fill();
              });
            }
            K.rim(c, dir, 0.6, near ? 2 : 1.5, '255, 182, 140', near ? 0.6 : 0.4, 0.8);
            if (!near) cx.filter = 'blur(0.7px)';
            cx.drawImage(c, 0, 0);
          }, ox, oy);
          palmParts.push({ spr: spr, x: topX - ox, y: topY - oy, per: near ? 23 : 19, amp: near ? 0.7 : 0.5, seed: near ? 3 : 8 });
        });
      }
      // The side screen: a dark, low point of rock and two small palms far along the bay.
      var point = null;
      if (!main) {
        point = function (fx) {
          var x0 = outer > 0 ? SW : 0, d2 = outer > 0 ? -1 : 1, base = SH * 0.8;
          var r2 = K.seeded(91);
          var c = K.canvas(SW, SH), x = c.getContext('2d');
          x.fillStyle = '#26152b'; x.strokeStyle = '#26152b';
          // a rocky point reaching into the shallows, grounded to the bottom of the screen
          x.beginPath(); x.moveTo(x0, SH);
          function rockTop(u) {
            return base - SH * (0.075 * Math.pow(K.smooth((0.22 - u) / 0.2), 0.8) + 0.012 * K.noise1(u * 38, 2) +
              0.005 * K.noise1(u * 120, 3)) + SH * 0.012 * u / 0.22;
          }
          for (var u = 0; u <= 0.22; u += 0.004) x.lineTo(x0 + d2 * u * SW, rockTop(u));
          // the foot of the rock, ragged, running down out of the picture
          for (var v = 0; v <= 1.0001; v += 0.05) {
            var fu = 0.225 - 0.09 * Math.pow(v, 0.8) + 0.012 * K.noise1(v * 9, 6);
            x.lineTo(x0 + d2 * fu * SW, base + SH * 0.014 + (SH - base) * v);
          }
          x.closePath(); x.fill();
          [0.05, 0.115].forEach(function (u, i) {
            var px = x0 + d2 * u * SW, py = rockTop(u) + SH * 0.01, hh = SH * (0.17 - i * 0.04);
            var tx2 = px + d2 * hh * 0.22, ty2 = py - hh;
            x.lineWidth = SH * 0.006; x.lineCap = 'round';
            x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px - d2 * hh * 0.08, py - hh * 0.6, tx2, ty2); x.stroke();
            [[-160, 0.9], [-118, 1], [-70, 0.7], [-30, 1.05], [12, 0.9], [150, 0.8]].forEach(function (f) {
              frond(x, tx2, ty2, d2 > 0 ? f[0] : 180 - f[0], hh * 0.36 * f[1], hh * 0.22, 0.8, (r2() - 0.5) * 0.12, r2);
            });
          });
          K.rim(c, inner, 0.3, SH * 0.003, '255, 170, 140', 0.4, 1);
          fx.drawImage(c, 0, 0);
        };
      }

      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          // The sky passes from gold to rose over the break.
          ctx.drawImage(skyEarly, 0, 0);
          ctx.globalAlpha = K.smooth(p * 1.15); ctx.drawImage(skyLate, 0, 0);
          ctx.globalAlpha = 1;
          ctx.drawImage(isle, 0, 0);
          // The sun: partly in the sea already, gone under by about 2:20.
          var sy = horizon - sunR * (0.45 - 1.85 * p);
          var up = K.clamp((horizon + sunR - sy) / (1.45 * sunR), 0, 1);
          K.light(ctx, sunHalo, sunX, horizon - 2, H * 0.5, 0.42 * (0.35 + 0.65 * up), H * 0.3);
          if (main && sy - sunR < horizon) {
            ctx.fillStyle = K.radial(ctx, sunX, sy, sunR, [[0, 'rgba(255, 238, 200, 1)'], [0.75, 'rgba(255, 226, 173, 0.97)'],
              [1, 'rgba(240, 170, 140, 0)']]);
            ctx.beginPath(); ctx.arc(sunX, sy, sunR, 0, Math.PI * 2); ctx.fill();
            K.light(ctx, sunCore, sunX, Math.min(sy, horizon), H * 0.14, 0.45 * up);
          }
          if (main) K.light(ctx, evening, sunX - inner * W * 0.16, H * 0.2, 3, K.smooth((p - 0.6) / 0.25) * 0.9);
          for (var c = 0; c < clouds.length; c++) {
            var cl = clouds[c], cwid = cl.img.width, span = W + cwid;
            var x = ((cl.x0 + t * cl.v) % span + span) % span - cwid;
            ctx.globalAlpha = cl.a * (1 - 0.35 * p);
            ctx.drawImage(cl.img, x, cl.y);
          }
          ctx.globalAlpha = 1;

          // The sea.
          ctx.fillStyle = '#3a2a58'; ctx.fillRect(0, horizon, W, H - horizon);
          K.reflect(ctx, mirror, horizon, H, W, t, { bands: 22, amp: 2.2, speed: 0.2, squash: 1.25, alpha: 0.8 });
          ctx.drawImage(seaTint, 0, 0);
          if (paths) {
            var sh = 0.5 + 0.5 * K.noise1(t * 0.3, 5), pa = 0.15 + 0.9 * up;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = pa * sh; ctx.drawImage(paths[0], K.noise1(t * 0.11, 1) * 1.2, 0);
            ctx.globalAlpha = pa * (1 - sh); ctx.drawImage(paths[1], K.noise1(t * 0.09, 2) * 1.2, 0);
          }
          ctx.globalCompositeOperation = 'lighter';
          var rw = swell.width * 2, rh = swell.height, r1 = (t * 0.4) % rw, r2 = (t * -0.25) % rw;
          ctx.globalAlpha = 0.6; ctx.drawImage(swell, r1, horizon, rw, rh); ctx.drawImage(swell, r1 - rw, horizon, rw, rh);
          ctx.globalAlpha = 0.45; ctx.drawImage(swell, r2, horizon + 1, rw, rh); ctx.drawImage(swell, r2 + rw, horizon + 1, rw, rh);
          ctx.globalCompositeOperation = 'source-over';
          // dusk settles on the water
          ctx.globalAlpha = 0.35 * K.smooth(p);
          ctx.fillStyle = '#2a2050'; ctx.fillRect(0, horizon, W, H - horizon);
          ctx.globalAlpha = 1;

          // The beach. The tide creeps up the sand over the break; each wash (in step with
          // the surf's sound, every WAVE_S seconds) runs up fast and slides back slowly.
          var waveNo = Math.floor(t / WAVE_S), ph = (t / WAVE_S) % 1;
          var size = 0.55 + 0.45 * (K.noise1(waveNo * 1.7, 3) * 0.5 + 0.5);
          var run = ph < 0.32 ? K.smooth(ph / 0.32) : 1 - K.smooth((ph - 0.32) / 0.68);
          var tide = H * 0.03 * K.smooth(p);
          var reachPx = H * 0.022 * size * run; // ~10-24 px on screen
          var bk = ph > 0.72 ? (ph - 0.72) / 0.28 : Math.max(0, 1 - ph / 0.3);
          ctx.globalAlpha = 0.3 + 0.55 * bk;
          ctx.drawImage(breaker, 0, shoreY(0.5, tide) - H * 0.05 - H * 0.012 * run);
          ctx.globalAlpha = 1;
          ctx.drawImage(sand, 0, 0);
          if (palmFoot) ctx.drawImage(palmFoot, footBox[0], footBox[1], footBox[2], footBox[3], footBox[0], footBox[1], footBox[2], footBox[3]);
          var wetTo = Math.max(run, 1 - ph * 0.9) * size;
          // the wet sand, darker and a little glossy, where the water has just been
          ctx.fillStyle = 'rgba(96, 52, 82, 0.3)';
          ctx.beginPath(); ctx.moveTo(0, shoreY(0, 0) - 2);
          for (var x1 = 0; x1 <= W + 6; x1 += 6) ctx.lineTo(x1, shoreY(x1 / W, -tide - H * 0.022 * wetTo - H * 0.006));
          ctx.lineTo(W, shoreY(1, 0) - 2); ctx.closePath(); ctx.fill();
          // the thin sheet of water, mirroring the sky
          var edge = [];
          for (var x2 = 0; x2 <= W + 6; x2 += 6) {
            edge.push(shoreY(x2 / W, -tide - reachPx * (0.75 + 0.25 * K.noise1(x2 * 0.03 + waveNo * 2.3, 6))));
          }
          ctx.fillStyle = K.linear(ctx, 0, shore0 - H * 0.02, 0, shore0 + H * 0.08, [[0, 'rgba(70, 56, 100, 0.85)'],
            [0.5, 'rgba(150, 100, 140, 0.55)'], [1, 'rgba(240, 170, 160, 0.3)']]);
          ctx.beginPath(); ctx.moveTo(0, shoreY(0, 0) - 3);
          for (var e = 0; e < edge.length; e++) ctx.lineTo(e * 6, edge[e]);
          ctx.lineTo(W, shoreY(1, 0) - 3); ctx.closePath(); ctx.fill();
          // a thin, broken line of foam at its edge
          var foam = 0.2 + 0.4 * (ph < 0.4 ? 1 : 1 - (ph - 0.4) / 0.6);
          ctx.beginPath();
          for (var f = 0; f < edge.length; f++) { if (f) ctx.lineTo(f * 6, edge[f]); else ctx.moveTo(0, edge[0]); }
          ctx.strokeStyle = 'rgba(255, 232, 222, ' + (foam * 0.3).toFixed(3) + ')'; ctx.lineWidth = 1.8; ctx.stroke();
          ctx.setLineDash([9, 4, 3, 7, 15, 3, 5, 11, 2, 6]); ctx.lineDashOffset = waveNo * 17;
          ctx.strokeStyle = 'rgba(255, 240, 232, ' + foam.toFixed(3) + ')'; ctx.lineWidth = 0.6; ctx.stroke();
          ctx.setLineDash([]);
          // the wash lines left by earlier washes (they ride up with the tide)
          ctx.drawImage(washLines, 0, -tide);
          // the beach darkens with the sky
          ctx.globalAlpha = 0.3 * K.smooth(p);
          ctx.fillStyle = '#24183c'; ctx.fillRect(0, shore0 - H * 0.04, W, H - shore0 + H * 0.04);
          // but the wet sand keeps the afterglow
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.1 + 0.05 * K.smooth(p);
          ctx.drawImage(afterglow, 0, -tide);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;

          for (var pi = 0; pi < palmParts.length; pi++) {
            var pp = palmParts[pi];
            pp.spr.set(pp.x, pp.y, pp.amp * K.noise1(t / pp.per, pp.seed));
          }
        },

        front: function (fx) {
          if (trunk) trunk(fx);
          if (point) point(fx);
        },
      };
    },

    lofi: {
      key: 'C', mode: 'major', bpm: 80, swing: 0.5,
      progs: ['Imaj7 vi9 ii9 V13', 'Imaj7 VI7b9 ii9 V13sus', 'IVmaj7 iii7 ii9 V7b9'],
      keys: { inst: 'guitar', style: 'bossa', range: [55, 74], level: 0.9 },
      lead: { inst: 'vibes', range: [64, 86], level: 0.65, motif: '2.2.5 4.4.3 10.4.2? | 0.8.1 10.4.0' },
      reply: { inst: 'guitar', shift: -12, harm: true, level: 0.48 },
      bass: { style: 'bossa', level: 0.65 },
      drums: { style: 'bossa', snare: 'rim', hat: 'shaker', level: 1.17 },
      fx: { tone: 6500, drumTone: 9000, crackle: 0.25, hiss: 0.3, wow: 0.7, room: 0.35, verb: 0.9, echo: 0.5, duck: 0.08 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // the sea: a steady low wash, and a wave rolling up the beach every WAVE_S seconds
      var washG = K.gain(ac, 0.07, out);
      K.loop(ac, K.noise(ac, 'brown', 7), K.filter(ac, 'lowpass', 500, 0.4, washG), t0);
      var surf = K.filter(ac, 'lowpass', 1400, 0.3, K.gain(ac, 1, out));
      var surfBuf = K.noise(ac, 'pink', 8);
      var nextWave = t0 + 0.5;

      return function schedule(until) {
        while (nextWave < until) {
          var src = ac.createBufferSource(); src.buffer = surfBuf;
          var g = ac.createGain(); var w = nextWave;
          g.gain.setValueAtTime(0.0001, w);
          g.gain.linearRampToValueAtTime(0.2, w + 3.2);
          g.gain.setTargetAtTime(0.0001, w + 3.4, 1.6);
          src.connect(g); g.connect(K.panner(ac, Math.random() * 0.6 - 0.3, surf));
          src.start(w, Math.random() * 4); src.stop(w + WAVE_S + 2);
          nextWave += WAVE_S;
        }
      };
    },
  });
})();

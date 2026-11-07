// Deep space - a nebula of rose, violet and teal gas with dark dust lanes,
// curving round a dark void and turning a few degrees over the break; still
// stars, and a banded giant planet in the corner whose lit crescent widens.
// Music: sparse Rhodes-like keys in F-sharp lydian (60 bpm, no drums): slow rolled
// chords, lone vibraphone notes with a far echo, a bowed vibraphone drone, a deep bass.
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

  // A lit sphere painted pixel by pixel into a w x h canvas whose top-left is at
  // (ox, oy) on the screen: a planet of radius pr centred at (pcx, pcy), lit from L
  // (x right, y down, z towards the viewer), with gently curved bands, a soft
  // terminator, limb darkening and a thin blue atmosphere on the lit limb only.
  function planet(w, h, ox, oy, k, pcx, pcy, pr, L) {
    var c = K.canvas(w, h), x = c.getContext('2d');
    var img = x.createImageData(w, h), d = img.data;
    var tilt = -0.3, roll = -0.18, ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
    var cols = [[180, 152, 134], [130, 114, 140], [86, 94, 124], [162, 138, 136]];
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var px = (ox + i / k - pcx) / pr, py = (oy + j / k - pcy) / pr;
        var r2 = px * px + py * py, r = Math.sqrt(r2), o = (j * w + i) * 4;
        if (r > 1.03) continue;
        if (r >= 1) { // a breath of atmosphere just outside the lit limb
          var lamL = px * L[0] + py * L[1];
          var ga = Math.pow(1 - (r - 1) / 0.03, 1.5) * Math.pow(K.clamp(lamL / r * 1.2, 0, 1), 1.5) * 0.32;
          if (ga <= 0.01) continue;
          d[o] = 120; d[o + 1] = 168; d[o + 2] = 255; d[o + 3] = ga * 255;
          continue;
        }
        var nz = Math.sqrt(1 - r2);
        var lam = px * L[0] + py * L[1] + nz * L[2];
        // latitude on a sphere whose axis leans towards us and rolls a little
        var ry = px * sr + py * cr;
        var lat = Math.asin(K.clamp(ry * ct - nz * st, -1, 1));
        var b = K.clamp(0.5 + 0.5 * K.noise1(lat * 2.3, 3) + 0.07 * K.noise1(lat * 11, 4) + 0.03 * K.noise2(lat * 30, px * 3, 5), 0, 1);
        var bi = Math.min(2.999, Math.max(0, b * 3)), bk = bi - Math.floor(bi), c0 = cols[Math.floor(bi)], c1 = cols[Math.floor(bi) + 1];
        var lit = K.smooth((lam + 0.05) / 0.32) * (0.25 + 0.6 * Math.max(0, lam));
        var limb = 0.5 + 0.5 * Math.sqrt(nz);
        var amb = 0.05;
        var f = (amb + lit) * limb;
        // a 2-5 px bright edge, strongest where the light is fullest, fading towards the shadow
        var rim = Math.pow(1 - nz, 9) * K.smooth(lam / 0.55);
        d[o] = (c0[0] + (c1[0] - c0[0]) * bk) * f + 10 + 70 * rim;
        d[o + 1] = (c0[1] + (c1[1] - c0[1]) * bk) * f + 8 + 105 * rim;
        d[o + 2] = (c0[2] + (c1[2] - c0[2]) * bk) * f + 22 + 170 * rim;
        d[o + 3] = K.clamp((1 - r) * pr * k * 1.2, 0, 1) * 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function norm(v) { var m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; }

  RelaxBiomes.register({
    id: 'deep-space',
    name: 'Deep space',
    about: 'A rose and violet nebula curving round a dark void and turning slowly, still stars, a banded giant planet catching the light of a rising sun, a small moon. Sparse lo-fi keys in F-sharp lydian, lone vibraphone notes with a far echo, bowed vibraphone, no drums.',
    ink: '236, 232, 255',
    shade: '4, 3, 14',
    vignette: 0.34,
    grade: { shadow: '8, 6, 20', light: '252, 246, 255' },
    grain: 0.018,
    level: 0.883, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 0.834,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner, outer = -inner;
      var SW = s.SW, SH = s.SH, aspect = W / H;

      // One nebula for both screens: an arc of gas around a dark void whose centre sits
      // on the main screen near the edge facing the other one, so the arc runs on across
      // the pair and half of each screen stays quiet. Pair coordinates are in screen
      // heights; the main screen spans x 0..aspect.
      var mainInner = main ? inner : -inner;
      var shift = main ? 0 : -inner * aspect;
      var vcx = (0.5 + 0.4 * mainInner) * aspect, vcy = 0.6, R = 0.47;
      var M = 0.14; // margin round the screen so the slow rotation never shows an edge
      var NW = Math.round(W * 0.8 * (1 + 2 * M)), NH = Math.round(H * 0.8 * (1 + 2 * M));
      var a0 = -Math.PI / 2 - mainInner * 0.25;
      var sd = 7;
      var neb = K.field(NW, NH, function (u, v, out) {
        var X = (u * (1 + 2 * M) - M) * aspect + shift, Y = v * (1 + 2 * M) - M;
        var dx = X - vcx, dy = Y - vcy, dist = Math.sqrt(dx * dx + dy * dy), ang = Math.atan2(dy, dx);
        var env = 0.05 + 0.95 * K.smooth((Math.cos(ang - a0) + 0.6) / 1.3);
        var qx = K.fbm2(X * 1.4 + 1.7, Y * 1.4 + 9.2, 3, sd), qy = K.fbm2(X * 1.4 + 8.3, Y * 1.4 + 2.8, 3, sd + 3);
        var n = K.fbm2(X * 2.7 + 1.5 * qx, Y * 2.7 + 1.5 * qy, 5, sd + 6) * 0.5 + 0.5;
        var wdt = 0.07 + 0.045 * K.noise2(dx / dist * 1.4 + 5, dy / dist * 1.4 + 5, sd);
        var off = dist - R * (1 + 0.1 * K.noise2(dx / dist * 1.1 + 2, dy / dist * 1.1 + 7, sd + 2)) + 0.12 * (n - 0.5);
        var ring = Math.exp(-Math.pow(off / wdt, 2));
        var haze = dist < R ? 0.06 * Math.exp(-Math.pow((dist - R) / (wdt * 1.5), 2)) : 0.2 * Math.exp(-Math.pow((dist - R) / (wdt * 3.5), 2));
        var glow = (ring * K.smooth((n - 0.36) / 0.32) + haze * n) * env;
        var dust = K.smooth((K.fbm2(X * 3.4 + 11, Y * 3.4, 4, sd + 12) - 0.02) / 0.28);
        glow *= 1 - 0.78 * dust * ring;
        if (glow <= 0.004) return null;
        // rose on the side of the void, violet through the middle, teal on the outside
        var side = K.clamp(off / wdt * 0.5 + 0.5, 0, 1);
        var rr = 214 - 120 * side, gg = 104 + 46 * side, bb = 168 + 8 * side;
        var hot = 0.7 * Math.pow(K.clamp(glow * 1.2 - 0.5, 0, 1), 2);
        out[0] = rr + (255 - rr) * hot; out[1] = gg + (226 - gg) * hot; out[2] = bb + (214 - bb) * hot;
        out[3] = Math.min(0.72, glow * 0.85);
        return out;
      });
      var back = s.layer(), bx = back.getContext('2d');
      bx.fillStyle = K.linear(bx, 0, 0, W, H, [[0, '#06050f'], [0.5, '#090716'], [1, '#05040c']]);
      bx.fillRect(0, 0, W, H);
      var deep = K.bloom('110, 70, 170', 2.6);
      var core = K.bloom('255, 170, 200', 1.6);
      // the void's centre and the arc's brightest point, in this screen's canvas px
      var vx = (vcx - shift) / aspect * W, vy = vcy * H;
      var hotX = vx + Math.cos(a0) * R * H, hotY = vy + Math.sin(a0) * R * H;
      if (!main) { hotX = vx + Math.cos(a0 + mainInner * 0.9) * R * H; hotY = vy + Math.sin(a0 + mainInner * 0.9) * R * H; }

      // Stars, crisp on the front layer and fixed: mostly faint points, a few dozen
      // medium ones, at most three that stand out, none inside the planet.
      var pr = SH * 0.6, pcx = outer < 0 ? -SW * 0.035 : SW * 1.035, pcy = SH * 1.13;
      var L0 = norm([inner * 0.38, -0.32, -0.87]), L1 = norm([inner * 0.62, -0.55, -0.2]);
      var py0 = Math.floor(pcy - pr - SH * 0.02), px0 = Math.max(0, Math.floor(pcx - pr - 20)),
        px1 = Math.min(SW, Math.ceil(pcx + pr + 20));
      var PK = 0.75;
      function planetAt(Lv) {
        return planet(Math.ceil((px1 - px0) * PK), Math.ceil((SH - py0) * PK), px0, py0, PK, pcx, pcy, pr, Lv);
      }
      var lit = main ? s.sprite(px1 - px0, SH - py0, function (cx, w, h) { cx.drawImage(planetAt(L1), 0, 0, w, h); }) : null;

      var setLit = lit ? quiet(lit) : null;
      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(back, 0, 0);
          K.light(ctx, deep, hotX, hotY + H * 0.1, W * 0.55, 0.12, H * 0.5);
          // The nebula turns about the void, about 4 degrees in four minutes (0.2-0.3 px/s
          // on screen), and its light swells and settles over 70-90 s.
          var ang = inner * 0.07 * p + 0.004 * K.noise1(t / 80, 2);
          ctx.save();
          ctx.translate(vx, vy); ctx.rotate(ang); ctx.translate(-vx, -vy);
          ctx.globalAlpha = 0.88 + 0.12 * K.noise1(t / 76, 4);
          ctx.drawImage(neb, -M * W, -M * H, W * (1 + 2 * M), H * (1 + 2 * M));
          ctx.restore();
          ctx.globalAlpha = 1;
          K.light(ctx, core, hotX, hotY, H * 0.32, 0.1 + 0.08 * p + 0.03 * K.noise1(t / 88, 6), H * 0.22);
          // Sunrise on the planet: its lit crescent widens over the break.
          if (setLit) setLit(px0, py0, 0, 0.5 * K.smooth(p * 1.05));
        },

        front: function (fx) {
          var r = K.seeded(911 + (main ? 0 : 3));
          function inPlanet(x, y) { return main && Math.hypot(x - pcx, y - pcy) < pr + 3; }
          for (var i = 0; i < 2800; i++) {
            var x = r() * SW, y = r() * SH;
            if (inPlanet(x, y)) continue;
            var sa = 0.16 + 0.6 * Math.pow(r(), 2.2);
            fx.fillStyle = 'rgba(240, 238, 255, ' + sa.toFixed(3) + ')';
            fx.fillRect(x, y, sa > 0.45 ? 1.5 : 1, sa > 0.45 ? 1.5 : 1);
          }
          var tints = ['255, 246, 236', '214, 226, 255', '255, 226, 208'];
          for (var m = 0; m < 26; m++) {
            var mx = r() * SW, my = r() * SH;
            if (inPlanet(mx, my)) continue;
            fx.fillStyle = K.radial(fx, mx, my, 2.6, [[0, 'rgba(' + tints[m % 3] + ',0.9)'], [0.45, 'rgba(' + tints[m % 3] + ',0.3)'], [1, 'rgba(' + tints[m % 3] + ',0)']]);
            fx.fillRect(mx - 3, my - 3, 6, 6);
          }
          for (var b = 0; b < (main ? 3 : 2); b++) {
            var bx2 = SW * (0.15 + 0.7 * r()), by2 = SH * (0.08 + 0.55 * r());
            if (inPlanet(bx2, by2) || (Math.abs(bx2 - SW / 2) < 180 && by2 > SH * 0.2 && by2 < SH * 0.5)) continue;
            fx.fillStyle = K.radial(fx, bx2, by2, 9, [[0, 'rgba(255, 250, 244, 1)'], [0.12, 'rgba(255, 246, 236, 0.75)'], [0.35, 'rgba(220, 220, 255, 0.14)'], [1, 'rgba(220, 220, 255, 0)']]);
            fx.fillRect(bx2 - 9, by2 - 9, 18, 18);
          }
          if (!main) return;
          // the planet before its sunrise (the sprite brings the light), and a small moon
          fx.drawImage(planetAt(L0), px0, py0, px1 - px0, SH - py0);
          var mx2 = outer < 0 ? SW * 0.33 : SW * 0.67, my2 = SH * 0.47, mr = SH * 0.02;
          fx.fillStyle = K.radial(fx, mx2 + inner * mr * 0.55, my2 - mr * 0.5, mr * 1.5, [[0, '#d9d2de'], [0.45, '#837a92'], [0.8, '#2a2438'], [1, '#141020']]);
          fx.beginPath(); fx.arc(mx2, my2, mr, 0, Math.PI * 2); fx.fill();
        },
      };
    },

    lofi: {
      key: 'F#', mode: 'lydian', bpm: 60, swing: 0.55, swing8: true,
      progs: ['Imaj7#11 Imaj7#11 II II', 'Imaj9 II vi9 iii7', 'vi9 II Imaj7#11 Imaj7#11'],
      keys: { inst: 'piano', style: 'sparse', range: [50, 74], ep: true, level: 1 },
      lead: { inst: 'vibes', range: [66, 88], level: 0.73, motif: '8.8.4 | 4.12.5' },
      reply: { inst: 'vibes', shift: -12, level: 0.81 },
      pad: { inst: 'bowed', range: [57, 72], fifth: true, level: 0.72, in: ['settle', 'release', 'thin', 'outro'] },
      bass: { style: 'long', level: 0.75 },
      drums: null,
      fx: { tone: 4200, crackle: 0.2, hiss: 0.25, wow: 1, room: 0.8, verb: 2.6, echo: 1.5, echoFb: 0.3, echoTone: 2200, echoSend: 0.22, duck: 0 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // the deep swell
      var sub = ac.createOscillator(); sub.frequency.value = K.hz(30); var subG = K.gain(ac, 0.022, out);
      sub.connect(subG); sub.start(t0); K.lfo(ac, 0.04, 0.012, subG.gain, 'sine', t0);
      var hush = K.gain(ac, 0.03, out);
      var hbp = K.filter(ac, 'bandpass', 600, 0.8, hush);
      K.loop(ac, K.noise(ac, 'pink', 8), hbp, t0);
      K.lfo(ac, 0.021, 350, hbp.frequency, 'sine', t0);
      return function () {};
    },
  });
})();

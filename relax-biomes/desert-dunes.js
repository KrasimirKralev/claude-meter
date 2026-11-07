// Desert dunes - the afterglow fading over the dunes, crests catching the last
// light, the Milky Way brightening and the stars multiplying as night falls,
// a small camp far away with its fire burning down.
// Music: dark lo-fi in E Phrygian (64 bpm, half time): dusty keys, a nylon guitar
// sighing F to E, bass and cello holding E, kick and rim; wind over the sand.
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

  // A dune crest line: a skewed wave - a long gentle windward rise, a sharp crest and
  // a short steep lee face - with a little noise so no two crests repeat.
  // skew 0 = a broad, even windward swell .. 0.95 = a sharp crest over a steep slip face;
  // broken (0..1) lets the crest sink out of sight in places.
  function duneLine(seed, base, amp, freq, dir, skew, sharp, broken) {
    var r = K.seeded(seed), ph1 = r() * 6.3, ph2 = r() * 6.3;
    var sk = skew === undefined ? 0.8 : skew, pw = sharp || 1.7;
    return function (u) {
      var a1 = Math.PI * 2 * u * freq * dir + ph1, a2 = Math.PI * 2 * u * freq * 2.3 * dir + ph2;
      var c1 = 0.5 + 0.5 * Math.sin(a1 - sk * Math.sin(a1));
      var c2 = 0.5 + 0.5 * Math.sin(a2 - 0.6 * Math.sin(a2));
      var env = broken ? 1 - broken * K.smooth((K.noise1(u * 3.3, seed + 4) + 0.1) / 0.5) : 1;
      return base - amp * env * (0.74 * Math.pow(c1, pw) + 0.2 * Math.pow(c2, 1.4) + 0.06 * K.noise1(u * 9, seed));
    };
  }

  RelaxBiomes.register({
    id: 'desert-dunes',
    name: 'Desert dunes',
    about: 'Moonless desert as the afterglow fades: dune crests catching the last light, the Milky Way brightening, more stars coming out, a tiny camp fire burning down. Dark lo-fi in E Phrygian: dusty keys, a nylon guitar sighing F to E, bass and cello holding E, a slow kick and rim, wind over sand.',
    ink: '240, 232, 255',
    shade: '6, 5, 18',
    vignette: 0.3,
    grade: { shadow: '10, 8, 24', light: '255, 244, 236' },
    level: 0.843, // the music, measured to -23 LUFS like the other places (relax-report.md, V2 music)
    ambienceLevel: 1.247,

    scene: function (s) {
      var W = s.W, H = s.H, rnd = s.rnd, main = s.role === 'main', inner = s.inner;
      var SW = s.SW, SH = s.SH, aspect = W / H;
      var hz = 0.64; // the horizon, as a fraction of the height
      var horizon = Math.round(H * hz);
      // The last light is on the horizon towards the other screen on the main one,
      // behind the viewer's shoulder on the side one; the crests facing it catch it.
      var ldir = main ? inner : -inner;

      function skyLayer(stops, glowA) {
        // the whole canvas height: the dunes on the front layer dip below the horizon in places
        var c = s.layer(W, H), x = c.getContext('2d');
        x.fillStyle = K.linear(x, 0, 0, 0, horizon, stops);
        x.fillRect(0, 0, W, H);
        var gx = ldir > 0 ? W * 1.05 : -W * 0.05;
        x.save(); x.translate(gx, horizon); x.scale(1.7, 0.8);
        x.fillStyle = K.radial(x, 0, 0, H * 0.4, [[0, 'rgba(214, 146, 140,' + glowA + ')'], [0.5, 'rgba(160, 110, 140,' + (glowA * 0.35) + ')'], [1, 'rgba(120, 90, 140, 0)']]);
        x.fillRect(-H * 0.4, -H * 0.4, H * 0.8, H * 0.4 + 2);
        x.restore();
        return c;
      }
      var skyDusk = skyLayer([[0, '#070818'], [0.45, '#121334'], [0.8, '#28244c'], [0.94, '#3f345e'], [1, '#56426a']], main ? 0.3 : 0.62);
      var skyNight = skyLayer([[0, '#04050f'], [0.5, '#0a0b24'], [0.85, '#191935'], [1, '#2d2747']], 0.16);

      // The Milky Way: one narrow band for both screens, rising from the horizon on the
      // main screen's outer side and leaving through the side screen's top corner, with
      // dark dust lanes; most of the sky stays quiet. Pair coordinates in screen heights.
      var mInner = main ? inner : -inner, shift = main ? 0 : -inner * aspect;
      function px(X) { return mInner > 0 ? X : aspect - X; } // mirror when the side screen is on the left
      var ax0 = px(0.24 * aspect), ay0 = 0.98, ax1 = px(1.38 * aspect), ay1 = -0.12;
      var adx = ax1 - ax0, ady = ay1 - ay0, alen = Math.hypot(adx, ady);
      function bandAt(X, Y) { // distance from the axis, and how far along it (0..1)
        var qx = X - ax0, qy = Y - ay0;
        return [(qx * ady - qy * adx) / alen, (qx * adx + qy * ady) / (alen * alen)];
      }
      var MW = 0.115;
      var BM = 0.08; // margin, so turning the sky never shows an edge
      var band = K.field(Math.ceil(W * 0.6 * (1 + 2 * BM)), Math.ceil(horizon * 0.6 * (1 + 2 * BM)), function (u, v, out) {
        var X = (u * (1 + 2 * BM) - BM) * aspect + shift, Y = (v * (1 + 2 * BM) - BM) * hz, b = bandAt(X, Y);
        var d = b[0] / (MW * (0.8 + 0.4 * K.noise1(b[1] * 4, 2)));
        if (Math.abs(d) > 3.2) return null;
        var core = Math.exp(-d * d);
        var n = K.fbm2(X * 7, Y * 7, 4, 3) * 0.5 + 0.5;
        var rift = Math.exp(-Math.pow((d - 0.45 - 0.35 * K.noise1(b[1] * 5, 5)) / 0.28, 2)) * K.smooth((K.fbm2(X * 5, Y * 5, 3, 8) + 0.25) / 0.5);
        var knots = Math.pow(n, 1.6);
        var a = core * (0.15 + 0.85 * knots) * (1 - 0.75 * rift) * K.smooth(b[1] * 4) * 0.5;
        if (a < 0.004) return null;
        var warm = Math.exp(-d * d * 2.5) * K.smooth(1 - b[1] * 1.3);
        out[0] = 210 + 40 * warm; out[1] = 204 + 20 * warm; out[2] = 250 - 30 * warm; out[3] = a;
        return out;
      });
      var faint = K.stars(W, horizon, rnd, { faint: 380, mid: 0, bright: 0,
        density: function (v) { return 1 - v * 0.5; } }).faint;
      skyNight.getContext('2d').drawImage(faint, 0, 0); // the faint stars come out with the night sky

      // Five dunes, far to near, crest lines in screen fractions. Each is a volume: a
      // broad body in soft shade, a narrow lit edge along the crest where it faces the last
      // light, and a darker slip face whose edge runs down from the peak at a slant.
      // (in pair coordinates: the side screen shows the dunes that continue the main one's)
      var pu = main ? 0 : -inner;
      var dunes = [
        // the far ridge low and broken, so it never reads as a wall; the nearest two unlike
        // each other: a sharp crest over a steep slip face, then a broad windward slope
        duneLine(11, hz + 0.022, 0.042, 2.3, -ldir, 0.7, 1.7, 0.9), duneLine(23, hz + 0.075, 0.07, 1.55, -ldir),
        duneLine(37, hz + 0.17, 0.1, 1.1, -ldir), duneLine(53, hz + 0.3, 0.15, 0.85, -ldir, 0.95, 2.6),
        duneLine(71, 1.04, 0.17, 0.32, -ldir, 0.25, 1.2),
      ].map(function (f) { return function (u) { return f(u + pu); }; });
      var litC = ['#7e6e8a', '#88768c', '#8a6e86', '#6e566e', '#4c3c56'].map(K.rgb);
      var shdC = ['#6c5e80', '#584a68', '#463a5c', '#33294a', '#242137'].map(K.rgb);
      var nightC = K.rgb('#1a1830');
      var topF = 1;
      for (var tu = 0; tu <= 1; tu += 0.002) topF = Math.min(topF, dunes[0](tu));
      var topPx = Math.floor(topF * SH) - 2;
      // Painted pixel by pixel at the layer's own resolution (k device px per screen px),
      // edges anti-aliased against the dune behind; `night` paints it in starlight.
      function landImage(k, night) {
        var w = Math.ceil(SW * k), h = Math.ceil((SH - topPx) * k);
        var c = K.canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
        var nL = dunes.length, crest = new Float32Array(nL), slope = [];
        for (var li = 0; li < nL; li++) slope.push(new Float32Array(w + 1));
        var crests = [];
        for (var i = 0; i <= w; i++) {
          var row = [];
          for (var q = 0; q < nL; q++) row.push(dunes[q](i / w) * SH);
          crests.push(row);
        }
        for (var q2 = 0; q2 < nL; q2++) {
          for (var i2 = 0; i2 <= w; i2++) {
            var a0 = Math.max(0, i2 - 2), b0 = Math.min(w, i2 + 2);
            slope[q2][i2] = (crests[b0][q2] - crests[a0][q2]) / ((b0 - a0) / k);
          }
        }
        function colour(li, sx, dy, out) {
          // the slip face's edge leans away from the peak the deeper we are under it
          var lean = 0.75 + 0.3 * K.noise1(sx / SW * 30 + li * 3, li);
          var xs = Math.max(0, Math.min(w, Math.round((sx - dy * lean * -ldir) * k)));
          var face = slope[li][xs] * ldir; // > 0: the slope faces the light
          var wind = K.smooth((face + 0.02) / 0.22), lee = K.smooth((-face - 0.12) / 0.3);
          var edge = Math.exp(-dy / (5 + 4 * (nL - li) / nL)) * K.smooth((face - 0.04) / 0.14) * (li === 0 ? 0.4 : 1);
          var occl = K.clamp(dy / (SH * 0.14), 0, 1);
          var L = litC[li], S = shdC[li];
          for (var cc = 0; cc < 3; cc++) {
            var v = S[cc] * (1 - 0.18 * lee - 0.12 * occl) + (L[cc] - S[cc]) * (0.24 * wind * (1 - 0.6 * occl) + 0.9 * edge);
            if (night) v = v * 0.6 + nightC[cc] * 0.4 - (L[cc] - S[cc]) * 0.5 * edge;
            out[cc] = v;
          }
          return out;
        }
        var cA = [0, 0, 0], cB = [0, 0, 0];
        for (var j = 0; j < h; j++) {
          var y = topPx + (j + 0.5) / k;
          for (var i3 = 0; i3 < w; i3++) {
            var row2 = crests[i3], sx = (i3 + 0.5) / k, front = -1;
            for (var f = nL - 1; f >= 0; f--) if (y + 0.5 / k > row2[f]) { front = f; break; }
            if (front < 0) continue;
            var cov = K.clamp((y - row2[front]) * k + 0.5, 0, 1);
            colour(front, sx, Math.max(0, y - row2[front]), cA);
            var o = (j * w + i3) * 4, alpha = 1;
            if (cov < 1) {
              if (front > 0) { colour(front - 1, sx, Math.max(0, y - row2[front - 1]), cB); }
              else alpha = cov;
              for (var c4 = 0; c4 < 3; c4++) cA[c4] = front > 0 ? cB[c4] + (cA[c4] - cB[c4]) * cov : cA[c4];
            }
            d[o] = cA[0]; d[o + 1] = cA[1]; d[o + 2] = cA[2]; d[o + 3] = alpha * 255;
          }
        }
        x.putImageData(img, 0, 0);
        return c;
      }
      var nightLand = s.sprite(SW, SH - topPx, function (cx, w, h) {
        var k = cx.getTransform().a;
        cx.drawImage(landImage(k, true), 0, 0, w, h);
      });
      nightLand.set(0, topPx, 0, 0);
      var haze = [0].map(function (i) {
        return { img: K.wisps({ w: Math.round(W * 1.1), h: Math.round(H * 0.07), rgb: '176, 140, 160', alpha: 0.16, cover: 0.45, seed: 41 + i * 9, stretch: 6 }),
          y: horizon - H * (0.035 - i * 0.03), speed: (i ? -0.12 : 0.18), x0: -W * 0.05 };
      });

      // The camp (main screen only): a tent and a fire burning down to embers - a tiny
      // light with no broad halo, so it never seems to light the dunes.
      var camp = null, ember = null;
      if (main) {
        var cu = ldir > 0 ? 0.3 : 0.7;
        camp = { x: cu * SW, y: dunes[1](cu) * SH };
        ember = s.sprite(24, 24, function (cx) {
          cx.drawImage(K.bloom('255, 150, 80', 0.9), 0, 0, 24, 24);
          cx.fillStyle = 'rgba(255, 214, 160, 0.95)'; cx.fillRect(11, 11, 2, 2);
        });
      }

      var frame = 0; // the ember's light is moved on one frame in three
      var setNight = quiet(nightLand), setEmber = ember ? quiet(ember) : null;
      return {
        paint: function (ctx, t, p) {
          ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
          // Night deepens: the afterglow sinks and the Milky Way comes out with the
          // faint stars. The sky turns about 1 degree, as the real one does in four minutes.
          var night = K.smooth(p * 1.15);
          ctx.drawImage(skyDusk, 0, 0);
          ctx.globalAlpha = night; ctx.drawImage(skyNight, 0, 0);
          ctx.save();
          var pivX = (mInner > 0 ? -1.2 : aspect + 1.2) * H - shift * H, pivY = H * 2.2;
          ctx.translate(pivX, pivY); ctx.rotate(-mInner * 0.0175 * p); ctx.translate(-pivX, -pivY);
          ctx.globalAlpha = 0.35 + 0.65 * K.smooth(p * 1.2);
          ctx.drawImage(band, -BM * W, -BM * horizon, W * (1 + 2 * BM), horizon * (1 + 2 * BM));
          ctx.restore();
          ctx.globalAlpha = 1;
          for (var i = 0; i < haze.length; i++) {
            var hzl = haze[i], hx = hzl.x0 + Math.sin(t * hzl.speed / 40) * 40 * Math.sign(hzl.speed);
            ctx.globalAlpha = 0.9 - 0.5 * night;
            ctx.drawImage(hzl.img, hx, hzl.y);
          }
          ctx.globalAlpha = 1;
          setNight(0, topPx, 0, night);
          if (ember) {
            var burn = 1 - 0.5 * K.smooth(p);
            var fl = K.clamp(0.8 + 0.22 * K.flicker(t, 3, 0.6), 0.45, 1) * burn;
            if ((frame++ % 3) === 0) setEmber(camp.x + 14 - 12, camp.y - 3 - 12, 0, Math.round(fl * 25) / 25);
          }
        },

        front: function (fx) {
          var r = K.seeded(5150 + (main ? 0 : 3));
          function sky(x, y) { return y < dunes[0](x / SW) * SH - 3; }
          // fixed, crisp stars: mostly faint, more along the band, a few brighter, three that stand out
          for (var i = 0; i < 2400; i++) {
            var x = r() * SW, y = Math.pow(r(), 1.15) * SH * hz;
            if (!sky(x, y)) continue;
            var b = bandAt(x / SH + shift, y / SH);
            var inBand = Math.exp(-Math.pow(b[0] / (MW * 1.6), 2));
            if (r() > 0.35 + 0.65 * inBand && i > 1200) continue;
            var a = (0.12 + 0.42 * Math.pow(r(), 2.3)) * K.smooth((SH * hz - y) / (SH * 0.12));
            fx.fillStyle = 'rgba(240, 238, 255, ' + a.toFixed(3) + ')';
            fx.fillRect(x, y, a > 0.4 ? 1.5 : 1, a > 0.4 ? 1.5 : 1);
          }
          var tints = ['255, 244, 232', '214, 226, 255', '255, 228, 210'];
          for (var m = 0; m < 30; m++) {
            var mx = r() * SW, my = r() * SH * hz * 0.85;
            if (!sky(mx, my)) continue;
            fx.fillStyle = K.radial(fx, mx, my, 2.4, [[0, 'rgba(' + tints[m % 3] + ',0.85)'], [0.45, 'rgba(' + tints[m % 3] + ',0.28)'], [1, 'rgba(' + tints[m % 3] + ',0)']]);
            fx.fillRect(mx - 3, my - 3, 6, 6);
          }
          for (var bb = 0; bb < 3; bb++) {
            var bx = SW * (0.1 + 0.8 * r()), by = SH * (0.05 + 0.3 * r());
            if (Math.abs(bx - SW / 2) < 170 && by > SH * 0.2) continue;
            fx.fillStyle = K.radial(fx, bx, by, 8, [[0, 'rgba(255, 250, 244, 1)'], [0.14, 'rgba(255, 246, 236, 0.7)'], [0.4, 'rgba(220, 220, 255, 0.1)'], [1, 'rgba(220, 220, 255, 0)']]);
            fx.fillRect(bx - 8, by - 8, 16, 16);
          }
          fx.drawImage(landImage(fx.getTransform().a, false), 0, topPx, SW, SH - topPx);
          if (!camp) return;
          // the tent, crisp, on the second crest
          var tx = camp.x, ty = camp.y;
          fx.fillStyle = '#17121f';
          fx.beginPath(); fx.moveTo(tx - 15, ty + 2); fx.lineTo(tx - 3, ty - 15); fx.lineTo(tx + 1, ty - 14); fx.lineTo(tx + 11, ty + 2); fx.fill();
        },
      };
    },

    lofi: {
      key: 'E', mode: 'phrygian', bpm: 64, swing: 0.56, vary: 0.2, variants: { m7: ['m11'], m11: ['m7'], maj7: ['maj7'] },
      progs: ['i7 bIImaj7 i7 bIImaj7', 'i7 bVImaj7 bvii7 i7', 'bVImaj7 bIImaj7 i11 i11'],
      keys: { inst: 'piano', style: 'hold', range: [50, 72], size: 3, ep: true, level: 0.95 },
      lead: { inst: 'guitar', range: [59, 79], level: 0.62, motif: '4.6.2 10.6.1 |' },
      reply: { inst: 'guitar', shift: -12, level: 0.66 },
      pad: { inst: 'cello', range: [38, 52], fifth: true, level: 1.26, in: ['release', 'thin', 'outro'] },
      bass: { style: 'pedal', level: 0.73 },
      drums: { style: 'half', snare: 'rim', hat: 'hat', level: 0.74 },
      fx: { tone: 4500, crackle: 0.3, hiss: 0.35, wow: 0.9, room: 0.5, verb: 1.3, echo: 0.75, duck: 0.08 },
    },

    // The place's own sounds, under the music.
    ambience: function (ac, out) {
      var t0 = ac.currentTime;
      // wind over the sand: gusts rising and falling, a faint whistle in them
      var windG = K.gain(ac, 0.12, out);
      var wbp = K.filter(ac, 'bandpass', 380, 0.7, windG);
      K.loop(ac, K.noise(ac, 'pink', 8), wbp, t0);
      K.lfo(ac, 0.023, 200, wbp.frequency, 'sine', t0);
      K.lfo(ac, 0.037, 0.08, windG.gain, 'sine', t0);
      var whG = K.gain(ac, 0.014, out);
      var wh = K.filter(ac, 'bandpass', 1300, 12, whG);
      K.loop(ac, K.noise(ac, 'white', 5), wh, t0);
      K.lfo(ac, 0.05, 250, wh.frequency, 'sine', t0);
      K.lfo(ac, 0.029, 0.012, whG.gain, 'sine', t0);
      return function () {};
    },
  });
})();

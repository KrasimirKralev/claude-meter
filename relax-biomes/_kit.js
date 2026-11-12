// Relax biomes: the registry and the kit every biome file builds on.
//
// A biome is ONE file in this folder, named after its id, that calls
// RelaxBiomes.register({...}). main.js lists the folder (index.js), so a 16th
// biome is one new file. Files starting with "_" (this one) and index.js are
// not biomes. Every level has to be measured, not guessed: render the music
// offline (renderMusic below) and match the lake's loudness, about -22 LUFS.
//
//   id      the file name without .js
//   name    shown small under the timer
//   about   one line on the place and its music (the preview page shows it)
//   ink    'r, g, b' of the breathing ring, the timer and the name
//   shade   'r, g, b' of the vignette and the End button's backdrop
//   vignette optional 0..1 (default 0.5)
//   legible optional 0..1: a soft shade under the text on bright scenes (default 0)
//   scale   optional screen px per canvas px (default 4: 1080p paints 480x270)
//   grade   optional split tone { shadow: 'r, g, b', light: 'r, g, b' }: dark tones lifted
//            towards `shadow`, bright ones pulled towards `light`; applied to the moving
//            canvas every frame and to front and sprites once, at half strength
//            (K.GRADE_STRENGTH; see K.grade)
//   grain   optional mean opacity of the moving film grain (default 0.022; 0 = none)
//   level   loudness trim of the music, measured so every biome plays about as loud as the others
//   ambienceLevel  trim of the place's own sounds (rain, surf, fire, birds...)
//   scene(s) -> { paint(ctx, t, p), front?(fx, SW, SH) }
//            s: W, H (canvas px), SW, SH (screen px), rnd (seeded per screen),
//            layer(w, h), sprite(w, h, draw); t = seconds, p = 0..1 of the break.
//            s.role 'main' (the primary screen: the focal point goes here) or
//            'side' (a quieter continuation of the same place); s.inner +1 or -1,
//            the side the other screen is probably on (a guess from the screen's
//            position, so never rely on exact panorama alignment).
//            s.par(depth) -> { x, y } canvas px of camera drift for a layer at
//            depth 0 (sky) .. 1 (nearest); front and sprites drift as depth 1.
//            paint runs ~15 times a second on the small canvas; front paints
//            once at full resolution (crisp silhouettes in front of the scene).
//   lofi    the music: key, tempo, chords, instruments and feel, played by
//            _lofi.js from recorded instruments (the fields are listed there).
//   ambience(ac, out) -> schedule(until): the place's own sounds. schedule
//            creates every sound that starts before `until` (AudioContext
//            seconds). Called twice a second live, and once for the whole
//            length when measuring loudness offline.
(function () {
  'use strict';

  var biomes = {};
  window.RelaxBiomes = {
    register: function (b) { biomes[b.id] = b; },
    get: function (id) { return Object.prototype.hasOwnProperty.call(biomes, id) ? biomes[id] : null; },
    ids: function () { return Object.keys(biomes); },
  };

  var K = {};
  window.RelaxKit = K;

  // ------------------------------------------------------------ maths
  K.clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  K.lerp = function (a, b, x) { return a + (b - a) * x; };
  K.smooth = function (x) { x = K.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  K.seeded = function (seed) {
    var s = Math.floor(Math.abs(seed)) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  };
  K.pick = function (rnd, arr) { return arr[Math.floor(rnd() * arr.length) % arr.length]; };

  // Smooth 1-D and 2-D value noise, -1..1, cheap enough for a few hundred calls a frame.
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  K.noise1 = function (x, seed) {
    var i = Math.floor(x); var f = x - i; var u = f * f * (3 - 2 * f);
    var s = (seed || 0) * 17.13;
    return (K.lerp(hash(i + s), hash(i + 1 + s), u)) * 2 - 1;
  };
  function hash2(x, y, s) { var h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); }
  K.noise2 = function (x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y); var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy); var s = seed || 0;
    var a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
    return K.lerp(K.lerp(a, b, ux), K.lerp(c, d, ux), uy) * 2 - 1;
  };
  K.fbm2 = function (x, y, oct, seed) {
    var v = 0, amp = 0.5, f = 1;
    for (var i = 0; i < oct; i++) { v += amp * K.noise2(x * f, y * f, (seed || 0) + i * 13); f *= 2; amp *= 0.5; }
    return v;
  };

  // ------------------------------------------------------------ painting helpers
  K.canvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  };
  // stops: [[0, '#123'], [0.5, 'rgba(...)'], ...]
  K.linear = function (ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  };
  K.radial = function (ctx, x, y, r, stops, r0) {
    var g = ctx.createRadialGradient(x, y, r0 || 0, x, y, Math.max(0.01, r));
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  };
  // A soft round glow painted once; drawImage of it is far cheaper than a new gradient per frame.
  K.glow = function (r, rgb, stops) {
    var c = K.canvas(r * 2, r * 2); var x = c.getContext('2d');
    var st = stops || [[0, 1], [0.35, 0.45], [1, 0]];
    x.fillStyle = K.radial(x, r, r, r, st.map(function (s) { return [s[0], 'rgba(' + rgb + ',' + s[1] + ')']; }));
    x.fillRect(0, 0, r * 2, r * 2);
    return c;
  };
  // A closed ridge: y = base - fn(x) from x0 to x1, closed down to `bottom`.
  K.ridge = function (x0, x1, step, fn, bottom) {
    var p = new Path2D(); p.moveTo(x0, bottom);
    for (var x = x0; x <= x1 + step; x += step) p.lineTo(Math.min(x, x1), fn(Math.min(x, x1)));
    p.lineTo(x1, bottom); p.closePath();
    return p;
  };
  // A soft cumulus: many overlapping blobs, lit from above, painted once.
  K.cloud = function (rnd, w, h, light, dark) {
    var c = K.canvas(w, h); var x = c.getContext('2d');
    var n = Math.round(10 + w / 14);
    for (var i = 0; i < n; i++) {
      var u = rnd(); var bx = w * (0.15 + 0.7 * u);
      var top = Math.sin(u * Math.PI);
      var r = h * (0.18 + 0.3 * top * (0.6 + 0.4 * rnd()));
      var by = h - r * 0.9 - rnd() * h * 0.08;
      x.fillStyle = K.radial(x, bx, by - r * 0.25, r * 1.25, [[0, 'rgba(' + light + ',0.95)'], [0.55, 'rgba(' + light + ',0.75)'], [1, 'rgba(' + dark + ',0)']]);
      x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    }
    // a flat, darker underside
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = K.linear(x, 0, 0, 0, h, [[0, 'rgba(' + dark + ',0)'], [0.6, 'rgba(' + dark + ',0.05)'], [1, 'rgba(' + dark + ',0.55)']]);
    x.fillRect(0, 0, w, h);
    return c;
  };
  // Stars into a context: a static field (twinkling ones are the biome's business).
  K.starField = function (ctx, rnd, w, h, count, rgb, maxA) {
    for (var i = 0; i < count; i++) {
      var a = Math.pow(rnd(), 2.2) * (maxA || 0.9);
      ctx.fillStyle = 'rgba(' + (rgb || '255,248,240') + ',' + a.toFixed(3) + ')';
      ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
  };

  // Fine static grain at full resolution: without it dark gradients show 8-bit bands.
  K.grain = function (gx, w, h, seed) {
    var tile = gx.createImageData(256, 256);
    var rnd = K.seeded(77 + seed);
    for (var i = 0; i < tile.data.length; i += 4) {
      var v = rnd() < 0.5 ? 0 : 255;
      tile.data[i] = v; tile.data[i + 1] = v; tile.data[i + 2] = v;
      tile.data[i + 3] = Math.floor(rnd() * 14);
    }
    var off = K.canvas(256, 256);
    off.getContext('2d').putImageData(tile, 0, 0);
    gx.save();
    gx.setTransform(1, 0, 0, 1, 0, 0);
    gx.fillStyle = gx.createPattern(off, 'repeat');
    gx.fillRect(0, 0, w, h);
    gx.restore();
  };

  // ------------------------------------------------------------ the cinematic kit
  // Shared by every scene: colour and depth, light (bloom, rays, rim, flicker),
  // water, stars, soft noise shapes, depth of field and grading. Everything
  // here is painted once into a canvas; a frame only draws those canvases.
  K.reduced = (function () {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  })();

  // '#rgb', '#rrggbb' or 'r, g, b' -> [r, g, b]
  K.rgb = function (c) {
    if (Array.isArray(c)) return c;
    if (c.charAt(0) === '#') {
      var h = c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1, 7);
      var n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c.split(',').map(Number);
  };
  // k of the way from colour a to colour b: 'rgb(...)', or 'rgba(...)' with alpha.
  K.mix = function (a, b, k, alpha) {
    var x = K.rgb(a), y = K.rgb(b), r = [];
    for (var i = 0; i < 3; i++) r.push(Math.round(x[i] + (y[i] - x[i]) * k));
    return alpha === undefined ? 'rgb(' + r.join(',') + ')' : 'rgba(' + r.join(',') + ',' + alpha + ')';
  };
  K.mixRgb = function (a, b, k) {
    var x = K.rgb(a), y = K.rgb(b);
    return Math.round(x[0] + (y[0] - x[0]) * k) + ',' + Math.round(x[1] + (y[1] - x[1]) * k) + ',' +
      Math.round(x[2] + (y[2] - x[2]) * k);
  };
  // Atmospheric perspective: a layer's colour at depth 0 (near) .. 1 (the horizon)
  // sinks into the haze, so farther layers are lighter, bluer and lower in contrast.
  K.aerial = function (c, haze, depth, alpha) {
    return K.mix(c, haze, Math.pow(K.clamp(depth, 0, 1), 1.15) * 0.88, alpha);
  };

  // 1/f flicker, about -1..1: octaves of smooth noise whose amplitude falls with
  // frequency, so a flame wavers slowly with smaller quick tremors on top. A sine
  // reads as a machine.
  K.flicker = function (t, seed, rate) {
    var v = 0, amp = 1, f = rate || 1, norm = 0;
    for (var i = 0; i < 5; i++) {
      v += amp * K.noise1(t * f, (seed || 0) + i * 7.1);
      norm += amp; f *= 2.1; amp *= 0.7;
    }
    return v / norm * 1.6;
  };

  // A picture computed pixel by pixel, once: fn(u, v, out) fills out = [r, g, b, a 0..1]
  // for u, v in 0..1 and returns it (or null for nothing). Keep w x h small - the
  // canvas scales it up smoothly.
  K.field = function (w, h, fn) {
    var c = K.canvas(w, h), x = c.getContext('2d');
    var img = x.createImageData(c.width, c.height), d = img.data, out = [0, 0, 0, 0];
    for (var j = 0; j < c.height; j++) {
      for (var i = 0; i < c.width; i++) {
        var r = fn((i + 0.5) / c.width, (j + 0.5) / c.height, out);
        if (!r) continue;
        var o = (j * c.width + i) * 4;
        d[o] = r[0]; d[o + 1] = r[1]; d[o + 2] = r[2]; d[o + 3] = r[3] * 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  };
  // A soft mass of cloud, mist or nebula: fbm noise cut by a smooth threshold inside
  // an envelope with a flatter, sharper underside (clouds rest on a level of air).
  // o: { w, h (px of the canvas), light, dark ('r, g, b': top and underside), alpha,
  //      cover (0..1, how much is filled), freq, seed, flat (0 = round .. 1 = flat base),
  //      taper (how soon the ends fade), oct, edge (softness of the outline, default
  //      0.22), mottle (light/dark speckle inside, default 0.5), soft (px of blur after) }
  K.mass = function (o) {
    var light = K.rgb(o.light || '255, 255, 255'), dark = K.rgb(o.dark || o.light || '200, 200, 210');
    var cover = o.cover === undefined ? 0.5 : o.cover, fq = o.freq || 3, seed = o.seed || 1;
    var flat = o.flat === undefined ? 0.6 : o.flat, taper = o.taper || 0.35, alpha = o.alpha || 1;
    var aspect = o.w / o.h, edge = o.edge || 0.22, mottle = o.mottle === undefined ? 0.5 : o.mottle;
    var c = K.field(o.w, o.h, function (u, v, out) {
      // envelope: tapered ends, a rounded top, a flatter base
      var ends = K.smooth(Math.min(u, 1 - u) / taper);
      var top = K.smooth(v / 0.45);
      var base = K.smooth((1 - v) / (0.08 + 0.4 * (1 - flat)));
      var env = ends * top * base;
      if (env <= 0) return null;
      var n = K.fbm2(u * fq * aspect, v * fq, o.oct || 5, seed) * 0.5 + 0.5;
      var a = K.smooth((n * env - (1 - cover) * 0.5) / edge) * alpha;
      if (a <= 0.004) return null;
      var k = K.clamp(v * 1.1 + (0.5 - n) * mottle, 0, 1); // lit from above
      out[0] = light[0] + (dark[0] - light[0]) * k;
      out[1] = light[1] + (dark[1] - light[1]) * k;
      out[2] = light[2] + (dark[2] - light[2]) * k;
      out[3] = a;
      return out;
    });
    return o.soft ? K.blurred(c, o.soft) : c;
  };

  // Mist, haze or spray: long soft wisps, thickest along the middle of a w x h strip and
  // gone at its edges, never a lump. o: { w, h, rgb, alpha, seed, stretch (how much
  // longer than tall the wisps are, default 6), cover (0..1), oct }
  K.wisps = function (o) {
    var rgb = K.rgb(o.rgb || '255, 255, 255'), st = o.stretch || 6, cover = o.cover === undefined ? 0.55 : o.cover;
    var fq = o.freq || 2.5, aspect = o.w / o.h, seed = o.seed || 1;
    return K.field(o.w, o.h, function (u, v, out) {
      var bell = Math.pow(Math.sin(Math.PI * v), 1.6) * K.smooth(Math.min(u, 1 - u) / 0.12);
      if (bell <= 0.01) return null;
      var n = K.fbm2(u * fq * aspect / st, v * fq, o.oct || 4, seed) * 0.5 + 0.5;
      var a = bell * K.smooth((n - (1 - cover) * 0.7) / 0.45) * (o.alpha || 0.3);
      if (a <= 0.003) return null;
      out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; out[3] = a;
      return out;
    });
  };

  // Bloom for a light source: a tight core and two wider halos summed, close to how a
  // lens spreads a bright light. Painted once at a small size and added with 'lighter',
  // so it costs one draw a frame.
  var bloomCache = {};
  K.bloom = function (rgb, spread) {
    var key = rgb + ':' + (spread || 1);
    if (bloomCache[key]) return bloomCache[key];
    var r = 64, c = K.canvas(r * 2, r * 2), x = c.getContext('2d'), sp = spread || 1, stops = [];
    for (var i = 0; i <= 20; i++) {
      var d = i / 20;
      var a = 0.62 * Math.exp(-Math.pow(d / (0.05 * sp), 2)) + 0.26 * Math.exp(-Math.pow(d / (0.2 * sp), 2)) +
        0.12 * Math.exp(-Math.pow(d / 0.55, 2));
      stops.push([d, 'rgba(' + rgb + ',' + (a * (1 - d * d)).toFixed(4) + ')']);
    }
    x.fillStyle = K.radial(x, r, r, r, stops);
    x.fillRect(0, 0, r * 2, r * 2);
    bloomCache[key] = c;
    return c;
  };
  // Add a light (a bloom or any glow canvas) centred on x, y, `size` px in radius.
  K.light = function (ctx, img, x, y, size, alpha, sizeY) {
    if (!(alpha > 0.003)) return;
    var op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, alpha);
    var sy = sizeY || size;
    ctx.drawImage(img, x - size, y - sy, size * 2, sy * 2);
    ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
  };

  // Volumetric light: soft shafts fanning from (o.x, o.y) on a w x h layer, each one
  // tapered, fading along its length and broken up by soft noise, so it reads as light
  // through haze rather than a stripe. angle 0 = straight down, positive leans right.
  // o: { x, y, angle, spread, count, length, width, rgb, alpha, seed, patchy (0..1) }
  K.rays = function (w, h, o) {
    var c = K.canvas(w, h), x = c.getContext('2d'), rnd = K.seeded(o.seed || 5);
    var len = o.length || Math.hypot(w, h);
    var n = o.count || 5;
    for (var i = 0; i < n; i++) {
      var ang = (o.angle || 0) + (n > 1 ? (i / (n - 1) - 0.5) : 0) * (o.spread || 0.5) + (rnd() - 0.5) * 0.06;
      var wid = (o.width || w * 0.05) * (0.45 + rnd() * 1.1);
      var a = (o.alpha || 0.3) * (0.35 + 0.65 * rnd());
      x.save();
      x.translate(o.x + (rnd() - 0.5) * (o.jitter || 0), o.y);
      x.rotate(-ang);
      x.fillStyle = K.linear(x, 0, 0, 0, len, [[0, 'rgba(' + o.rgb + ',' + a.toFixed(3) + ')'],
        [0.4, 'rgba(' + o.rgb + ',' + (a * 0.55).toFixed(3) + ')'], [1, 'rgba(' + o.rgb + ',0)']]);
      x.filter = 'blur(' + Math.max(1, wid * 0.3).toFixed(1) + 'px)';
      x.beginPath();
      x.moveTo(-wid * 0.2, 0); x.lineTo(wid * 0.2, 0); x.lineTo(wid, len); x.lineTo(-wid, len);
      x.closePath(); x.fill();
      x.restore();
    }
    var patchy = o.patchy === undefined ? 0.7 : o.patchy, sd = (o.seed || 5) + 3;
    var mask = K.field(Math.ceil(w / 3), Math.ceil(h / 3), function (u, v, out) {
      var nn = K.fbm2(u * 4.5, v * 2.6, 4, sd);
      out[0] = out[1] = out[2] = 255; out[3] = K.clamp(1 - patchy + patchy * (0.55 + nn * 1.3), 0, 1);
      return out;
    });
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0, w, h);
    return c;
  };

  // Rim light: the edges of a silhouette layer that face the light (dx, dy points
  // towards it) as a thin line of `rgb`, `width` px deep, softened by `soft` px and kept
  // inside the silhouette. rimLayer returns just the line (a sprite can fade it with the
  // light); rim paints it onto the silhouette in place.
  K.rimLayer = function (c, dx, dy, width, rgb, alpha, soft) {
    var m = Math.hypot(dx, dy) || 1;
    var t = K.canvas(c.width, c.height), x = t.getContext('2d');
    x.drawImage(c, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = 'rgba(' + rgb + ',' + alpha + ')'; x.fillRect(0, 0, t.width, t.height);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(c, -dx / m * width, -dy / m * width);
    if (!soft) return t;
    var o = K.canvas(c.width, c.height), ox = o.getContext('2d');
    ox.filter = 'blur(' + soft + 'px)'; ox.drawImage(t, 0, 0); ox.filter = 'none';
    ox.globalCompositeOperation = 'destination-in'; ox.drawImage(c, 0, 0);
    return o;
  };
  K.rim = function (c, dx, dy, width, rgb, alpha, soft) {
    var r = K.rimLayer(c, dx, dy, width, rgb, alpha, soft);
    var cx = c.getContext('2d');
    cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-atop';
    cx.drawImage(r, 0, 0);
    cx.restore();
    return c;
  };
  // A blurred copy (depth of field for the nearest silhouettes, done once).
  K.blurred = function (c, px) {
    var o = K.canvas(c.width, c.height), x = o.getContext('2d');
    x.filter = 'blur(' + px + 'px)'; x.drawImage(c, 0, 0);
    return o;
  };
  // A copy of the rows 0..y of c turned upside down: row 0 of the result is row y - 1
  // of c (the waterline). K.reflect draws it.
  K.mirror = function (c, y) {
    var o = K.canvas(c.width, Math.max(1, y)), x = o.getContext('2d');
    x.translate(0, y); x.scale(1, -1); x.drawImage(c, 0, 0);
    return o;
  };
  // Still water: a mirrored picture (K.mirror) drawn below `horizon` in horizontal
  // bands that get taller and sway further sideways towards the viewer, so the
  // reflection is clear at the far shore and breaks up close by.
  // o: { bands, amp (px of sway at the bottom), speed, squash (>1 shortens it), seed, alpha }
  K.reflect = function (ctx, mir, horizon, bottom, w, t, o) {
    var n = o.bands || 22, sq = o.squash || 1.15, amp = o.amp || 2, sp = o.speed || 0.25, seed = o.seed || 0;
    var depth = bottom - horizon, mh = mir.height;
    var ga = ctx.globalAlpha;
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    for (var i = 0; i < n; i++) {
      var a = Math.pow(i / n, 1.5), b = Math.pow((i + 1) / n, 1.5);
      var dy0 = horizon + a * depth, dy1 = horizon + b * depth + 0.6;
      var sy0 = (dy0 - horizon) * sq, sy1 = (dy1 - horizon) * sq;
      if (sy0 >= mh) break;
      sy1 = Math.min(mh, sy1);
      var k = (a + b) / 2;
      var off = amp * Math.pow(k, 0.8) * (K.noise1(t * sp + i * 1.37, seed) * 0.7 + 0.3 * Math.sin(t * sp * 2.3 + i * 2.1));
      var m = amp + 1;
      ctx.drawImage(mir, 0, sy0, mir.width, sy1 - sy0, off - m, dy0, w + 2 * m, (sy1 - sy0) / sq);
    }
    ctx.globalAlpha = ga;
  };

  // Stars in three tiers, each painted once into its own layer (w x h): mostly very
  // faint points, a few dozen medium ones, at most `bright` (default 3) prominent ones
  // with a small soft halo. A scene fades the tiers in one after another as the sky darkens.
  // o: { faint, mid, bright, rgb, density(v) -> 0..1 (v = 0 top .. 1 bottom of the layer), halo (bright
  //      stars' halo strength, default 1) }
  K.stars = function (w, h, rnd, o) {
    o = o || {};
    var rgb = o.rgb || '255, 248, 238';
    var dens = o.density || function (v) { return 1 - v * 0.7; };
    function place() {
      for (var tries = 0; tries < 30; tries++) {
        var x = rnd() * w, y = rnd() * h;
        if (rnd() < dens(y / h)) return [x, y];
      }
      return [rnd() * w, rnd() * h * 0.4];
    }
    var tiers = { faint: K.canvas(w, h), mid: K.canvas(w, h), bright: K.canvas(w, h) };
    var fx = tiers.faint.getContext('2d');
    for (var i = 0, n = o.faint === undefined ? Math.round(w * h / 260) : o.faint; i < n; i++) {
      var p = place();
      fx.fillStyle = 'rgba(' + rgb + ',' + (0.12 + 0.3 * Math.pow(rnd(), 2)).toFixed(3) + ')';
      var sz = rnd() < 0.8 ? 0.6 : 0.9;
      fx.fillRect(p[0], p[1], sz, sz);
    }
    var mx = tiers.mid.getContext('2d');
    for (var j = 0, nm = o.mid === undefined ? 26 : o.mid; j < nm; j++) {
      var q = place();
      mx.fillStyle = K.radial(mx, q[0], q[1], 1.3, [[0, 'rgba(' + rgb + ',0.9)'], [0.5, 'rgba(' + rgb + ',0.35)'], [1, 'rgba(' + rgb + ',0)']]);
      mx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3);
    }
    var bx = tiers.bright.getContext('2d');
    for (var k = 0, nb = o.bright === undefined ? 3 : o.bright; k < nb; k++) {
      var r = place();
      var hl = o.halo === undefined ? 1 : o.halo;
      bx.fillStyle = K.radial(bx, r[0], r[1], 4, [[0, 'rgba(' + rgb + ',1)'], [0.18, 'rgba(' + rgb + ',' + 0.55 * hl + ')'],
        [0.45, 'rgba(' + rgb + ',' + 0.12 * hl + ')'], [1, 'rgba(' + rgb + ',0)']]);
      bx.fillRect(r[0] - 4, r[1] - 4, 8, 8);
    }
    return tiers;
  };

  // Colour grading as a split tone: dark tones lifted towards a cool colour ('screen'
  // with a dark one), bright tones pulled towards a warm one ('multiply' with a near
  // white). g: { shadow: 'r, g, b', light: 'r, g, b' }.
  // The places' own grades are applied at half strength: at full strength they pulled every
  // material in a place towards one purple or brown wash (Astra, round 2).
  K.GRADE_STRENGTH = 0.5;
  function gradeColours(g) {
    var k = K.GRADE_STRENGTH, sh = K.rgb(g.shadow || '0, 0, 0'), li = K.rgb(g.light || '255, 255, 255');
    return {
      shadow: sh.map(function (v) { return Math.round(v * k); }),
      light: li.map(function (v) { return Math.round(255 - (255 - v) * k); }),
    };
  }
  K.grade = function (ctx, w, h, g) {
    if (!g) return;
    if (!g.eff) g.eff = gradeColours(g);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (g.shadow) { ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgb(' + g.eff.shadow.join(',') + ')'; ctx.fillRect(0, 0, w, h); }
    if (g.light) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(' + g.eff.light.join(',') + ')'; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  };
  // The same grade on a layer with transparent parts (front, sprites), done once per pixel
  // on the un-premultiplied colour so soft edges keep their own colour (filling with a
  // blend mode would drag a faint edge most of the way to the shadow tone).
  K.gradeLayer = function (c, g) {
    if (!g || !c.width || !c.height) return c;
    var eff = gradeColours(g), sh = eff.shadow, li = eff.light, lut = [];
    for (var ch = 0; ch < 3; ch++) {
      lut.push(new Uint8ClampedArray(256));
      for (var v = 0; v < 256; v++) lut[ch][v] = Math.round((255 - (255 - v) * (255 - sh[ch]) / 255) * li[ch] / 255);
    }
    var x = c.getContext('2d'), img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]];
    }
    x.putImageData(img, 0, 0);
    return c;
  };

  // The camera: a slow push-in of 1.5 % over the whole break and a drift of about
  // +-2 px with periods of 70-110 s - both well under what the eye notices as motion,
  // so the place feels alive without the viewer ever seeing a camera move.
  K.camera = function (t, p, seed) {
    if (K.reduced) return { x: 0, y: 0, z: 1.004 };
    var s = seed || 0;
    return {
      x: 1.6 * Math.sin(t * 2 * Math.PI / 97 + s) + 0.4 * Math.sin(t * 2 * Math.PI / 41 + s * 2),
      y: 1.1 * Math.sin(t * 2 * Math.PI / 113 + s * 3),
      z: 1.004 + 0.015 * K.smooth(p),
    };
  };

  // Film grain: one tile of noise painted once into a layer a little larger than the
  // screen, moved by whole pixels 12 times a second. Moving a layer is the
  // compositor's job, so the grain never repaints.
  var GRAIN_TILE = 128;
  K.grainLayer = function (SW, SH, amount, seed) {
    var c = K.canvas(SW + GRAIN_TILE, SH + GRAIN_TILE), x = c.getContext('2d');
    var tile = x.createImageData(GRAIN_TILE, GRAIN_TILE), rnd = K.seeded(77 + (seed || 0));
    var peak = Math.min(255, Math.round(amount * 2 * 255));
    for (var i = 0; i < tile.data.length; i += 4) {
      var v = rnd() < 0.5 ? 0 : 255;
      tile.data[i] = v; tile.data[i + 1] = v; tile.data[i + 2] = v;
      tile.data[i + 3] = Math.floor(rnd() * peak);
    }
    var off = K.canvas(GRAIN_TILE, GRAIN_TILE);
    off.getContext('2d').putImageData(tile, 0, 0);
    x.fillStyle = x.createPattern(off, 'repeat');
    x.fillRect(0, 0, c.width, c.height);
    c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0';
    c.style.width = c.width + 'px'; c.style.height = c.height + 'px';
    c.style.pointerEvents = 'none'; c.style.willChange = 'transform';
    var rg = K.seeded(5 + (seed || 0)), lastTick = -1, last = '';
    return {
      el: c,
      tick: function (t) {
        if (K.reduced) return;
        var k = Math.floor(t * 12);
        if (k === lastTick) return;
        lastTick = k;
        var tr = 'translate(' + -Math.floor(rg() * GRAIN_TILE) + 'px,' + -Math.floor(rg() * GRAIN_TILE) + 'px)';
        if (tr !== last) { c.style.transform = tr; last = tr; }
      },
    };
  };

  // ------------------------------------------------------------ the scene host
  // opts: canvas (the moving one), front (full-res static canvas), spriteRoot,
  // SW/SH (screen size the scene is composed for), frontScale (front canvas px
  // per screen px - 1 in the app, smaller in the preview), seed, grain.
  K.mountScene = function (biome, opts) {
    var scale = biome.scale || 4;
    var SW = opts.SW, SH = opts.SH;
    var W = Math.max(2, Math.ceil(SW / scale)), H = Math.max(2, Math.ceil(SH / scale));
    opts.canvas.width = W; opts.canvas.height = H;
    var ctx = opts.canvas.getContext('2d', { alpha: false });
    var sprites = [];
    var cam = K.camera(0, 0, opts.seed || 0);
    // Which screen this is: the primary one carries the focal point. Where the other
    // screen is, is a guess (screens left of the origin sit at negative x).
    var role = opts.role === 'side' ? 'side' : 'main';
    var inner = (opts.displayX || 0) > 0 ? -1 : 1;
    var s = {
      W: W, H: H, SW: SW, SH: SH, scale: scale,
      rnd: K.seeded(9173 + (opts.seed || 0)),
      seed: opts.seed || 0,
      role: role, inner: inner, reduced: K.reduced,
      par: function (depth) { return { x: cam.x * depth / scale, y: cam.y * depth / scale }; },
      layer: function (w, h) { return K.canvas(w || W, h || H); },
      // A crisp full-resolution picture the scene moves with a CSS transform:
      // the compositor moves it without repainting anything.
      sprite: function (w, h, draw, originX, originY) {
        var fs = opts.frontScale || 1;
        var c = K.canvas(w * fs, h * fs);
        var cx = c.getContext('2d'); cx.scale(fs, fs); draw(cx, w, h);
        K.gradeLayer(c, biome.grade);
        c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0';
        c.style.width = w + 'px'; c.style.height = h + 'px';
        c.style.transformOrigin = (originX || 0) + 'px ' + (originY || 0) + 'px';
        c.style.willChange = 'transform';
        c.style.pointerEvents = 'none';
        if (opts.spriteRoot) opts.spriteRoot.appendChild(c);
        sprites.push(c);
        var last = '';
        return {
          el: c,
          set: function (x, y, rotDeg, alpha) {
            var tr = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (rotDeg || 0).toFixed(3) + 'deg)';
            if (tr !== last) { c.style.transform = tr; last = tr; }
            if (alpha !== undefined) c.style.opacity = alpha.toFixed(3);
          },
        };
      },
    };
    var painter = biome.scene(s);
    var grainAmount = opts.grain === false ? 0 : biome.grain === undefined ? 0.022 : biome.grain;
    var grain = null;
    var stage = opts.spriteRoot && opts.spriteRoot.parentNode;
    if (grainAmount > 0 && stage) {
      grain = K.grainLayer(stage.clientWidth || SW, stage.clientHeight || SH, grainAmount, opts.seed || 0);
      stage.insertBefore(grain.el, opts.spriteRoot.nextSibling);
      grain.tick(0);
    }
    if (opts.front) {
      var fs = opts.frontScale || 1;
      opts.front.width = Math.ceil(SW * fs); opts.front.height = Math.ceil(SH * fs);
      var fx = opts.front.getContext('2d');
      if (painter.front) { fx.save(); fx.scale(fs, fs); painter.front(fx, SW, SH); fx.restore(); }
      K.gradeLayer(opts.front, biome.grade);
      if (grainAmount > 0 && !grain) K.grain(fx, opts.front.width, opts.front.height, opts.seed || 0);
    }
    // The camera moves the three picture layers; the page's breathing cue, ring and
    // name stay put. Sky and far land are on the moving canvas, which only zooms
    // (the scene shifts its middle layers itself, s.par); front and sprites are the
    // nearest things, so they drift the whole way.
    var camEls = [opts.canvas, opts.front, opts.spriteRoot].filter(Boolean);
    var camBase = camEls.map(function (el) { return el === opts.spriteRoot ? el.style.transform || '' : ''; });
    var camLast = camEls.map(function () { return ''; });
    camEls.forEach(function (el) { el.style.transformOrigin = '0 0'; });
    function placeCamera() {
      for (var i = 0; i < camEls.length; i++) {
        var near = camEls[i] !== opts.canvas;
        var tx = ((1 - cam.z) / 2 + (near ? cam.x / SW : 0)) * 100;
        var ty = ((1 - cam.z) / 2 + (near ? cam.y / SH : 0)) * 100;
        var tr = (camBase[i] ? camBase[i] + ' ' : '') + 'translate(' + tx.toFixed(3) + '%,' + ty.toFixed(3) + '%) scale(' + cam.z.toFixed(5) + ')';
        if (tr !== camLast[i]) { camEls[i].style.transform = tr; camLast[i] = tr; }
      }
    }
    return {
      W: W, H: H,
      paint: function (t, p) {
        cam = K.camera(t, p, opts.seed || 0);
        painter.paint(ctx, t, p);
        K.grade(ctx, W, H, biome.grade);
        placeCamera();
        if (grain) grain.tick(t);
      },
      destroy: function () {
        sprites.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
        if (grain && grain.el.parentNode) grain.el.parentNode.removeChild(grain.el);
      },
    };
  };

  // Tint the page's UI (ring, timer, breathing circle, name) for this biome.
  K.applyUi = function (biome, root) {
    root.style.setProperty('--ink', biome.ink || '255, 238, 230');
    root.style.setProperty('--shade', biome.shade || '8, 6, 22');
    root.style.setProperty('--vig', String(biome.vignette === undefined ? 0.5 : biome.vignette));
    // A soft shadow under the text, for the brighter scenes.
    root.style.setProperty('--legible', String(biome.legible || 0));
  };

  // ------------------------------------------------------------ audio helpers
  K.hz = function (midi) { return 440 * Math.pow(2, (midi - 69) / 12); };

  function cache(ac) { if (!ac.__relaxCache) ac.__relaxCache = {}; return ac.__relaxCache; }

  // Looping noise: white, pink or brown, stereo, `secs` long.
  K.noise = function (ac, kind, secs) {
    var key = 'noise:' + kind + ':' + (secs || 6);
    var c = cache(ac);
    if (c[key]) return c[key];
    var len = Math.floor(ac.sampleRate * (secs || 6));
    var buf = ac.createBuffer(2, len, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (var n = 0; n < len; n++) {
        var w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[n] = last * 3.2; }
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
          b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
          d[n] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else d[n] = w * 0.5;
      }
      // Crossfade the loop's seam so it never clicks.
      var fade = Math.floor(ac.sampleRate * 0.05);
      for (var i = 0; i < fade; i++) {
        var k = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
      }
    }
    c[key] = buf;
    return buf;
  };
  K.loop = function (ac, buf, dest, at, rate) {
    var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    if (rate) src.playbackRate.value = rate;
    src.connect(dest); src.start(at || 0, Math.random() * buf.duration * 0.9);
    return src;
  };
  K.filter = function (ac, type, freq, q, dest) {
    var f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    if (q !== undefined && q !== null) f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  };
  K.gain = function (ac, value, dest) {
    var g = ac.createGain(); g.gain.value = value; if (dest) g.connect(dest); return g;
  };
  K.panner = function (ac, value, dest) {
    var p = ac.createStereoPanner(); p.pan.value = value; if (dest) p.connect(dest); return p;
  };
  // A slow wobble on any AudioParam: value += depth * sin(2 pi rate t).
  K.lfo = function (ac, rate, depth, param, type, at) {
    var o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = rate;
    var g = ac.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(param); o.start(at || 0);
    return o;
  };
  // A room: six damped feedback delays in parallel (a small delay network),
  // spread left and right after a gentle smear. A convolver sounded a little
  // smoother but its FFTs cost more than all the notes together on this PC;
  // this is a dozen cheap nodes. secs ~ how long the tail rings, tone 0..1 how
  // bright it stays. Returns its input.
  var COMBS = [0.0371, 0.0411, 0.0437, 0.0503, 0.0539, 0.0613];
  // opts.mono sums the input to one channel first and opts.combs uses fewer
  // delays: the lo-fi engine's room, which runs under everything, costs half.
  K.reverb = function (ac, secs, decay, dest, tone, opts) {
    var input = ac.createGain(); input.gain.value = 0.3;
    if (opts && opts.mono) { input.channelCount = 1; input.channelCountMode = 'explicit'; }
    var nCombs = opts && opts.combs ? Math.min(COMBS.length, opts.combs) : COMBS.length;
    var smear = K.filter(ac, 'allpass', 900, 0.6);
    var smear2 = K.filter(ac, 'allpass', 2300, 0.6);
    input.connect(smear); smear.connect(smear2);
    var size = 0.8 + Math.min(1.4, (secs || 3) / 4);
    var rt = Math.max(0.8, (secs || 3) * 0.55);
    var damp = 1500 + 4500 * Math.min(1, (tone === undefined ? 0.35 : tone) * 1.6);
    var sides = [K.panner(ac, -0.7, dest), K.panner(ac, 0.7, dest)];
    for (var i = 0; i < nCombs; i++) {
      var dt = COMBS[i] * size;
      var d = ac.createDelay(1); d.delayTime.value = dt;
      var lp = K.filter(ac, 'lowpass', damp, 0.3);
      var fb = K.gain(ac, Math.pow(10, -3 * dt / rt)); // each pass 60 dB down after rt seconds
      smear2.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      lp.connect(sides[i % 2]);
    }
    return input;
  };
  // The lake's small echo: two delays feeding each other through a darkening filter.
  K.echo = function (ac, dest, o) {
    o = o || {};
    var wet = ac.createGain(); wet.gain.value = o.wet === undefined ? 0.34 : o.wet;
    var d1 = ac.createDelay(3); d1.delayTime.value = o.l || 0.43;
    var d2 = ac.createDelay(3); d2.delayTime.value = o.r || 0.61;
    var f1 = K.filter(ac, 'lowpass', o.tone || 1700); var f2 = K.filter(ac, 'lowpass', (o.tone || 1700) * 0.88);
    var g1 = K.gain(ac, o.fb || 0.42); var g2 = K.gain(ac, (o.fb || 0.42) * 0.9);
    var pl = K.panner(ac, -0.55, dest); var pr = K.panner(ac, 0.55, dest);
    wet.connect(d1);
    d1.connect(f1); f1.connect(g1); g1.connect(d2);
    d2.connect(f2); f2.connect(g2); g2.connect(d1);
    d1.connect(pl); d2.connect(pr);
    return wet;
  };
  // One enveloped oscillator. o: freq, type, at, attack, len (total), release,
  // level, detune, pan, curve ('lin' | 'exp' decay after the attack).
  K.tone = function (ac, dest, o) {
    var osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.value = o.freq;
    if (o.detune) osc.detune.value = o.detune;
    var g = ac.createGain();
    var at = o.at, a = o.attack || 0.01, len = o.len || 1, lvl = o.level || 0.05;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(lvl, at + a);
    if (o.curve === 'exp') {
      g.gain.setTargetAtTime(0.0001, at + a, o.decay || (len - a) / 4);
    } else {
      var r = o.release || Math.min(len * 0.4, 4);
      g.gain.setValueAtTime(lvl, at + Math.max(a, len - r));
      g.gain.linearRampToValueAtTime(0.0001, at + len);
    }
    osc.connect(g);
    if (o.pan) g.connect(K.panner(ac, o.pan, dest)); else g.connect(dest);
    osc.start(at); osc.stop(at + len + 0.05);
    if (o.vibrato) K.lfo(ac, o.vibrato[0], o.vibrato[1], osc.frequency, 'sine', at).stop(at + len + 0.05);
    return osc;
  };
  // FM bell / mallet: a sine carrier whose brightness dies away faster than its body.
  K.bell = function (ac, dest, o) {
    var at = o.at, f = o.freq, len = o.len || 4;
    var car = ac.createOscillator(); car.frequency.value = f;
    var mod = ac.createOscillator(); mod.frequency.value = f * (o.ratio || 3.5);
    var mg = ac.createGain();
    var idx = f * (o.index || 1.2);
    mg.gain.setValueAtTime(idx, at);
    mg.gain.setTargetAtTime(idx * 0.05, at, o.bright || 0.25);
    mod.connect(mg); mg.connect(car.frequency);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.level || 0.05, at + (o.attack || 0.005));
    g.gain.setTargetAtTime(0.0001, at + (o.attack || 0.005), o.decay || len / 6);
    car.connect(g);
    if (o.pan) g.connect(K.panner(ac, o.pan, dest)); else g.connect(dest);
    car.start(at); mod.start(at); car.stop(at + len); mod.stop(at + len);
    return g;
  };
  // A plucked string (Karplus-Strong), rendered once per pitch into a buffer.
  K.pluck = function (ac, freq, secs, damp, bright) {
    var key = 'pluck:' + freq.toFixed(2) + ':' + secs + ':' + damp + ':' + bright;
    var c = cache(ac);
    if (c[key]) return c[key];
    var sr = ac.sampleRate, len = Math.floor(sr * secs);
    var buf = ac.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    // The string sounds at sr / (N + 0.5); playbackRate corrects the rest, so it is in tune.
    var period = sr / freq; var N = Math.max(2, Math.round(period - 0.5));
    var line = new Float32Array(N);
    // A soft pick: filtered noise, so the attack is round, never a click.
    var lp = 0; var b = bright === undefined ? 0.5 : bright;
    for (var i = 0; i < N; i++) { lp += b * ((Math.random() * 2 - 1) - lp); line[i] = lp; }
    var idx = 0; var k = damp === undefined ? 0.996 : damp;
    for (var n = 0; n < len; n++) {
      var j = (idx + 1) % N;
      d[n] = line[idx];
      line[idx] = k * 0.5 * (line[idx] + line[j]);
      idx = j;
    }
    buf.relaxRate = (N + 0.5) / period;
    // normalise and fade the tail out
    var peak = 0; for (var m = 0; m < len; m++) peak = Math.max(peak, Math.abs(d[m]));
    var tail = Math.floor(sr * 0.3);
    for (var q = 0; q < len; q++) {
      d[q] = d[q] / (peak || 1) * (q > len - tail ? (len - q) / tail : 1) * Math.min(1, q / 40);
    }
    c[key] = buf;
    return buf;
  };
  // A struck note (mallet, piano, bell, tine...) rendered once per pitch into a
  // buffer: partials [ratio, amplitude, decay seconds], each dying away at its
  // own rate. Playing it then costs one buffer source instead of a handful of
  // running oscillators - the audio thread is most of a biome's CPU.
  K.strike = function (ac, freq, partials, secs, attackMs) {
    var key = 'strike:' + freq.toFixed(2) + ':' + secs + ':' + JSON.stringify(partials);
    var c = cache(ac);
    if (c[key]) return c[key];
    var sr = ac.sampleRate, len = Math.floor(sr * secs);
    var buf = ac.createBuffer(1, len, sr);
    var d = buf.getChannelData(0);
    for (var p = 0; p < partials.length; p++) {
      var f = freq * partials[p][0];
      if (f > sr * 0.45) continue;
      var w = 2 * Math.PI * f / sr, k2 = 2 * Math.cos(w);
      var y1 = 0, y2 = -Math.sin(w); // sin(0), sin(-w): the recurrence y = 2cos(w)y1 - y2 is a sine
      var env = partials[p][1], fall = Math.exp(-1 / (partials[p][2] * sr));
      for (var n = 0; n < len; n++) {
        d[n] += y1 * env;
        var y = k2 * y1 - y2; y2 = y1; y1 = y;
        env *= fall;
      }
    }
    var att = Math.max(1, Math.floor(sr * (attackMs || 3) / 1000)), tail = Math.floor(sr * 0.2), peak = 0;
    for (var m = 0; m < len; m++) {
      if (m < att) d[m] *= m / att;
      if (m > len - tail) d[m] *= (len - m) / tail;
      peak = Math.max(peak, Math.abs(d[m]));
    }
    for (var q = 0; q < len; q++) d[q] /= peak || 1;
    c[key] = buf;
    return buf;
  };
  // Partials for the struck instruments the biomes share.
  K.INSTR = {
    marimba: [[1, 1, 0.42], [3.93, 0.22, 0.06], [9.2, 0.04, 0.015]],
    vibes: [[1, 1, 1.5], [4, 0.18, 0.22], [10, 0.03, 0.05]],
    piano: [[1, 1, 1.8], [2, 0.42, 1.0], [3, 0.16, 0.6], [4, 0.08, 0.35], [5.02, 0.03, 0.2]],
    rhodes: [[1, 1, 1.3], [1.003, 0.35, 1.1], [2, 0.22, 0.35], [3, 0.14, 0.1], [7, 0.03, 0.04]],
    celesta: [[1, 1, 0.55], [4, 0.16, 0.12]],
    handpan: [[1, 1, 1.1], [2, 0.32, 0.6], [3, 0.1, 0.25]],
    bell: [[1, 1, 1.6], [2.76, 0.35, 0.8], [5.4, 0.15, 0.35], [8.93, 0.06, 0.15]],
    musicbox: [[1, 1, 1.2], [2, 0.3, 0.4], [5.1, 0.08, 0.1]],
    bass: [[1, 1, 0.8], [2, 0.16, 0.2]],
  };

  K.play = function (ac, buf, dest, at, level, pan, rate) {
    var src = ac.createBufferSource(); src.buffer = buf;
    var r = (rate || 1) * (buf.relaxRate || 1);
    if (r !== 1) src.playbackRate.value = r;
    var g = ac.createGain(); g.gain.value = level;
    src.connect(g);
    if (pan) g.connect(K.panner(ac, pan, dest)); else g.connect(dest);
    src.start(at);
    return src;
  };

  // ------------------------------------------------------------ the music host
  // Two inputs: the music (biome.lofi, played by _lofi.js, at biome.level) and
  // the place's own sounds (biome.ambience, at biome.ambienceLevel). They share
  // one slow fade and the lake's gentle limiter, so no biome can clip or jump
  // out louder than the others.
  // Peaks: the limiter is slow for a drum's first milliseconds, so a soft clip
  // after it leaves everything under -6 dBFS alone and rounds anything above
  // off below -3.2 dBFS (a compressor would not do: it adds make-up gain).
  var PEAK_CURVE = null;
  function peakCurve() {
    if (PEAK_CURVE) return PEAK_CURVE;
    var n = 4096, c = new Float32Array(n), a = Math.pow(10, -6 / 20), m = Math.pow(10, -3.2 / 20);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1, ax = Math.abs(x);
      c[i] = ax <= a ? x : (x < 0 ? -1 : 1) * (a + (m - a) * Math.tanh((ax - a) / (m - a)));
    }
    PEAK_CURVE = c;
    return c;
  }
  function chain(ac, biome, dest) {
    var fade = ac.createGain();
    var limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.ratio.value = 3;
    var clip = ac.createWaveShaper(); clip.curve = peakCurve();
    fade.connect(limiter); limiter.connect(clip); clip.connect(dest || ac.destination);
    var music = K.gain(ac, biome.level || 0.5, fade);
    var amb = K.gain(ac, biome.ambienceLevel === undefined ? 1 : biome.ambienceLevel, fade);
    return { music: music, amb: amb, fade: fade, limiter: limiter };
  }

  // Integrated loudness of a buffer (ITU-R BS.1770: K-weighting, 400 ms blocks,
  // absolute and relative gates), in LUFS. A track from his folder is measured
  // with this before it plays.
  function biquad(x, b0, b1, b2, a1, a2) {
    var y = new Float32Array(x.length), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < x.length; i++) {
      var v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }
  K.loudness = function (buf) {
    var fs = buf.sampleRate;
    var Kt = Math.tan(Math.PI * 1681.974450955533 / fs), Q = 0.7071752369554196;
    var Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    var a0 = 1 + Kt / Q + Kt * Kt;
    var s = [(Vh + Vb * Kt / Q + Kt * Kt) / a0, 2 * (Kt * Kt - Vh) / a0, (Vh - Vb * Kt / Q + Kt * Kt) / a0, 2 * (Kt * Kt - 1) / a0, (1 - Kt / Q + Kt * Kt) / a0];
    var Kh = Math.tan(Math.PI * 38.13547087602444 / fs), Qh = 0.5003270373238773, ah = 1 + Kh / Qh + Kh * Kh;
    var h = [1, -2, 1, 2 * (Kh * Kh - 1) / ah, (1 - Kh / Qh + Kh * Kh) / ah];
    var block = Math.round(fs * 0.4), hop = Math.round(fs * 0.1);
    var nb = Math.max(0, Math.floor((buf.length - block) / hop) + 1);
    var z = new Float64Array(nb);
    for (var ch = 0; ch < Math.min(2, buf.numberOfChannels); ch++) {
      var w = biquad(biquad(buf.getChannelData(ch), s[0], s[1], s[2], s[3], s[4]), h[0], h[1], h[2], h[3], h[4]);
      var sq = new Float64Array(w.length + 1); // running sum of squares
      for (var i = 0; i < w.length; i++) sq[i + 1] = sq[i] + w[i] * w[i];
      for (var j = 0; j < nb; j++) z[j] += (sq[j * hop + block] - sq[j * hop]) / block;
    }
    if (buf.numberOfChannels === 1) for (var m = 0; m < nb; m++) z[m] *= 2; // mono plays from both speakers
    function lufs(v) { return -0.691 + 10 * Math.log10(v); }
    var abs = [], k;
    for (k = 0; k < nb; k++) if (lufs(z[k]) > -70) abs.push(z[k]);
    if (!abs.length) return -Infinity;
    var mean = abs.reduce(function (a, b) { return a + b; }, 0) / abs.length;
    var gate = lufs(mean) - 10;
    var rel = abs.filter(function (v) { return lufs(v) > gate; });
    return lufs(rel.reduce(function (a, b) { return a + b; }, 0) / rel.length);
  };

  // His own music (~/Music/relax, see relax-music.js): main picks the file - a
  // shuffle, nothing again until all have played - and hands over its bytes.
  // Here it is decoded, measured, and played as loud as the generated tracks,
  // the place's sounds kept quietly underneath. A track shorter than the break
  // is followed by the next one.
  // Measured: a track set to this plays at the generated tracks' -23 LUFS (the
  // limiter's own make-up gain adds about 0.9 dB on the way out).
  K.TRACK_LUFS = -23.9;
  K.AMBIENCE_UNDER_TRACK = 0.45;
  function playFolder(ac, c, opts, isStopped) {
    var log = opts.log || function () {};
    c.amb.gain.value *= K.AMBIENCE_UNDER_TRACK;
    var played = 0, failures = 0;
    function next(fadeIn) {
      return Promise.resolve(opts.nextTrack()).then(function (t) {
        if (!t || t.error || !t.data) throw new Error(t && t.error ? t.error : 'no track');
        var u8 = t.data instanceof ArrayBuffer ? new Uint8Array(t.data) : t.data;
        var bytes = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        return new Promise(function (resolve, reject) { ac.decodeAudioData(bytes, resolve, reject); })
          .catch(function () { throw new Error(t.name + ' could not be decoded'); })
          .then(function (buf) { return { name: t.name, buf: buf }; });
      }).then(function (tr) {
        if (isStopped()) return 'stopped';
        var lufs = K.loudness(tr.buf);
        var gainDb = isFinite(lufs) ? K.clamp(K.TRACK_LUFS - lufs, -24, 12) : 0;
        var g = ac.createGain(); g.connect(c.fade);
        var at = ac.currentTime + 0.05;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.pow(10, gainDb / 20), at + (fadeIn || 0.05));
        var src = ac.createBufferSource(); src.buffer = tr.buf; src.connect(g); src.start(at);
        played += 1;
        log('playing ' + tr.name + ' (' + (isFinite(lufs) ? lufs.toFixed(1) + ' LUFS, ' : '') + (gainDb >= 0 ? '+' : '') + gainDb.toFixed(1) + ' dB)');
        src.onended = function () { if (!isStopped()) next(1.5).catch(function (e) { log('next track: ' + e.message); }); };
        return 'track';
      }).catch(function (err) {
        failures += 1;
        log(err.message);
        if (failures < 3 && !isStopped()) return next(fadeIn);
        if (played) return 'track';
        c.amb.gain.value /= K.AMBIENCE_UNDER_TRACK;
        throw err;
      });
    }
    return next(0.05);
  }

  // Starts the place's sounds at once and the music as soon as it is ready
  // (the samples decoded, or his own track). opts: nextTrack() -> Promise of
  // { name, data } when the music comes from his folder; log(msg); endsAt
  // (Date.now() ms when the break's countdown ends) or durationMs (the break's
  // length; 4 minutes when neither is given): the generated track is
  // arranged to land on its last chord before the fade.
  // Returns { ac, ready (Promise of what plays), stop(ms) }.
  K.startMusic = function (biome, fadeMs, dest, opts) {
    opts = opts || {};
    var calledAt = Date.now();
    function secsLeft() {
      var end = opts.endsAt || calledAt + (opts.durationMs || 240000);
      return Math.max(5, (end - Date.now()) / 1000);
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || (!biome.lofi && !biome.ambience)) return null;
    var ac = new AC({ latencyHint: 'playback' });
    if (ac.state === 'suspended') ac.resume();
    var t0 = ac.currentTime;
    var c = chain(ac, biome, dest ? dest(ac) : null);
    c.fade.gain.setValueAtTime(0.0001, t0);
    c.fade.gain.exponentialRampToValueAtTime(1, t0 + fadeMs / 1000);
    var log = opts.log || function () {};
    var parts = [];
    var stopped = false;
    function tick() { var until = ac.currentTime + 2; parts.forEach(function (s) { s(until); }); }
    if (biome.ambience) parts.push(biome.ambience(ac, c.amb));
    function lofi() {
      if (!biome.lofi || !window.RelaxLofi) return Promise.resolve('ambience only');
      return window.RelaxLofi.loadBanks(ac, biome.lofi).then(function (banks) {
        if (stopped) return 'stopped';
        parts.push(window.RelaxLofi.track(ac, c.music, biome.lofi, banks, { length: secsLeft() }));
        tick();
        return 'lo-fi';
      }, function (err) {
        log('the lo-fi samples did not load (' + (err && err.message) + '); the place\'s sounds only');
        return 'ambience only';
      });
    }
    var ready = opts.nextTrack
      ? playFolder(ac, c, opts, function () { return stopped; }).catch(function () { log('no track of his could play; the generated music instead'); return lofi(); })
      : lofi();
    tick();
    var timer = setInterval(tick, 500);
    return {
      ac: ac,
      ready: ready,
      stop: function (ms) {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        var now = ac.currentTime;
        c.fade.gain.cancelScheduledValues(now);
        c.fade.gain.setValueAtTime(Math.max(0.0001, c.fade.gain.value), now);
        c.fade.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
        setTimeout(function () { ac.close(); }, ms + 200);
      },
    };
  };

  // The whole piece rendered offline (no speakers): for measuring loudness.
  // opts: music / ambience false to leave one out, mute (stems) and trace (see _lofi.js),
  // seed (the same performance again), track (an ArrayBuffer played instead
  // of the generated music, as from his folder), duration (the break it is
  // arranged for, seconds; default `secs`), probe(ac, chain) to watch the
  // limiter while it renders.
  K.renderMusic = function (biome, secs, rate, opts) {
    opts = opts || {};
    var sr = rate || 48000;
    var ac = new OfflineAudioContext(2, Math.floor(secs * sr), sr);
    var c = chain(ac, biome);
    c.fade.gain.value = 1;
    if (opts.probe) opts.probe(ac, c);
    var parts = [];
    if (opts.ambience !== false && biome.ambience) parts.push(biome.ambience(ac, c.amb));
    var music;
    if (opts.track) {
      music = playFolder(ac, c, { nextTrack: function () { var d = opts.track; opts.track = null; return d ? { name: 'test', data: d } : { error: 'only one' }; } },
        function () { return false; });
    } else if (opts.music === false || !biome.lofi) music = Promise.resolve();
    else {
      music = window.RelaxLofi.loadBanks(ac, biome.lofi).then(function (banks) {
        parts.push(window.RelaxLofi.track(ac, c.music, biome.lofi, banks,
          { rnd: opts.seed ? window.RelaxLofi.rng(opts.seed) : null, mute: opts.mute, trace: opts.trace, length: opts.duration || secs }));
      });
    }
    return music.then(function () { parts.forEach(function (s) { s(secs); }); return ac.startRendering(); });
  };
})();

/* Background field for eetunetti.com
   Contour lines of a slowly shifting height field: the world, continuous and messy.
   Crosses pop onto the lines and fade again, anywhere on the page but mostly near
   the pointer: the grid we lay over it.
   Draws on a fixed canvas behind the page. Nothing is tracked or sent anywhere. */
(() => {
  'use strict';
  const canvas = document.querySelector('canvas.field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  /* Tunables ------------------------------------------------------------ */
  const CELL = 8;                          // marching-squares cell, css px
  const FREQ_X = 0.0015, FREQ_Y = 0.0042;  // anisotropic field: features run sideways
  const OCTAVE2 = 0.45;                    // weight of the finer second octave
  const LEVEL_STEP = 0.11, LEVEL_MAX = 0.7;
  const DRIFT_T = 0.000015;                // how fast the terrain morphs
  const DRIFT_X = 0.0012;                  // horizontal slide, px per ms
  const LINE_ALPHA = 0.12;
  const FRAME_MS = 33;                     // ~30 fps is plenty for this

  const CROSS_ALPHA = 0.18;                // a shade above the lines so they register at all
  const RADIUS = 160;                      // "near the pointer" means within this
  const NEAR_SHARE = 0.7;                  // with a pointer present, share of spawns that land near it
  const SPAWN_RATE = 5;                    // per second while the pointer is on the page
  const AMBIENT_RATE = 2;                  // per second anywhere, pointer or not
  const MOVE_BONUS = 1 / 80;               // extra spawns per px of pointer travel
  const TAP_BURST = 4;                     // extra spawns on pointerdown (taps on touch)
  const MAX_CROSSES = 48;
  const MIN_DIST = 18;                     // keep crosses apart
  const ARM = 5.5, PAD = 4;                // cross arm length, mask margin around it
  const IN_MS = 260, OUT_MS = 240;
  const LIFE_MIN = 1600, LIFE_MAX = 3400;
  /* --------------------------------------------------------------------- */

  const LEVELS = [];
  for (let v = -LEVEL_MAX; v <= LEVEL_MAX + 1e-6; v += LEVEL_STEP) LEVELS.push(v);

  let W = 0, H = 0, cols = 0, rows = 0, field = new Float32Array(0);
  let ink = '#141414', bg = '#F4F2EC';
  let t = Math.random() * 100, xoff = Math.random() * 1000;
  let lastDraw = 0, raf = 0, dirty = true, budget = 0;
  const ptr = { x: 0, y: 0, px: 0, py: 0, on: false };
  const crosses = [];

  /* Perlin improved noise, 3D */
  const perm = new Uint8Array(512);
  {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const fade = a => a * a * a * (a * (a * 6 - 15) + 10);
  const lerp = (a, b, k) => a + (b - a) * k;
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  function noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u),
           lerp(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u),
           lerp(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w);
  }
  const height = (x, y, z) =>
    (noise(x, y, z) + OCTAVE2 * noise(x * 2 + 31.7, y * 2 + 17.3, z * 1.3)) / (1 + OCTAVE2);

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    ink = s.getPropertyValue('--ink').trim() || ink;
    bg = s.getPropertyValue('--bg').trim() || bg;
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL) + 2; rows = Math.ceil(H / CELL) + 2;
    field = new Float32Array(cols * rows);
    dirty = true;
  }
  function computeField() {
    for (let r = 0; r < rows; r++) {
      const ny = r * CELL * FREQ_Y;
      for (let c = 0; c < cols; c++) field[r * cols + c] = height((c * CELL + xoff) * FREQ_X, ny, t);
    }
  }

  /* Marching squares. Corner bits: TL=8 TR=4 BR=2 BL=1. Edges: 0 top, 1 right, 2 bottom, 3 left. */
  const SEGS = [null, [3, 2], [1, 2], [3, 1], [0, 1], [0, 3, 1, 2], [0, 2], [0, 3],
                [0, 3], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [1, 2], [3, 2], null];
  const ex = new Float64Array(4), ey = new Float64Array(4);

  /* Draws all contours; collects spawn candidates (segment midpoints) into
     `near` (weighted toward the pointer) and `far` (a thin uniform sample of everything). */
  function drawContours(near, far) {
    ctx.globalAlpha = LINE_ALPHA; ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.lineJoin = 'round';
    ctx.beginPath();
    const r2 = RADIUS * RADIUS, salt = (Math.random() * 64) | 0;
    let n = 0;
    for (const L of LEVELS) {
      for (let r = 0; r < rows - 1; r++) {
        const y0 = r * CELL;
        for (let c = 0; c < cols - 1; c++) {
          const i = r * cols + c;
          const a = field[i], b = field[i + 1], d = field[i + cols], e = field[i + cols + 1];
          const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (e > L ? 2 : 0) | (d > L ? 1 : 0);
          const seg = SEGS[idx];
          if (!seg) continue;
          const x0 = c * CELL;
          ex[0] = x0 + CELL * (L - a) / (b - a); ey[0] = y0;
          ex[1] = x0 + CELL;                     ey[1] = y0 + CELL * (L - b) / (e - b);
          ex[2] = x0 + CELL * (L - d) / (e - d); ey[2] = y0 + CELL;
          ex[3] = x0;                            ey[3] = y0 + CELL * (L - a) / (d - a);
          for (let s = 0; s < seg.length; s += 2) {
            const p = seg[s], q = seg[s + 1];
            ctx.moveTo(ex[p], ey[p]); ctx.lineTo(ex[q], ey[q]);
            const mx = (ex[p] + ex[q]) / 2, my = (ey[p] + ey[q]) / 2;
            if (near) {
              const dx = mx - ptr.x, dy = my - ptr.y, d2 = dx * dx + dy * dy;
              if (d2 < r2) {
                const w = 1 - Math.sqrt(d2) / RADIUS;
                if (near.length < 240 && Math.random() < w * w * 0.5) near.push(mx, my);
                n++; continue;
              }
            }
            if ((n++ & 63) === salt && far.length < 160) far.push(mx, my);
          }
        }
      }
    }
    ctx.stroke();
  }

  function spawn(near, far, el, now) {
    const moved = ptr.on ? Math.hypot(ptr.x - ptr.px, ptr.y - ptr.py) : 0;
    ptr.px = ptr.x; ptr.py = ptr.y;
    const rate = ptr.on ? SPAWN_RATE : AMBIENT_RATE;
    budget = Math.min(budget + el * rate / 1000 + moved * MOVE_BONUS, 6);
    let tries = 0;
    while (budget >= 1 && crosses.length < MAX_CROSSES && tries < 14) {
      const useNear = near && near.length >= 2 && (far.length < 2 || Math.random() < NEAR_SHARE);
      const pool = useNear ? near : far;
      if (pool.length < 2) break;
      const j = (Math.random() * (pool.length / 2)) | 0;
      const x = pool[j * 2], y = pool[j * 2 + 1];
      pool.splice(j * 2, 2); tries++;
      let ok = true;
      for (const k of crosses) if (Math.abs(k.x - x) < MIN_DIST && Math.abs(k.y - y) < MIN_DIST) { ok = false; break; }
      if (!ok) continue;
      crosses.push({ x, y, s: 0, t0: now, life: LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN) });
      budget -= 1;
    }
  }

  const backOut = k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  function drawCrosses(now) {
    if (!crosses.length) return;
    ctx.globalAlpha = 1; ctx.fillStyle = bg;
    for (let i = crosses.length - 1; i >= 0; i--) {
      const k = crosses[i], age = now - k.t0;
      let s;
      if (age < IN_MS) s = backOut(age / IN_MS);
      else if (age < IN_MS + k.life) s = 1;
      else { const o = (age - IN_MS - k.life) / OUT_MS; if (o >= 1) { crosses.splice(i, 1); continue; } s = 1 - o * o; }
      k.s = s;
      const half = (ARM + PAD) * s;
      ctx.fillRect(k.x - half, k.y - half, half * 2, half * 2);
    }
    ctx.globalAlpha = CROSS_ALPHA; ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const k of crosses) {
      const a = ARM * Math.min(1, k.s), x = Math.round(k.x) + 0.5, y = Math.round(k.y) + 0.5;
      ctx.moveTo(x, y - a); ctx.lineTo(x, y + a);
      ctx.moveTo(x - a, y); ctx.lineTo(x + a, y);
    }
    ctx.stroke();
  }

  function frame(now) {
    raf = 0;
    const animate = !reduceMotion.matches;
    const el = Math.min(100, now - lastDraw);
    if (dirty || el >= FRAME_MS) {
      if (animate && lastDraw) { t += el * DRIFT_T; xoff += el * DRIFT_X; }
      lastDraw = now;
      computeField();
      ctx.clearRect(0, 0, W, H);
      const near = ptr.on ? [] : null, far = [];
      drawContours(near, far);
      spawn(near, far, el, now);
      drawCrosses(now);
      dirty = false;
    }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function point(e) { ptr.x = e.clientX; ptr.y = e.clientY; if (!ptr.on) { ptr.px = ptr.x; ptr.py = ptr.y; } ptr.on = true; }
  window.addEventListener('pointermove', point, { passive: true });
  window.addEventListener('pointerdown', e => { point(e); budget += TAP_BURST; }, { passive: true });
  window.addEventListener('pointerout', e => { if (!e.relatedTarget) ptr.on = false; });
  window.addEventListener('blur', () => { ptr.on = false; });
  window.addEventListener('resize', () => { resize(); kick(); }, { passive: true });
  darkScheme.addEventListener('change', () => { readColors(); dirty = true; kick(); });
  reduceMotion.addEventListener('change', () => { dirty = true; kick(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastDraw = 0; kick(); } });

  readColors(); resize(); kick();
})();

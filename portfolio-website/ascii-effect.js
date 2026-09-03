/* ============================================================
   Vapor Halftone Portrait — Canvas2D reimplementation
   Pipeline: photo → blurred bg → cell grid sampling → ordered
   dither → tint (soft-light) → bloom + halftone + vignette →
   shimmer animation + cursor motion flow.
   ============================================================ */

(() => {
  const PARAMS = {
    renderMode: "dither",
    bgMode: "blur",
    bgBlur: 12,
    bgOpacity: 90,
    cellSize: 10,
    coverage: 100,
    invert: false,
    brightness: 0,
    contrast: 115,
    tint: "#ff8a3d",
    tintOpacity: 25,
    overlayBlend: "soft-light",
    saturation: 100,
    grayscale: 0,
    pfx: {
      vignette: { enabled: true, intensity: 38 },
      bloom: { enabled: true, intensity: 60 },
      halftone: { enabled: true, intensity: 40 },
    },
    animated: true,
    animStyle: "shimmer",
    animSpeed: 100,
    animIntensity: 60,
  };

  // 4x4 Bayer matrix for ordered dithering, normalized 0..1
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ].map((row) => row.map((v) => (v + 0.5) / 16));

  const canvas = document.querySelector(".ascii-canvas");
  if (!canvas) return;

  const hero = canvas.closest(".hero");
  const ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const img = new Image();
  img.src = "assets/ref-068.webp";

  // Offscreen layers
  const bgLayer = document.createElement("canvas"); // blurred photo backdrop
  const fxLayer = document.createElement("canvas"); // dither grid (bloom source)
  const bgCtx = bgLayer.getContext("2d");
  const fxCtx = fxLayer.getContext("2d");

  let W = 0, H = 0, DPR = 1;
  let gridW = 0, gridH = 0, cellPx = 0;
  let cells = null; // Float32Array [r,g,b,lum] per cell
  let halftonePattern = null;

  // Cursor motion flow field: per-cell {fx, fy, energy}
  let flowX = null, flowY = null, flowE = null;
  const pointer = { x: -1e4, y: -1e4, px: -1e4, py: -1e4, vx: 0, vy: 0, active: false };

  function contrastCurve(v, amount) {
    // amount 100 = identity; 115 pushes midtone contrast
    const c = amount / 100;
    return Math.min(1, Math.max(0, (v - 0.5) * c + 0.5));
  }

  function coverFit(iw, ih, w, h) {
    const s = Math.max(w / iw, h / ih);
    return { sw: iw, sh: ih, dx: (w - iw * s) / 2, dy: (h - ih * s) / 2, dw: iw * s, dh: ih * s };
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, Math.round(rect.width * DPR));
    H = Math.max(1, Math.round(rect.height * DPR));
    canvas.width = W;
    canvas.height = H;
    bgLayer.width = W;
    bgLayer.height = H;
    fxLayer.width = W;
    fxLayer.height = H;

    cellPx = Math.round(PARAMS.cellSize * DPR);
    gridW = Math.ceil(W / cellPx);
    gridH = Math.ceil(H / cellPx);

    sampleCells();
    buildBackground();
    buildHalftonePattern();

    flowX = new Float32Array(gridW * gridH);
    flowY = new Float32Array(gridW * gridH);
    flowE = new Float32Array(gridW * gridH);

    // Always paint one frame immediately so the portrait is visible even
    // before the first rAF tick (or permanently, under reduced motion /
    // throttled background tabs).
    renderFrame(0);
  }

  // Step 2: draw photo at grid resolution and sample per-cell color/luminance
  function sampleCells() {
    const s = document.createElement("canvas");
    s.width = gridW;
    s.height = gridH;
    const sc = s.getContext("2d");
    const f = coverFit(img.naturalWidth, img.naturalHeight, gridW, gridH);
    sc.drawImage(img, f.dx, f.dy, f.dw, f.dh);
    const data = sc.getImageData(0, 0, gridW, gridH).data;

    cells = new Float32Array(gridW * gridH * 4);
    for (let i = 0; i < gridW * gridH; i++) {
      let r = data[i * 4] / 255;
      let g = data[i * 4 + 1] / 255;
      let b = data[i * 4 + 2] / 255;
      // Step 4 (per-cell part): contrast on color channels
      r = contrastCurve(r, PARAMS.contrast);
      g = contrastCurve(g, PARAMS.contrast);
      b = contrastCurve(b, PARAMS.contrast);
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (PARAMS.invert) lum = 1 - lum;
      cells[i * 4] = r;
      cells[i * 4 + 1] = g;
      cells[i * 4 + 2] = b;
      cells[i * 4 + 3] = lum;
    }
  }

  // Step 1: background = blurred copy of the photo at bgOpacity over dark base
  function buildBackground() {
    bgCtx.save();
    bgCtx.fillStyle = "#09090b";
    bgCtx.fillRect(0, 0, W, H);
    const f = coverFit(img.naturalWidth, img.naturalHeight, W, H);
    bgCtx.filter = `blur(${PARAMS.bgBlur * DPR}px) brightness(0.55)`;
    bgCtx.globalAlpha = PARAMS.bgOpacity / 100;
    bgCtx.drawImage(img, f.dx, f.dy, f.dw, f.dh);
    bgCtx.restore();
    // darken edges of bg so hero text stays readable
    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(9,9,11,0.55)");
    g.addColorStop(0.55, "rgba(9,9,11,0.35)");
    g.addColorStop(1, "rgba(9,9,11,0.85)");
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);
  }

  // Step 5 (halftone): tileable dot pattern overlaid at intensity
  function buildHalftonePattern() {
    const t = document.createElement("canvas");
    const p = Math.max(4, Math.round(6 * DPR));
    t.width = p;
    t.height = p;
    const tc = t.getContext("2d");
    tc.fillStyle = "rgba(255,255,255,0.5)";
    tc.beginPath();
    tc.arc(p / 2, p / 2, p * 0.22, 0, Math.PI * 2);
    tc.fill();
    halftonePattern = ctx.createPattern(t, "repeat");
  }

  // Cheap deterministic value noise for shimmer
  function noise(x, y, t) {
    return (
      Math.sin(x * 12.9898 + y * 78.233 + t) * 0.5 +
      Math.sin(x * 3.7 - y * 9.1 + t * 1.7) * 0.5
    ) * 0.5;
  }

  function injectFlow() {
    if (!pointer.active) return;
    const gx = (pointer.x * DPR) / cellPx;
    const gy = (pointer.y * DPR) / cellPx;
    const R = 9; // radius in cells
    const speed = Math.min(Math.hypot(pointer.vx, pointer.vy), 60) / 60;
    if (speed < 0.01) return;
    const x0 = Math.max(0, Math.floor(gx - R));
    const x1 = Math.min(gridW - 1, Math.ceil(gx + R));
    const y0 = Math.max(0, Math.floor(gy - R));
    const y1 = Math.min(gridH - 1, Math.ceil(gy + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - gx, y - gy);
        if (d > R) continue;
        const fall = (1 - d / R) ** 2 * speed;
        const i = y * gridW + x;
        flowX[i] += pointer.vx * 0.12 * fall;
        flowY[i] += pointer.vy * 0.12 * fall;
        flowE[i] = Math.min(1, flowE[i] + fall * 0.9);
      }
    }
  }

  function decayFlow() {
    for (let i = 0; i < flowE.length; i++) {
      flowX[i] *= 0.90;
      flowY[i] *= 0.90;
      flowE[i] *= 0.94;
    }
  }

  function renderFrame(timeMs) {
    const t = (timeMs / 1000) * (PARAMS.animSpeed / 100) * 2.2;
    const shimmerAmp = reducedMotion ? 0 : (PARAMS.animIntensity / 100) * 0.22;

    // ---- background layer ----
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgLayer, 0, 0);

    // ---- dither grid on fx layer (steps 2–3) ----
    fxCtx.clearRect(0, 0, W, H);
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        let lum = cells[i * 4 + 3];
        if (shimmerAmp) lum += noise(x, y, t) * shimmerAmp; // shimmer anim
        const e = flowE[i];
        if (e > 0.01) lum += e * 0.55; // cursor flow brightens wake

        const threshold = BAYER[y & 3][x & 3];
        if (lum <= threshold) continue; // ordered dither: cell not drawn

        const r = Math.round(cells[i * 4] * 255);
        const g = Math.round(cells[i * 4 + 1] * 255);
        const b = Math.round(cells[i * 4 + 2] * 255);
        fxCtx.fillStyle = `rgb(${r},${g},${b})`;

        // cursor flow displaces cells along the motion vector
        const ox = flowX[i] * DPR * 0.6;
        const oy = flowY[i] * DPR * 0.6;
        const size = cellPx * (0.55 + lum * 0.45) * (1 + e * 0.35);
        const cx = x * cellPx + cellPx / 2 + ox;
        const cy = y * cellPx + cellPx / 2 + oy;
        fxCtx.fillRect(cx - size / 2, cy - size / 2, size, size);
      }
    }

    // Step 4: tint via soft-light overlay
    fxCtx.save();
    fxCtx.globalCompositeOperation = PARAMS.overlayBlend;
    fxCtx.globalAlpha = PARAMS.tintOpacity / 100;
    fxCtx.fillStyle = PARAMS.tint;
    fxCtx.fillRect(0, 0, W, H);
    fxCtx.restore();

    // composite dither layer
    ctx.drawImage(fxLayer, 0, 0);

    // Step 5: bloom — blurred bright copy of the fx layer, additive
    if (PARAMS.pfx.bloom.enabled) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (PARAMS.pfx.bloom.intensity / 100) * 0.45;
      ctx.filter = `blur(${8 * DPR}px)`;
      ctx.drawImage(fxLayer, 0, 0);
      ctx.restore();
    }

    // Step 5: halftone dot overlay
    if (PARAMS.pfx.halftone.enabled) {
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = (PARAMS.pfx.halftone.intensity / 100) * 0.5;
      ctx.fillStyle = halftonePattern;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Step 5: vignette
    if (PARAMS.pfx.vignette.enabled) {
      const v = PARAMS.pfx.vignette.intensity / 100;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.9 * v})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  let running = false;
  function loop(timeMs) {
    if (!running) return;
    injectFlow();
    renderFrame(timeMs);
    decayFlow();
    pointer.vx *= 0.8;
    pointer.vy *= 0.8;
    requestAnimationFrame(loop);
  }

  function start() {
    if (running || reducedMotion) return;
    running = true;
    requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
  }

  // Cursor motion flow input
  hero.addEventListener("pointermove", (e) => {
    const rect = hero.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (pointer.active) {
      pointer.vx = x - pointer.px;
      pointer.vy = y - pointer.py;
    }
    pointer.px = pointer.x = x;
    pointer.py = pointer.y = y;
    pointer.active = true;
  });
  hero.addEventListener("pointerleave", () => {
    pointer.active = false;
    pointer.vx = pointer.vy = 0;
  });

  // Pause the loop when the hero is off-screen
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => (en.isIntersecting ? start() : stop())),
    { threshold: 0.05 }
  );

  img.addEventListener("load", () => {
    resize();
    io.observe(hero);
    start();
  });
  img.addEventListener("error", () => {
    canvas.remove(); // fall back to the plain CSS hero background
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
})();

/* ============================================================
   3D Motion Scroll Flow
   - Lerped scroll engine driving layered parallax (data-depth)
   - Scroll-linked 3D entrance/exit flow (data-flow)
   - Cursor-tilt 3D on hero and project cards (+ glare)
   - Wireframe 3D cubes rotating with scroll
   - Scroll progress bar
   All transforms are translate3d/rotate/scale + opacity only.
   ============================================================ */

(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const progressBar = document.querySelector(".scroll-progress");
  const hero = document.querySelector(".hero");
  const heroInner = document.querySelector(".hero-inner");
  const heroCanvas = document.querySelector(".ascii-canvas");
  const depthEls = Array.from(document.querySelectorAll("[data-depth]"));
  const flowEls = Array.from(document.querySelectorAll("[data-flow]"));
  const cubes = Array.from(document.querySelectorAll(".cube"));
  const cards = Array.from(document.querySelectorAll(".project-card"));

  if (reducedMotion) {
    // Static fallback: everything visible, no motion, no engine.
    flowEls.forEach((el) => (el.style.opacity = "1"));
    if (progressBar) progressBar.remove();
    return;
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  let targetScroll = window.scrollY;
  let scroll = targetScroll;
  let vh = window.innerHeight;
  let docH = document.documentElement.scrollHeight;

  // cursor tilt state (hero + per-card)
  const heroTilt = { tx: 0, ty: 0, x: 0, y: 0 };
  const cardState = cards.map(() => ({ tx: 0, ty: 0, x: 0, y: 0, hover: 0, thover: 0 }));

  function tick() {
    scroll = Math.abs(targetScroll - scroll) < 0.1 ? targetScroll : lerp(scroll, targetScroll, 0.12);

    // ---- scroll progress bar ----
    if (progressBar) {
      const p = clamp(scroll / Math.max(1, docH - vh), 0, 1);
      progressBar.style.transform = `scaleX(${p})`;
    }

    // ---- hero: content recedes into depth, portrait zooms past ----
    if (hero) {
      const hp = clamp(scroll / (hero.offsetHeight * 0.9), 0, 1);
      heroTilt.x = lerp(heroTilt.x, heroTilt.tx, 0.08);
      heroTilt.y = lerp(heroTilt.y, heroTilt.ty, 0.08);
      if (heroInner) {
        heroInner.style.transform =
          `translate3d(0, ${hp * 60}px, ${hp * -220}px)` +
          ` rotateX(${heroTilt.y * -4}deg) rotateY(${heroTilt.x * 4}deg)` +
          ` scale(${1 - hp * 0.1})`;
        heroInner.style.opacity = String(1 - hp * 0.95);
      }
      if (heroCanvas) {
        heroCanvas.style.transform =
          `translate3d(${heroTilt.x * -14}px, ${scroll * 0.25 + heroTilt.y * -10}px, 0)` +
          ` scale(${1.06 + hp * 0.12})`;
      }
    }

    // ---- layered parallax: elements drift relative to viewport center ----
    for (const el of depthEls) {
      const depth = parseFloat(el.dataset.depth);
      const r = el.getBoundingClientRect();
      // distance of element center from viewport center, before our transform
      const prev = el.__py || 0;
      const center = r.top + r.height / 2 - prev;
      const offset = (vh / 2 - center) * depth;
      el.__py = offset;
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    }

    // ---- scroll-linked 3D flow: enter from below rotated in depth ----
    for (const el of flowEls) {
      const r = el.getBoundingClientRect();
      const total = clamp((vh - r.top) / (vh * 0.6), 0, 1); // 0 offscreen → 1 settled
      const e = 1 - Math.pow(1 - total, 3); // ease-out cubic
      const dir = el.dataset.flow;
      const rotY = dir === "left" ? (1 - e) * -24 : dir === "right" ? (1 - e) * 24 : 0;
      const rotX = dir === "up" || dir === "" || dir === "in" ? (1 - e) * 16 : (1 - e) * 6;
      const base =
        `translate3d(0, ${(1 - e) * 70}px, ${(1 - e) * -160}px)` +
        ` rotateX(${rotX}deg) rotateY(${rotY}deg)`;
      el.__flow = base;
      el.style.opacity = String(clamp(e * 1.4, 0, 1));

      // project cards compose flow + cursor tilt in one transform
      const ci = cards.indexOf(el);
      if (ci !== -1) {
        const s = cardState[ci];
        s.x = lerp(s.x, s.tx, 0.12);
        s.y = lerp(s.y, s.ty, 0.12);
        s.hover = lerp(s.hover, s.thover, 0.12);
        el.style.transform =
          base +
          ` rotateX(${(s.y * -5).toFixed(2)}deg) rotateY(${(s.x * 6).toFixed(2)}deg)` +
          ` translate3d(0, ${(-6 * s.hover).toFixed(2)}px, ${(30 * s.hover).toFixed(2)}px)`;
      } else {
        el.style.transform = base;
      }
    }

    // ---- wireframe cubes: rotation driven by scroll ----
    for (const cube of cubes) {
      const speed = parseFloat(cube.dataset.spin || "0.06");
      cube.style.transform =
        `rotateX(${(scroll * speed + 20).toFixed(2)}deg) rotateY(${(scroll * speed * 1.4 + 35).toFixed(2)}deg)`;
    }
  }

  // ---- engine loop with stall fallback (throttled tabs still update on scroll) ----
  let lastTick = 0;
  function loop(t) {
    lastTick = t;
    tick();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.addEventListener(
    "scroll",
    () => {
      targetScroll = window.scrollY;
      if (performance.now() - lastTick > 200) {
        scroll = targetScroll; // rAF stalled: snap and render synchronously
        tick();
      }
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    vh = window.innerHeight;
    docH = document.documentElement.scrollHeight;
  });

  // ---- cursor tilt: hero ----
  if (hero) {
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      heroTilt.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; // -1..1
      heroTilt.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });
    hero.addEventListener("pointerleave", () => {
      heroTilt.tx = 0;
      heroTilt.ty = 0;
    });
  }

  // ---- cursor tilt + glare: project cards ----
  cards.forEach((card, i) => {
    const s = cardState[i];
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      s.tx = (px - 0.5) * 2;
      s.ty = (py - 0.5) * 2;
      card.style.setProperty("--gx", `${(px * 100).toFixed(1)}%`);
      card.style.setProperty("--gy", `${(py * 100).toFixed(1)}%`);
    });
    card.addEventListener("pointerenter", () => (s.thover = 1));
    card.addEventListener("pointerleave", () => {
      s.tx = s.ty = 0;
      s.thover = 0;
    });
  });

  // initial synchronous frame so the page is correct before the first rAF tick
  tick();
})();

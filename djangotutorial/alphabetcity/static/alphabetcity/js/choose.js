/*
 * Choose page interaction.
 *
 *  - Resist-then-snap stepper: the page has no native scroll. Wheel/touch intent
 *    accumulates as `tension`, which nudges the question track a fraction of a
 *    step (the resistance). Cross THRESHOLD -> snap to the next/prev question;
 *    release below it -> spring back to the current one.
 *  - Opacity comes from a CSS gradient mask on the viewport (focused = solid,
 *    neighbours fade, two steps away = invisible), so JS only sets transforms.
 *  - Three glyphs ride a quadratic-bezier arc through their Figma centres and
 *    advance along it with scroll (a conga line), fading at the path ends.
 */
(function () {
  "use strict";

  var root = document.querySelector(".choose");
  if (!root) return;

  var questions = [].slice.call(root.querySelectorAll(".choose__q"));
  var glyphEls = [].slice.call(root.querySelectorAll(".choose__glyph"));
  var N = questions.length;
  if (!N) return;

  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Tunables ------------------------------------------------------------- */
  var THRESHOLD = 90;     // wheel px to commit a snap
  var RESIST = 0.28;      // fraction of a step the track gives below threshold
  var SNAP_MS = 620;      // snap animation duration
  var RELEASE_MS = 100;   // idle before sub-threshold tension springs back
  var FADE_MS = 700;      // white fade before navigating to the chosen question
  var GLYPH_T0 = 0.15;    // bezier param of the leftmost glyph (now Glyph 4)
  var GLYPH_SLOT = 0.15;  // param gap between glyphs / per scroll step (lateral slide amount)
  var GLYPH_CATCH = 0.09; // glyph follow speed; LOWER = more resistance/lag before they travel

  // Quadratic bezier (normalised viewport coords) through the three glyph
  // centres, extended past both ends so glyphs enter/exit off-screen.
  var BZ = { s: [0.14, 1.03], c: [0.72, 0.52], e: [1.30, 0.83] };

  function stepPx() { return Math.min(150, Math.max(84, 0.15 * window.innerHeight)); }

  var STEP = stepPx();
  var index = 0;          // committed question
  var progress = 0;       // animated float position (drives questions)
  var glyphProgress = 0;  // damped follower of progress (drives glyphs, laggier)
  var tension = 0;        // accumulated sub-threshold intent
  var animating = false;
  var releaseTimer = null;
  var leaving = false;
  var fadeEl = root.querySelector(".choose__fade");

  /* Render --------------------------------------------------------------- */
  function bezier(t) {
    var mt = 1 - t;
    return [
      mt * mt * BZ.s[0] + 2 * mt * t * BZ.c[0] + t * t * BZ.e[0],
      mt * mt * BZ.s[1] + 2 * mt * t * BZ.c[1] + t * t * BZ.e[1]
    ];
  }

  function renderQuestions() {
    for (var i = 0; i < N; i++) {
      questions[i].style.transform = "translateY(" + ((i - progress) * STEP) + "px)";
    }
  }

  function renderGlyphs() {
    var vw = window.innerWidth, vh = window.innerHeight;
    for (var g = 0; g < glyphEls.length; g++) {
      var t = GLYPH_T0 + g * GLYPH_SLOT + glyphProgress * GLYPH_SLOT;   // laggy glyphProgress
      var p = bezier(t);
      var base = parseFloat(glyphEls[g].getAttribute("data-scale")) || 1;
      var scale = (0.85 + clamp01((t - GLYPH_T0) / (GLYPH_SLOT * 3)) * 0.3) * base;
      var fade = 1;
      if (t < 0.1) fade = clamp01((t + 0.02) / 0.12);
      else if (t > 0.9) fade = clamp01((1.02 - t) / 0.12);
      glyphEls[g].style.transform =
        "translate(" + (p[0] * vw) + "px," + (p[1] * vh) + "px) translate(-50%,-50%) scale(" + scale + ")";
      glyphEls[g].style.opacity = (0.9 * fade).toFixed(3);
    }
  }

  function render() { renderQuestions(); renderGlyphs(); }

  // Glyphs trail the questions: glyphProgress eases toward progress, so they
  // resist sliding along the bezier until scroll has actually committed.
  var glyphTicking = false;
  function ensureGlyphTick() {
    if (glyphTicking) return;
    glyphTicking = true;
    requestAnimationFrame(glyphTick);
  }
  function glyphTick() {
    var diff = progress - glyphProgress;
    if (Math.abs(diff) <= 0.001) {
      glyphProgress = progress;
      renderGlyphs();
      glyphTicking = false;
      return;
    }
    glyphProgress += diff * GLYPH_CATCH;
    renderGlyphs();
    requestAnimationFrame(glyphTick);
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  /* Focus + selection ---------------------------------------------------- */
  // Only the centered question is interactive; pass -1 to make none clickable
  // (e.g. mid-snap).
  function setFocus(i) {
    for (var k = 0; k < N; k++) {
      questions[k].classList.toggle("is-focused", k === i);
    }
  }

  // Chosen question: fade the screen to white (no movement), then navigate.
  function selectQuestion(href) {
    if (!href || leaving) return;
    leaving = true;
    if (fadeEl) fadeEl.classList.add("is-active");
    if (reduceMotion) { window.location.href = href; return; }
    setTimeout(function () { window.location.href = href; }, FADE_MS);
  }

  /* Snap animation ------------------------------------------------------- */
  function animateTo(target) {
    if (reduceMotion) { progress = index = glyphProgress = target; render(); animating = false; setFocus(index); return; }
    animating = true;
    setFocus(-1);                 // nothing clickable mid-snap
    var from = progress, dist = target - from, start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var k = Math.min(1, (ts - start) / SNAP_MS);
      progress = from + dist * easeOutCubic(k);
      renderQuestions();
      ensureGlyphTick();
      if (k < 1) requestAnimationFrame(frame);
      else { progress = index = target; animating = false; renderQuestions(); ensureGlyphTick(); setFocus(index); }
    }
    requestAnimationFrame(frame);
  }

  /* Input ---------------------------------------------------------------- */
  function commit(dir) {
    clearTimeout(releaseTimer);
    tension = 0;
    var target = Math.max(0, Math.min(N - 1, index + dir));
    animateTo(target);   // eases to a new index, or springs back to the same one
  }

  function springBack() {
    clearTimeout(releaseTimer);
    tension = 0;
    if (!animating) animateTo(index);
  }

  function pushTension(delta) {
    if (animating) return;
    tension += delta;
    var give = Math.max(-1, Math.min(1, tension / THRESHOLD)) * RESIST;
    if ((index === 0 && give < 0) || (index === N - 1 && give > 0)) give *= 0.35; // rubber-band edges
    progress = index + give;
    renderQuestions();
    ensureGlyphTick();
    if (Math.abs(tension) >= THRESHOLD) {
      commit(tension > 0 ? 1 : -1);
    } else {
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(springBack, RELEASE_MS);
    }
  }

  function onWheel(e) { e.preventDefault(); pushTension(e.deltaY); }

  function onKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var q = questions[index];
      if (q) selectQuestion(q.getAttribute("href"));
      return;
    }
    if (animating) return;
    if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); commit(1); }
    else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); commit(-1); }
  }

  var touchY = null;
  function onTouchStart(e) { touchY = e.touches[0].clientY; tension = 0; }
  function onTouchMove(e) {
    if (touchY === null || animating) return;
    e.preventDefault();
    pushTension((touchY - e.touches[0].clientY) * 2.2 - tension); // set tension from drag distance
    if (Math.abs(tension) >= THRESHOLD) touchY = null;
  }
  function onTouchEnd() { if (touchY !== null) { springBack(); touchY = null; } }

  // Click selects only the focused (centered) question.
  questions.forEach(function (q) {
    q.addEventListener("click", function (e) {
      if (!q.classList.contains("is-focused")) return;
      e.preventDefault();
      selectQuestion(q.getAttribute("href"));
    });
  });

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("resize", function () { STEP = stepPx(); render(); });

  render();
  setFocus(index);   // question 0 starts centered/clickable
})();

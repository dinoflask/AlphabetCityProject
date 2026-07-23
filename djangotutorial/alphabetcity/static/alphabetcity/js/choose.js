/*
 * Choose page interaction.
 *
 *  - Resist-then-snap stepper: no native scroll. Wheel/touch accumulates as
 *    `tension`; before a gesture's first snap the track shows a little "give"
 *    (resistance), then snaps stepwise. Snaps queue and never interrupt each
 *    other, so you always land centered — no mid-snap and no post-snap rebound.
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
  var THRESHOLD = 150;       // wheel px to commit ONE snap step
  var SNAP_MS = 620;        // snap animation duration
  var SNAP_COOLDOWN = 650;  // ms after a snap before another can fire (blocks momentum double-snap)
  var RESIST = 0.22;        // pre-snap "give": fraction of a step the track nudges before it snaps
  var GESTURE_GAP = 150;    // ms of quiet that settles the give / resets the accumulator
  var FADE_MS = 700;        // white fade before navigating to the chosen question
  var GLYPH_T0 = 0.08;      // bezier param of the leftmost glyph (Glyph 4)
  var GLYPH_SPACING = 0.21; // spread between glyphs along the path (BIGGER = more spread out)
  var GLYPH_SLOT = 0.15;    // how far glyphs travel along the path per scroll step
  var GLYPH_CATCH = 0.09;   // glyph follow speed; LOWER = more resistance/lag before they travel

  // Quadratic bezier (normalised viewport coords) through the three glyph
  // centres, extended past both ends so glyphs enter/exit off-screen.
  var BZ = { s: [0.14, 1.03], c: [0.72, 0.52], e: [1.30, 0.83] };

  function stepPx() { return Math.min(150, Math.max(84, 0.15 * window.innerHeight)); }

  var STEP = stepPx();
  var index = 0;          // committed question
  var progress = 0;       // animated float position (drives questions)
  var glyphProgress = 0;  // damped follower of progress (drives glyphs, laggier)
  var tension = 0;        // accumulated wheel delta toward the next snap
  var stepQueue = 0;      // pending snap steps (signed)
  var lastInputTime = 0;
  var lastSnapTime = 0;   // for the post-snap cooldown
  var settleTimer = null;
  var animating = false;
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
      var t = GLYPH_T0 + g * GLYPH_SPACING + glyphProgress * GLYPH_SLOT;   // spacing = spread, slot = travel
      var p = bezier(t);
      var base = parseFloat(glyphEls[g].getAttribute("data-scale")) || 1;
      var scale = (0.85 + clamp01((t - GLYPH_T0) / (GLYPH_SPACING * 3)) * 0.3) * base;
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
    if (reduceMotion) { progress = index = glyphProgress = target; render(); animating = false; setFocus(index); processQueue(); return; }
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
      else { progress = index = target; animating = false; renderQuestions(); ensureGlyphTick(); setFocus(index); processQueue(); }
    }
    requestAnimationFrame(frame);
  }

  /* Input: step queue — no give, no rebound ------------------------------ */
  // Play one queued step at a time, never interrupting a snap, so the user
  // always lands on a centered question and never mid-snap.
  function processQueue() {
    if (animating || stepQueue === 0) return;
    var dir = stepQueue > 0 ? 1 : -1;
    var target = index + dir;
    if (target < 0 || target > N - 1) { stepQueue = 0; return; }
    stepQueue -= dir;
    animateTo(target);
  }

  function enqueueStep(dir) {
    var eventual = index + stepQueue + dir;          // don't queue steps past the ends
    if (eventual < 0 || eventual > N - 1) return;
    stepQueue += dir;
    processQueue();
  }

  // Jump straight to a question (from a click on a grayed-out one).
  function goTo(target) {
    if (leaving || animating || stepQueue !== 0) return;
    if (target < 0 || target > N - 1 || target === index) return;
    tension = 0;
    clearTimeout(settleTimer);
    animateTo(target);
  }

  // Accumulate input. Below THRESHOLD the track shows a little "give" (initial
  // resistance); crossing it snaps once. After a snap, SNAP_COOLDOWN swallows all
  // input (incl. trackpad momentum) so ONE scroll = ONE snap — going two down
  // needs a deliberate second scroll. Tension can't bank against an edge, so the
  // ends rubber-band instead of stalling. Quiet for GESTURE_GAP settles the give.
  function feedDelta(delta) {
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (now - lastInputTime > GESTURE_GAP) tension = 0;   // quiet gap resets the accumulator
    lastInputTime = now;

    if (now - lastSnapTime < SNAP_COOLDOWN) { tension = 0; return; }  // post-snap: swallow momentum
    if (animating || stepQueue !== 0) { tension = 0; return; }

    tension += delta;
    // Can't bank tension past an edge -> rubber-band, and reversing stays snappy.
    if (index === 0) tension = Math.max(tension, -THRESHOLD * 0.5);
    if (index === N - 1) tension = Math.min(tension, THRESHOLD * 0.5);

    if (Math.abs(tension) >= THRESHOLD) {          // edges are capped, so dir is in-bounds
      var dir = tension > 0 ? 1 : -1;
      tension = 0;
      lastSnapTime = now;
      clearTimeout(settleTimer);
      enqueueStep(dir);
      return;
    }

    // Pre-snap give (initial resistance), then settle back when input stops.
    progress = index + (tension / THRESHOLD) * RESIST;
    renderQuestions();
    ensureGlyphTick();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, GESTURE_GAP);
  }

  // Input went quiet: relax any leftover give back to center, with no overshoot.
  function settle() {
    tension = 0;
    if (!animating && stepQueue === 0 && progress !== index) animateTo(index);
  }

  function onWheel(e) { e.preventDefault(); feedDelta(e.deltaY); }

  function onKey(e) {
    if (e.key === "Enter") {
      // If a question link is focused, let its own click handler run.
      var ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains("choose__q")) return;
      e.preventDefault();
      var q = questions[index];
      if (q) selectQuestion(q.getAttribute("href"));
      return;
    }
    if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); enqueueStep(1); }
    else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); enqueueStep(-1); }
  }

  var touchY = null;
  function onTouchStart(e) { touchY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (touchY === null) return;
    e.preventDefault();
    var y = e.touches[0].clientY;
    feedDelta((touchY - y) * 2);   // drag up = advance
    touchY = y;
  }
  function onTouchEnd() { touchY = null; }

  // Click the centered question to choose it; click a grayed one to center it
  // first (no scrolling needed).
  questions.forEach(function (q, i) {
    q.addEventListener("click", function (e) {
      e.preventDefault();
      if (i === index && !animating && stepQueue === 0) {
        selectQuestion(q.getAttribute("href"));
      } else {
        goTo(i);
      }
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

  // When returning here via the browser Back button, the page is often restored
  // from the bfcache with the white leave-fade still active. Clear it INSTANTLY
  // (transition disabled) so Back doesn't replay the fade — forward navigation
  // still fades normally.
  window.addEventListener("pageshow", function () {
    leaving = false;
    if (fadeEl) {
      fadeEl.style.transition = "none";
      fadeEl.classList.remove("is-active");
      void fadeEl.offsetWidth;      // commit the change before restoring the transition
      fadeEl.style.transition = "";
    }
    render();
  });
})();

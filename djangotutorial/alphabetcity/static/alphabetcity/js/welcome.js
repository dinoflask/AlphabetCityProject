/*
 * Welcome page behaviour.
 *
 * Three effects, all data-driven so choreography is one-line config:
 *   1. Title  — letters fade in one-by-one in a seeded "random-looking" order.
 *   2. Enter  — on hover, letters recolor red -> black in a center-out ripple
 *               (t, then n+e, then E+r, each stage +50ms); reverses on unhover.
 *   3. Leave  — on click, content slides up + the screen fades to white, then
 *               navigates to the Code page.
 *
 * Everything runs client-side; the server never sees any of it.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Tunables ------------------------------------------------------------- */
  var TITLE_STEP_MS = 55;   // gap between successive title letters
  var FADE_MS = 280
  ;        // per-letter fade duration (matches CSS transition)
  var HOLD_MS = 90;         // pause at zero opacity before returning in new color
  var STAGE_MS = 50;        // gap between Enter ripple stages
  var ARROW_MS = 400;       // arrow erase, then redraw (each leg)
  var LEAVE_MS = 1000;      // Welcome -> Code white fade (matches Figma 1.0s)
  var TITLE_SEED = 20240607;

  var ENTER_RED = token("--accent-red", "#d32d1d");
  var ENTER_BLACK = token("--ink", "#000000");

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* Deterministic PRNG so the "random" order is fixed across loads --------- */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffledIndices(n, seed) {
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(i);
    var rand = mulberry32(seed);
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(rand() * (j + 1));
      var tmp = arr[j];
      arr[j] = arr[k];
      arr[k] = tmp;
    }
    return arr;
  }

  /* Split an element's text into per-letter spans, tagging word-initials.
     Returns the array of letter spans (spaces excluded). */
  function splitText(el, letterClass) {
    var text = el.textContent;
    el.textContent = "";
    var letters = [];
    var atWordStart = true;

    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === " ") {
        var space = document.createElement("span");
        space.className = "welcome__space";
        space.setAttribute("aria-hidden", "true");
        space.innerHTML = "&nbsp;";
        el.appendChild(space);
        atWordStart = true;
        continue;
      }
      var span = document.createElement("span");
      span.className = letterClass + (atWordStart ? " is-initial" : "");
      span.setAttribute("aria-hidden", "true");
      span.textContent = ch;
      el.appendChild(span);
      letters.push(span);
      atWordStart = false;
    }
    return letters;
  }

  /* Center-out index groups: for n=5 -> [[2],[1,3],[0,4]]. */
  function rippleGroups(n) {
    var groups = [];
    var left = Math.floor((n - 1) / 2);
    var right = Math.ceil((n - 1) / 2);
    if (left === right) {
      groups.push([left]);
      left--;
      right++;
    }
    while (left >= 0) {
      groups.push([left, right]);
      left--;
      right++;
    }
    return groups;
  }

  /* 1. Title fade-in ----------------------------------------------------- */
  function animateTitle() {
    var lines = document.querySelectorAll(".welcome__title [data-splittext]");
    var all = [];
    lines.forEach(function (line) {
      splitText(line, "welcome__letter").forEach(function (l) { all.push(l); });
    });

    if (reduceMotion) {
      all.forEach(function (l) { l.style.opacity = "1"; });
      return;
    }

    var order = shuffledIndices(all.length, TITLE_SEED);
    order.forEach(function (letterIndex, rank) {
      var el = all[letterIndex];
      el.style.animationDelay = rank * TITLE_STEP_MS + "ms";
      el.classList.add("is-fading-in");
    });
  }

  /* 2. Enter hover ripple + 3. leave ------------------------------------- */
  function setupEnter() {
    var btn = document.querySelector(".welcome__enter");
    if (!btn) return;

    var letters = splitText(btn.querySelector(".welcome__enter-text"), "welcome__enter-letter");
    // Enter letters are visible by default; do NOT set inline opacity here, or
    // the .is-fading class (opacity: 0) can never win against the inline style.
    var arrowPath = btn.querySelector(".welcome__arrow-path");

    var hoverGroups = rippleGroups(letters.length);   // [[2],[1,3],[0,4]]
    var leaveGroups = hoverGroups.slice().reverse();  // reverse on unhover

    var pending = [];
    function clearPending() {
      pending.forEach(clearTimeout);
      pending = [];
    }

    // Recolor letters group-by-group. Each letter: fade fully to nothing, hold
    // at zero (swapping color while invisible), then fade back in as the new
    // color. `groups` sets ripple order; +STAGE_MS between stages.
    function recolor(groups, color) {
      clearPending();
      groups.forEach(function (group, stage) {
        group.forEach(function (idx) {
          var el = letters[idx];
          pending.push(setTimeout(function () {
            el.classList.add("is-fading");                  // fade out to 0
            pending.push(setTimeout(function () {
              el.style.color = color;                       // swap while invisible
              pending.push(setTimeout(function () {
                el.classList.remove("is-fading");           // fade back in
              }, HOLD_MS));                                  // ...after a beat at nothing
            }, FADE_MS));
          }, stage * STAGE_MS));
        });
      });
    }

    // Arrow: erase the stroke tail-first, then redraw it tail-first in the new
    // color, recoloring at the invisible midpoint. Uses a normalized pathLength
    // of 100:  offset 0 = drawn,  -100 = erased from the tail,  100 = hidden.
    function redrawArrow(color) {
      if (!arrowPath) return;
      if (reduceMotion) {
        arrowPath.style.stroke = color;
        arrowPath.style.strokeDashoffset = "0";
        return;
      }
      arrowPath.style.transition = "stroke-dashoffset " + ARROW_MS + "ms ease-in";
      arrowPath.style.strokeDashoffset = "-100";          // draw away, from the tail
      pending.push(setTimeout(function () {
        arrowPath.style.transition = "none";
        arrowPath.style.strokeDashoffset = "100";         // jump to hidden (un-animated)
        arrowPath.style.stroke = color;                   // recolor while invisible
        void arrowPath.getBoundingClientRect();           // commit the jump
        arrowPath.style.transition = "stroke-dashoffset " + ARROW_MS + "ms ease-out";
        arrowPath.style.strokeDashoffset = "0";           // redraw, from the tail
      }, ARROW_MS));
    }

    function toBlack(groups) { recolor(groups, ENTER_BLACK); redrawArrow(ENTER_BLACK); }
    function toRed(groups) { recolor(groups, ENTER_RED); redrawArrow(ENTER_RED); }

    if (reduceMotion) {
      var paint = function (c) {
        letters.forEach(function (l) { l.style.color = c; });
        if (arrowPath) arrowPath.style.stroke = c;
      };
      bind(btn, ENTER_BLACK, ENTER_RED, paint, paint);
    } else {
      bind(btn, hoverGroups, leaveGroups, toBlack, toRed);
    }

    btn.addEventListener("click", leave);

    // Pressing Enter anywhere does the same as clicking "Enter" — unless a control
    // is focused (let its own activation handle it) or the privacy popup is open.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var privacy = document.getElementById("privacy-panel");
      if (privacy && privacy.classList.contains("open")) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "TEXTAREA") return;
      leave();
    });
  }

  // Wire hover + keyboard-focus to the same enter/leave handlers.
  function bind(btn, enterArg, leaveArg, onEnter, onLeave) {
    btn.addEventListener("mouseenter", function () { onEnter(enterArg); });
    btn.addEventListener("focus", function () { onEnter(enterArg); });
    btn.addEventListener("mouseleave", function () { onLeave(leaveArg); });
    btn.addEventListener("blur", function () { onLeave(leaveArg); });
  }

  var leaving = false;
  function leave() {
    if (leaving) return;
    leaving = true;
    var welcome = document.querySelector(".welcome");
    var next = welcome.getAttribute("data-next") || "/";
    if (reduceMotion) {
      window.location.href = next;
      return;
    }
    welcome.classList.add("is-leaving");
    setTimeout(function () { window.location.href = next; }, LEAVE_MS);
  }

  /* 4. Privacy information popup ----------------------------------------- */
  function setupPrivacy() {
    var link = document.querySelector(".welcome__privacy");
    var panel = document.getElementById("privacy-panel");
    if (!link || !panel) return;
    var close = document.getElementById("privacy-close");

    function hide() { panel.classList.remove("open"); }

    link.addEventListener("click", function (e) {
      e.preventDefault();          // it's an in-page popup, not a navigation
      panel.classList.add("open");
    });
    if (close) close.addEventListener("click", hide);
    // Click the dim backdrop (but not the card) to close.
    panel.addEventListener("click", function (e) { if (e.target === panel) hide(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
  }

  animateTitle();
  setupEnter();
  setupPrivacy();

  // Returning here via Back can restore the page (from bfcache) mid-leave — slid
  // up and faded to white. Clear it INSTANTLY (transitions disabled) so Back
  // doesn't replay the leave animation; forward navigation still animates.
  window.addEventListener("pageshow", function () {
    leaving = false;
    var welcome = document.querySelector(".welcome");
    if (!welcome) return;
    var animated = welcome.querySelectorAll(".welcome__content, .welcome__fade");
    animated.forEach(function (el) { el.style.transition = "none"; });
    welcome.classList.remove("is-leaving");
    void welcome.offsetWidth;       // commit before restoring transitions
    animated.forEach(function (el) { el.style.transition = ""; });
  });
})();

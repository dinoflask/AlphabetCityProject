// Django entry: both scenes layered on the Index page.
//   #garden-bg  — fixed full-screen garden background (behind)
//   #index-root — transparent answer-dots canvas (in front)
import Garden from "./garden.js";
import Sketch from "./app.js";

const gardenEl = document.getElementById("garden-bg");
const dotsEl = document.getElementById("index-root");

// Answers come from the database, injected by Django via {{ ...|json_script }}.
const dataEl = document.getElementById("answers-data");
const answers = dataEl ? JSON.parse(dataEl.textContent) : [];

const garden = gardenEl ? new Garden({ dom: gardenEl }) : null;
const dots = dotsEl ? new Sketch({ dom: dotsEl, answers }) : null;

// ---------------------------------------------------------------------------
// Screensaver mode: click the top-right button to zoom the glyph + garden in a
// touch, hide the cursor and UI icons, and auto-cycle each answer's details.
// Each answer stays on screen for a duration scaled by its word count (short
// answers cycle quickly, long ones linger). Only the Escape key eases
// everything back — a "Press Esc to exit" notice fades in and out at the
// bottom when it starts, so moving the mouse or pressing other keys doesn't
// kick you out.
// ---------------------------------------------------------------------------
const toggle = document.getElementById("screensaver-toggle");
if (toggle && dots) {
  const ZOOM = 1.3;        // subtle push-in
  const FIRST_MS = 1200;   // first detail shortly after the zoom settles

  // --- auto-cycle pacing, scaled by word count -----------------------------
  const CYCLE = (function () {
    const MIN_MS = 5000;    // 1-word answer
    const MAX_MS = 50000;   // 200-word (max) answer
    const MIN_WORDS = 1;
    const MAX_WORDS = 200;

    function wordCount(text) {
      return (text || "").trim().split(/\s+/).filter(Boolean).length;
    }

    function delayFor(answer) {
      const wc = wordCount(answer && answer.body);
      const clamped = Math.max(MIN_WORDS, Math.min(MAX_WORDS, wc));
      const t = (clamped - MIN_WORDS) / (MAX_WORDS - MIN_WORDS); // 0..1
      return MIN_MS + (MAX_MS - MIN_MS) * t;
    }

    return { delayFor };
  })();

  // --- self-contained auto-cycle controller --------------------------------
  // Owns its own pointer into `answers` rather than reading dots._autoPtr, so
  // it only ever touches Sketch's public API (autoSelectNext / unlockMenu).
  const autoCycle = (function () {
    let ptr = -1;
    let timer = null;

    function tick() {
      ptr = (ptr + 1) % answers.length;
      dots.autoSelectNext();
      const delay = CYCLE.delayFor(answers[ptr]);
      timer = setTimeout(tick, delay);
    }

    function start() {
      ptr = -1;
      timer = setTimeout(tick, FIRST_MS);
    }

    function stop() {
      clearTimeout(timer);
      timer = null;
    }

    return { start, stop };
  })();
  // ---------------------------------------------------------------------------

  const hint = document.getElementById("screensaver-hint");

  let active = false;

  function onKeyExit(e) { if (e.key === "Escape") exit(); }
  function armExit() { window.addEventListener("keydown", onKeyExit); }
  function disarmExit() { window.removeEventListener("keydown", onKeyExit); }

  // The /tv/ page boots straight into fullscreen and stays there — no exit key,
  // no "Press Esc" hint.
  const TV = document.body.classList.contains("tv");

  function enter(lock) {
    if (active) return;
    active = true;

    // Close the help panel if it happens to be open.
    const help = document.getElementById("help-panel");
    if (help) help.classList.remove("open");

    document.body.classList.add("screensaver"); // fades out the corner icons (CSS)
    document.body.style.cursor = "none";

    // Replay the "Press Esc to exit" fade-in/out (skipped on the locked /tv/ page).
    if (hint && !lock) {
      hint.classList.remove("show");
      void hint.offsetWidth;   // reflow so the animation restarts
      hint.classList.add("show");
    }

    dots.setZoom(ZOOM);
    dots.setAutoMode(true);
    if (garden) { garden.setZoom(ZOOM); garden.triggerBurst(); }

    autoCycle.start();

    if (!lock) armExit();   // /tv/ has no exit
  }

  function exit() {
    if (!active) return;
    active = false;
    disarmExit();
    autoCycle.stop();

    if (hint) hint.classList.remove("show");

    document.body.classList.remove("screensaver");
    document.body.style.cursor = "";

    dots.setZoom(1);
    dots.setAutoMode(false);
    dots.unlockMenu();
    if (garden) { garden.setZoom(1); garden.triggerBurst(); } // little settle burst on the way out
  }

  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    enter();
  });

  // /tv/: auto-start fullscreen once the scene is up, and keep it locked on.
  if (TV) setTimeout(function () { enter(true); }, 300);
}
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
// touch, hide the cursor and UI icons, and auto-cycle each answer's details
// every 10s. Only the Escape key eases everything back — a "Press Esc to exit"
// notice fades in and out at the bottom when it starts, so moving the mouse or
// pressing other keys doesn't kick you out.
// ---------------------------------------------------------------------------
const toggle = document.getElementById("screensaver-toggle");
if (toggle && dots) {
  const ZOOM = 1.3;        // subtle push-in
  const CYCLE_MS = 10000;  // one answer detail every 10s
  const FIRST_MS = 1200;   // first detail shortly after the zoom settles

  const hint = document.getElementById("screensaver-hint");

  let active = false;
  let cycleTimer = null;
  let firstTimer = null;

  function onKeyExit(e) { if (e.key === "Escape") exit(); }
  function armExit() { window.addEventListener("keydown", onKeyExit); }
  function disarmExit() { window.removeEventListener("keydown", onKeyExit); }

  function enter() {
    if (active) return;
    active = true;

    // Close the help panel if it happens to be open.
    const help = document.getElementById("help-panel");
    if (help) help.classList.remove("open");

    document.body.classList.add("screensaver"); // fades out the corner icons (CSS)
    document.body.style.cursor = "none";

    // Replay the "Press Esc to exit" fade-in/out.
    if (hint) {
      hint.classList.remove("show");
      void hint.offsetWidth;   // reflow so the animation restarts
      hint.classList.add("show");
    }

    dots.setZoom(ZOOM);
    dots.setAutoMode(true);
    if (garden) { garden.setZoom(ZOOM); garden.triggerBurst(); }

    firstTimer = setTimeout(function () { if (active) dots.autoSelectNext(); }, FIRST_MS);
    cycleTimer = setInterval(function () { if (active) dots.autoSelectNext(); }, CYCLE_MS);

    armExit();
  }

  function exit() {
    if (!active) return;
    active = false;
    disarmExit();
    clearTimeout(firstTimer);
    clearInterval(cycleTimer);
    cycleTimer = null;

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
}

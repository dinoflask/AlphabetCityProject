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
// every 10s. Any input (move / key / click / scroll) eases everything back.
// ---------------------------------------------------------------------------
const toggle = document.getElementById("screensaver-toggle");
if (toggle && dots) {
  const ZOOM = 1.3;        // subtle push-in
  const CYCLE_MS = 10000;  // one answer detail every 10s
  const FIRST_MS = 1200;   // first detail shortly after the zoom settles
  const ARM_MS = 400;      // ignore the launching interaction this long

  let active = false;
  let cycleTimer = null;
  let firstTimer = null;
  let armTimer = null;

  function armExit() {
    window.addEventListener("mousemove", onActivity, { once: true });
    window.addEventListener("mousedown", onActivity, { once: true });
    window.addEventListener("keydown", onActivity, { once: true });
    window.addEventListener("wheel", onActivity, { once: true });
    window.addEventListener("touchstart", onActivity, { once: true });
  }
  function disarmExit() {
    window.removeEventListener("mousemove", onActivity);
    window.removeEventListener("mousedown", onActivity);
    window.removeEventListener("keydown", onActivity);
    window.removeEventListener("wheel", onActivity);
    window.removeEventListener("touchstart", onActivity);
  }
  function onActivity() { exit(); }

  function enter() {
    if (active) return;
    active = true;

    // Close the help panel if it happens to be open.
    const help = document.getElementById("help-panel");
    if (help) help.classList.remove("open");

    document.body.classList.add("screensaver"); // fades out the corner icons (CSS)
    document.body.style.cursor = "none";

    dots.setZoom(ZOOM);
    dots.setAutoMode(true);
    if (garden) { garden.setZoom(ZOOM); garden.triggerBurst(); }

    firstTimer = setTimeout(function () { if (active) dots.autoSelectNext(); }, FIRST_MS);
    cycleTimer = setInterval(function () { if (active) dots.autoSelectNext(); }, CYCLE_MS);

    // Arm exit after the launching click is over so it doesn't self-cancel.
    armTimer = setTimeout(armExit, ARM_MS);
  }

  function exit() {
    if (!active) return;
    active = false;
    disarmExit();
    clearTimeout(firstTimer);
    clearTimeout(armTimer);
    clearInterval(cycleTimer);
    cycleTimer = null;

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

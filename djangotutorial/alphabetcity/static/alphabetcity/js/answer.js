// Answer page: live word count + an auto-growing red-line textarea.
//
// The box starts ONE line tall (red line + word count hug the top). Each new
// line grows it by one line-height (the red line translates down). It grows only
// up to MAX_LINES; past that it stops growing and becomes scrollable.
(function () {
  const ta = document.getElementById("answer-input");
  const count = document.getElementById("answer-count");
  if (!ta || !count) return;

  const send = document.querySelector(".answer__send");
  const MAX_LINES = 6;
  const MIN_WORDS = 10;   // must match AnswerForm.MIN_WORDS on the server

  function lineHeightPx() {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight);
    return isNaN(lh) ? parseFloat(cs.fontSize) * 1.45 : lh;
  }

  function resize() {
    const max = lineHeightPx() * MAX_LINES;
    ta.style.height = "auto";                 // shrink first so scrollHeight is true
    const needed = ta.scrollHeight;
    ta.style.height = Math.min(needed, max) + "px";
    ta.style.overflowY = needed > max ? "auto" : "hidden";
  }

  function update() {
    // Word count (JS): non-empty runs separated by whitespace.
    const trimmed = ta.value.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    count.textContent = words;
    resize();

    // Gate submission on the 15-word minimum (the server enforces it too).
    const short = words < MIN_WORDS;
    count.classList.toggle("is-short", short);
    if (send) send.disabled = short;
  }

  ta.addEventListener("input", update);
  // Font size is fluid (clamp), so re-fit on viewport resize too.
  window.addEventListener("resize", resize);
  update(); // initialize (handles any server-redisplayed text)
})();

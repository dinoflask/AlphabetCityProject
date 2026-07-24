// Code page: auto-submit once six characters are typed, and let the caption
// ("Enter Your Code") double as a submit button. If the server bounces us back
// with an error, jiggle the pill and let the usual message show underneath.
(function () {
  const form = document.querySelector(".code__form");
  const input = document.getElementById("code-input");
  const label = document.querySelector(".code__label");
  if (!form || !input) return;

  const fade = document.querySelector(".code__fade");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let submitted = false;
  function submit() {
    if (submitted) return;          // guard against double-fire
    submitted = true;
    // Fade to white, then navigate — a small crossfade into the Choose page.
    if (fade && !reduceMotion) {
      fade.classList.add("is-leaving");
      setTimeout(function () { form.submit(); }, 450);
    } else {
      form.submit();
    }
  }

  // Auto-enter the moment a full six-character code is present.
  input.addEventListener("input", function () {
    if (input.value.trim().length >= 6) submit();
  });

  // The caption is clickable: submit if there's something typed, else just focus.
  if (label) {
    label.addEventListener("click", function (e) {
      e.preventDefault();           // stop the default label->focus so we control it
      if (input.value.trim().length > 0) submit();
      else input.focus();
    });
  }

  // Wrong code -> server re-rendered with an error; shake the pill once.
  if (form.dataset.error === "1") {
    input.classList.remove("code__input--shake");
    void input.offsetWidth;         // reflow so the animation can replay
    input.classList.add("code__input--shake");
    input.focus();
  }

  // Returning here via the browser Back button restores the page from bfcache,
  // possibly still mid-leave (white). Clear it instantly so Back doesn't flash.
  window.addEventListener("pageshow", function () {
    submitted = false;
    if (fade) {
      fade.style.transition = "none";
      fade.classList.remove("is-leaving");
      void fade.offsetWidth;
      fade.style.transition = "";
    }
  });
})();

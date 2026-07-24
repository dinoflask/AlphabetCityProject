// Code page: let the caption ("Enter Your Code") double as a submit button. If
// the server bounces us back with an error, jiggle the pill and let the usual
// message show underneath.
(function () {
  const form = document.querySelector(".code__form");
  const input = document.getElementById("code-input");
  const label = document.querySelector(".code__label");
  if (!form || !input) return;

  // The caption is clickable: submit if there's something typed, else just focus.
  if (label) {
    label.addEventListener("click", function (e) {
      e.preventDefault();           // stop the default label->focus so we control it
      if (input.value.trim().length > 0) form.submit();
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
})();

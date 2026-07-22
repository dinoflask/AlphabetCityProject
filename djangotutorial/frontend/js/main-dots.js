// Sandbox entry: the answer-dots scene on its own page (index.html).
// Real answers come from the DB on the Django page; here we use a small dev mock
// just so the dots/hover-menu are visible while iterating in the sandbox.
import Sketch from "./app.js";

const mockAnswers = [
  { id: 1, q: 0, title: "When was a time you felt you couldn’t express yourself?", body: "When I was 9, my grandmother made me lots of tea." },
  { id: 2, q: 1, title: "Has learning about another person’s way of life ever changed the way you live?", body: "I'm currently at Wushiland Boba!" },
  { id: 3, q: 2, title: "What do you see in Alphabet City’s future?", body: "Take five!" },
];

new Sketch({ dom: document.getElementById("container"), answers: mockAnswers });

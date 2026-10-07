// Logo animado: partícula de luz que recorre la órbita y el "</>" que se
// escribe solo como "</creaciones>". Coordenadas en píxeles de img/logo-anim.png
// (1003×593); el SVG usa un viewBox más ancho para que entre el texto.
(function () {
  const root = document.querySelector(".logo-anim");
  if (!root) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const svg = root.querySelector("svg");

  // Órbita: elipse ajustada al anillo del logo.
  const O = { cx: 441, cy: 235.6, rx: 401, ry: 112, rot: (-17.62 * Math.PI) / 180 };
  const at = (u) => {
    const x = O.rx * Math.cos(u), y = O.ry * Math.sin(u);
    return { x: O.cx + x * Math.cos(O.rot) - y * Math.sin(O.rot), y: O.cy + x * Math.sin(O.rot) + y * Math.cos(O.rot), front: Math.sin(u) > 0 };
  };
  const trail = svg.querySelector(".la-trail");
  const N = 14, dots = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("fill", i === 0 ? "#fff" : "#f3b4fb");
    trail.append(c); dots.push(c);
  }
  const PERIOD = 5200, START = 900;
  function frame(t) {
    const p = Math.max(0, t - START) / PERIOD;
    const fade = Math.min(1, Math.max(0, (t - START) / 600));
    dots.forEach((c, i) => {
      const u = p * 2 * Math.PI - i * 0.045 + Math.PI;
      const q = at(u), k = 1 - i / N;
      const depth = q.front ? 1 : 0.35;
      c.setAttribute("cx", q.x.toFixed(1)); c.setAttribute("cy", q.y.toFixed(1));
      c.setAttribute("r", ((i === 0 ? 7 : 5.5 * k + 0.6) * (q.front ? 1 : 0.7)).toFixed(2));
      c.setAttribute("opacity", (fade * depth * (i === 0 ? 1 : 0.55 * k)).toFixed(3));
    });
    requestAnimationFrame(frame);
  }
  if (!reduce) requestAnimationFrame(frame);

  // "</>" que se escribe "</creaciones>" y vuelve.
  const open = svg.querySelector(".la-open"), word = svg.querySelector(".la-word"), close = svg.querySelector(".la-close"), caret = svg.querySelector(".la-caret");
  const WORD = "creaciones";
  let typed = 0;
  function layout() {
    word.textContent = WORD.slice(0, typed);
    const x0 = +open.getAttribute("x");
    const wOpen = open.getComputedTextLength();
    const wx = x0 + wOpen + 3;
    word.setAttribute("x", wx);
    const end = typed ? wx + word.getComputedTextLength() + 4 : x0 + wOpen;
    caret.setAttribute("x", end);
    close.setAttribute("x", end + (typed ? 3 : 2));
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function loop() {
    await wait(2200);
    for (;;) {
      caret.style.opacity = 1;
      while (typed < WORD.length) { typed++; layout(); await wait(95 + Math.random() * 70); }
      await wait(3200);
      while (typed > 0) { typed--; layout(); await wait(45); }
      await wait(5200);
    }
  }
  const start = () => { layout(); if (!reduce) loop(); };
  document.fonts && document.fonts.ready ? document.fonts.ready.then(start) : start();
})();

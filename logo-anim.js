// Logo animado: partícula de luz que recorre la órbita y el "</>" que se
// escribe solo como "</creaciones>". Coordenadas en píxeles de img/logo-anim.png
// (1003×502); el SVG usa un viewBox más ancho para que entre el texto.
(function () {
  const root = document.querySelector(".logo-anim");
  if (!root) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const svg = root.querySelector(".la-front");

  // Órbita: elipse ajustada al anillo del logo. La mitad de abajo pasa por
  // delante de las letras y la de arriba por detrás (como el anillo del logo):
  // cada punto de la estela se dibuja en la capa de adelante o en la de atrás
  // (esta queda debajo de la imagen, así las letras la tapan).
  const O = { cx: 441, cy: 235.6, rx: 401, ry: 112, rot: (-17.62 * Math.PI) / 180 };
  const at = (u) => {
    const x = O.rx * Math.cos(u), y = O.ry * Math.sin(u);
    return { x: O.cx + x * Math.cos(O.rot) - y * Math.sin(O.rot), y: O.cy + x * Math.sin(O.rot) + y * Math.cos(O.rot), front: Math.sin(u) > 0 };
  };
  const layers = [root.querySelector(".la-back .la-trail"), svg.querySelector(".la-trail")];
  const N = 26, STEP = 0.024;
  const make = (layer) => {
    const g = [];
    for (let i = 0; i < N; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("fill", i === 0 ? "#fff" : "#f6c4fc");
      layer.append(c); g.push(c);
    }
    const halo = document.createElementNS(NS, "circle");
    halo.setAttribute("fill", "#e9a4fa"); halo.setAttribute("r", "18");
    layer.prepend(halo);
    return { dots: g, halo };
  };
  const sets = layers.map(make);
  const PERIOD = 5600, START = 900;
  function frame(t) {
    const p = Math.max(0, t - START) / PERIOD;
    const fade = Math.min(1, Math.max(0, (t - START) / 600));
    for (let i = 0; i < N; i++) {
      const q = at(p * 2 * Math.PI - i * STEP + Math.PI), k = 1 - i / N;
      const on = q.front ? 1 : 0;
      const r = (i === 0 ? 6.5 : 5.2 * k + 0.5).toFixed(2), o = (fade * (i === 0 ? 1 : 0.5 * k * k)).toFixed(3);
      sets.forEach((set, layer) => {
        const c = set.dots[i], show = layer === on;
        c.setAttribute("cx", q.x.toFixed(1)); c.setAttribute("cy", q.y.toFixed(1));
        c.setAttribute("r", r); c.setAttribute("opacity", show ? o : 0);
        if (i === 0) { set.halo.setAttribute("cx", q.x.toFixed(1)); set.halo.setAttribute("cy", q.y.toFixed(1)); set.halo.setAttribute("opacity", show ? (fade * 0.22).toFixed(3) : 0); }
      });
    }
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

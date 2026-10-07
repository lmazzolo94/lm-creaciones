// Comunes a las demos: barra superior "negocio ficticio", formato de precios
// y el visor de la planilla con la que el dueño maneja los datos.
const pesos = (n) => "$ " + Math.round(n).toLocaleString("es-AR");

function demoBar() {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.innerHTML =
    '<span><b>Demo de LM Creaciones</b><span class="db-extra"> · negocio ficticio, nada de esto es real</span></span>' +
    '<a href="../../#demos">← Volver al portafolio</a>';
  document.body.prepend(bar);
}

// Muestra los datos como los vería el dueño en su planilla de Google.
function sheetViewer({ title, columns, rows, note }) {
  const btn = document.createElement("button");
  btn.className = "sheet-fab";
  btn.type = "button";
  btn.innerHTML = "📊 ¿Cómo lo maneja el dueño?";
  document.body.append(btn);

  const modal = document.createElement("div");
  modal.className = "sheet-modal";
  modal.hidden = true;
  const head = columns.map((c) => `<th>${c}</th>`).join("");
  const body = rows
    .map((r, i) => `<tr><td class="rn">${i + 2}</td>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`)
    .join("");
  const letters = columns.map((_, i) => `<th class="cl">${String.fromCharCode(65 + i)}</th>`).join("");
  modal.innerHTML = `
    <div class="sheet-card" role="dialog" aria-label="Planilla del negocio">
      <div class="sheet-head">
        <div><b>📗 ${title}</b><small>Planilla de Google del negocio</small></div>
        <button type="button" class="sheet-close" aria-label="Cerrar">✕</button>
      </div>
      <p class="sheet-note">${note}</p>
      <div class="sheet-scroll">
        <table class="sheet">
          <thead><tr><th class="cl"></th>${letters}</tr><tr><td class="rn">1</td>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>`;
  document.body.append(modal);
  btn.onclick = () => (modal.hidden = false);
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest(".sheet-close")) modal.hidden = true;
  };
}

demoBar();

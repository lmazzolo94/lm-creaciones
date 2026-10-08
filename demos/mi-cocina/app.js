import { calcularReceta, totalGastos, unidadesPara, costoBase, BASE, FACTOR, UNIDADES } from './calc.js';
import { parsearLista, buscarIngrediente, normalizar } from './parsear.js';

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plata = (v, dec = false) => (dec ? fmt2 : fmt0).format(Number(v) || 0);
const numero = (v) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(v) || 0);
const pct = (v) => `${Math.round(Number(v) || 0)}%`;
const fechaISO = (d = new Date()) => new Intl.DateTimeFormat('en-CA').format(d);
const vacioONum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function hace(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}
const diasDesde = (iso) => (iso ? (Date.now() - new Date(iso)) / 86400000 : 999);
const horaEntrega = (s) => {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  const mismoDia = fechaISO(d) === fechaISO();
  return (mismoDia ? 'hoy ' : d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ') +
    d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};

function aviso(msg, error = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.className = 'ver' + (error ? ' error' : '');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (el.className = ''), error ? 4000 : 2200);
}

async function api(ruta, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + ruta, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/login') { mostrarLogin(); throw new Error('Sesión vencida'); }
  if (!res.ok) throw new Error(data.error || 'Algo salió mal');
  return data;
}

function leerForm(form) {
  const o = Object.fromEntries(new FormData(form));
  for (const cb of $$('input[type=checkbox][name]', form)) o[cb.name] = cb.checked;
  return o;
}

const dlg = $('#modal');
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
function modal(html, alAbrir) {
  dlg.innerHTML = html;
  dlg.showModal();
  alAbrir?.(dlg);
  $('[autofocus]', dlg)?.focus();
  return dlg;
}
function confirmar(texto, boton = 'Sí, borrar') {
  return new Promise((ok) => {
    modal(`<div class="cuerpo"><p>${esc(texto)}</p><div class="pie"><button value="no">Cancelar</button><button class="primario" value="si">${esc(boton)}</button></div></div>`, (d) => {
      $$('button', d).forEach((b) => b.addEventListener('click', () => { d.close(); ok(b.value === 'si'); }));
      d.addEventListener('close', () => ok(false), { once: true });
    });
  });
}

// ---------- Estado ----------
const E = { datos: null, ingMap: new Map(), alEvento: null, ruta: 0, eventos: null };

async function cargarDatos() {
  E.datos = await api('/datos');
  E.ingMap = new Map(E.datos.ingredientes.map((i) => [i.id, i]));
  $('#nombre-negocio').textContent = E.datos.cfg.negocio;
  document.title = `${E.datos.cfg.negocio} · Costos y pedidos`;
}
const gastosMes = () => totalGastos(E.datos.gastos);
const calc = (r) => calcularReceta(r, E.ingMap, E.datos.cfg, gastosMes());
const categorias = (lista) => [...new Set(lista.map((x) => x.categoria).filter(Boolean))].sort();

function conectarEventos() {
  if (E.eventos) return;
  E.eventos = new EventSource('/api/eventos');
  E.eventos.onmessage = (e) => { try { E.alEvento?.(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}

// ---------- Rutas ----------
function resolver() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  const tabla = {
    '': [inicio, 'inicio'], pedidos: [pedidos, 'pedidos'], pedido: [pedidoForm, 'pedidos'],
    recetas: [recetas, 'recetas'], receta: [recetaForm, 'recetas'], ingredientes: [ingredientes, 'ingredientes'],
    compras: [compras, 'compras'], recetario: [recetario, 'recetario'], ganancias: [ganancias, 'ganancias'], cocina: [cocina, 'cocina'],
    ajustes: [ajustes, 'ajustes'], mas: [mas, 'mas'],
  };
  const [vista, nav] = tabla[p[0]] || tabla[''];
  return { vista, nav, param: p[1] };
}

async function navegar() {
  if (!E.datos) return;
  const id = ++E.ruta;
  E.alEvento = null;
  document.body.classList.remove('modo-cocina');
  if (E.wakeLock) { E.wakeLock.release().catch(() => {}); E.wakeLock = null; }
  const { vista, nav, param } = resolver();
  const enMas = ['ingredientes', 'ganancias', 'cocina', 'ajustes', 'recetario'].includes(nav);
  $$('#nav a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === nav || (enMas && a.dataset.ruta === 'mas')));
  const el = $('#vista');
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  window.scrollTo(0, 0);
  try {
    await vista(el, param, () => id === E.ruta);
  } catch (err) {
    if (id === E.ruta) el.innerHTML = `<div class="tarjeta"><p>No se pudo cargar: ${esc(err.message)}</p><button onclick="location.reload()">Reintentar</button></div>`;
  }
}
window.addEventListener('hashchange', navegar);

// ---------- Login ----------
function mostrarLogin() {
  E.datos = null;
  E.eventos?.close();
  E.eventos = null;
  $('#nav').hidden = true;
  document.body.classList.remove('modo-cocina');
  $('#vista').innerHTML = `
    <div class="login">
      <img src="/icon.svg" alt="">
      <h1>Bienvenida/o</h1>
      <p class="suave">Ingresá la contraseña del negocio</p>
      <form class="tarjeta" id="f-login">
        <div class="campo"><label for="pw">Contraseña</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></div>
        <button class="primario" style="width:100%">Entrar</button>
      </form>
    </div>`;
  $('#f-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', body: leerForm(e.target) });
      await iniciar();
    } catch (err) { aviso(err.message, true); }
  });
  $('#pw').focus();
}

async function iniciar() {
  try { await cargarDatos(); } catch { return; }
  $('#nav').hidden = false;
  conectarEventos();
  navegar();
}

// =====================================================================
// INICIO
// =====================================================================
async function inicio(el, _, vigente) {
  const hoy = fechaISO();
  const [res, activos] = await Promise.all([api(`/resumen?desde=${hoy}&hasta=${hoy}`), api('/pedidos?vista=activos')]);
  if (!vigente()) return;
  const { ingredientes, recetas, cfg } = E.datos;
  const viejos = ingredientes.filter((i) => i.precio > 0 && diasDesde(i.actualizado) > 30);
  const sinPrecio = ingredientes.filter((i) => !(i.precio > 0));
  const calculadas = recetas.filter((r) => r.activa).map((r) => ({ r, c: calc(r) }));
  const perdida = calculadas.filter(({ c }) => c.ganancia < 0);

  const pasos = [];
  if (!ingredientes.length) pasos.push(['1', 'Cargá tus ingredientes con lo que pagás (ej: harina, 1 kg, $1.200).', '#/ingredientes', 'Cargar ingredientes']);
  if (!recetas.length) pasos.push(['2', 'Armá tus recetas: qué lleva y cuántas porciones rinde. La app calcula el costo y el precio.', '#/receta/nueva', 'Crear receta']);
  if (!E.datos.gastos.length && cfg.valor_hora === 0) pasos.push(['3', 'Opcional: sumá gastos fijos (gas, luz) y cuánto vale tu hora de trabajo.', '#/ajustes', 'Ir a ajustes']);

  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Hola 👋</h1><p class="suave">${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div class="acciones"><a class="boton primario" href="#/pedido/nuevo">＋ Nuevo pedido</a><a class="boton" href="#/cocina">👩‍🍳 Cocina</a></div>
    </div>
    ${pasos.length ? `<div class="tarjeta"><h3>Para empezar</h3><ul class="lista">${pasos.map(([n, t, h, b]) => `
      <li><span class="etiqueta naranja">${n}</span><span class="crece">${t}</span><a class="boton chico" href="${h}">${b}</a></li>`).join('')}</ul></div>` : ''}
    <h2>Hoy</h2>
    <div class="kpis">
      <div class="kpi"><b>${res.pedidos}</b><span>pedidos</span></div>
      <div class="kpi"><b>${plata(res.ventas)}</b><span>vendido</span></div>
      <div class="kpi ${res.ganancia >= 0 ? 'verde' : 'rojo'}"><b>${plata(res.ganancia)}</b><span>ganancia</span></div>
      <div class="kpi"><b>${plata(res.a_cobrar)}</b><span>falta cobrar</span></div>
    </div>
    ${perdida.length ? `<div class="alerta">⚠️ ${perdida.length === 1 ? 'Esta receta te deja' : 'Estas recetas te dejan'} <b>pérdida</b> con el precio actual: ${perdida.map(({ r }) => `<a href="#/receta/${r.id}">${esc(r.nombre)}</a>`).join(', ')}</div>` : ''}
    ${sinPrecio.length ? `<div class="alerta">💲 Falta cargar el precio de ${sinPrecio.length} ingrediente${sinPrecio.length > 1 ? 's' : ''}: ${sinPrecio.slice(0, 5).map((i) => esc(i.nombre)).join(', ')}${sinPrecio.length > 5 ? '…' : ''}. <a href="#/ingredientes">Cargar precios</a></div>` : ''}
    ${viejos.length ? `<div class="alerta">🕒 ${viejos.length} ingrediente${viejos.length > 1 ? 's tienen' : ' tiene'} el precio sin actualizar hace más de 30 días. <a href="#/ingredientes">Revisar precios</a></div>` : ''}
    <h2>Pedidos en curso (${activos.length})</h2>
    ${activos.length ? `<div class="grilla">${activos.slice(0, 6).map(tarjetaPedido).join('')}</div>
      ${activos.length > 6 ? '<p><a href="#/pedidos">Ver todos</a></p>' : ''}` : '<div class="tarjeta vacio"><span class="grande">🍽️</span>No hay pedidos en curso</div>'}
  `;
  activarTarjetasPedido(el, () => inicio(el, _, vigente));
  E.alEvento = (ev) => { if (ev.tipo === 'pedido') inicio(el, _, vigente); };
}

// =====================================================================
// INGREDIENTES
// =====================================================================
function precioReferencia(ing) {
  const cb = costoBase(ing);
  const b = BASE[ing.unidad];
  if (b === 'g') return `${plata(cb * 1000)}/kg`;
  if (b === 'ml') return `${plata(cb * 1000)}/l`;
  return `${plata(cb, cb < 100)}/u`;
}

function editarIngrediente(ing, alGuardar) {
  const nuevo = !ing?.id;
  ing = { nombre: '', categoria: '', unidad: 'kg', cantidad: 1, precio: '', merma: 0, ...ing };
  modal(`
    <form method="dialog" id="f-ing">
      <h2 style="margin-top:0">${nuevo ? 'Nuevo ingrediente' : 'Editar ingrediente'}</h2>
      <div class="campo"><label>Nombre</label><input name="nombre" value="${esc(ing.nombre)}" required autofocus placeholder="Ej: Harina 000"></div>
      <div class="campo"><label>Categoría <small>(opcional)</small></label><input name="categoria" value="${esc(ing.categoria)}" list="cats-ing" placeholder="Ej: Almacén, Verdulería, Envases">
        <datalist id="cats-ing">${categorias(E.datos.ingredientes).map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <label>¿Cómo lo comprás?</label>
      <div class="fila">
        <div class="campo"><input name="cantidad" type="number" step="any" min="0" value="${esc(ing.cantidad)}" required aria-label="Cantidad"></div>
        <div class="campo"><select name="unidad" aria-label="Unidad">${UNIDADES.map((u) => `<option ${u === ing.unidad ? 'selected' : ''} value="${u}">${nombreUnidad(u)}</option>`).join('')}</select></div>
        <div class="campo"><input name="precio" type="number" step="any" min="0" value="${esc(ing.precio)}" required placeholder="$ Precio" aria-label="Precio que pagás"></div>
      </div>
      <p class="ayuda" style="margin-top:-6px">Ej: 1 kg a $1.200 · 12 unidades a $3.000 · 900 ml a $2.500</p>
      <div class="campo"><label>Merma % <small>(opcional)</small></label><input name="merma" type="number" step="any" min="0" max="95" value="${esc(ing.merma)}">
        <p class="ayuda">Lo que se pierde al pelar, limpiar o cocinar. Ej: papa ≈ 15%. Sube el costo real.</p></div>
      <p class="suave" id="ing-ref"></p>
      <div class="pie">
        ${nuevo ? '' : '<button type="button" class="peligro izq" id="b-borrar">Borrar</button>'}
        <button type="button" value="cancel" onclick="this.closest('dialog').close()">Cancelar</button>
        <button class="primario">Guardar</button>
      </div>
    </form>`, (d) => {
    const f = $('#f-ing', d);
    const ref = () => { const o = leerForm(f); $('#ing-ref', d).textContent = Number(o.precio) > 0 ? `Costo real: ${precioReferencia(o)}` : ''; };
    f.addEventListener('input', ref);
    ref();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const o = leerForm(f);
        const guardado = await api(nuevo ? '/ingredientes' : `/ingredientes/${ing.id}`, { method: nuevo ? 'POST' : 'PUT', body: o });
        d.close();
        await cargarDatos();
        aviso('Ingrediente guardado');
        alGuardar?.(guardado);
      } catch (err) { aviso(err.message, true); }
    });
    $('#b-borrar', d)?.addEventListener('click', async () => {
      if (!(await confirmar(`¿Borrar "${ing.nombre}"?`))) return;
      try { await api(`/ingredientes/${ing.id}`, { method: 'DELETE' }); await cargarDatos(); aviso('Borrado'); alGuardar?.(null); }
      catch (err) { aviso(err.message, true); }
    });
  });
}
const nombreUnidad = (u) => ({ kg: 'kg', g: 'gramos', l: 'litros', ml: 'ml', u: 'unidades' })[u] || u;

async function ingredientes(el) {
  let filtro = '';
  const pintar = () => {
    const lista = E.datos.ingredientes.filter((i) => (i.nombre + ' ' + i.categoria).toLowerCase().includes(filtro));
    $('#tabla-ing', el).innerHTML = lista.length ? `
      <div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Ingrediente</th><th>Lo compro</th><th class="der">Costo real</th><th class="der">Precio</th></tr></thead>
        <tbody>${lista.map((i) => {
          const dias = diasDesde(i.actualizado);
          return `<tr class="clic" data-id="${i.id}">
            <td><b>${esc(i.nombre)}</b>${i.categoria ? `<br><small>${esc(i.categoria)}</small>` : ''}</td>
            <td class="num">${numero(i.cantidad)} ${i.unidad} a ${plata(i.precio)}${i.merma ? ` <small>(merma ${numero(i.merma)}%)</small>` : ''}</td>
            <td class="der num">${precioReferencia(i)}</td>
            <td class="der">${i.precio > 0 ? `<span class="etiqueta ${dias > 30 ? 'amarillo' : 'verde'}" title="Última actualización">${dias > 30 ? '🕒 ' : ''}${hace(i.actualizado)}</span>` : '<span class="etiqueta rojo">falta precio</span>'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` :
      `<div class="vacio"><span class="grande">🥕</span>${filtro ? 'Nada coincide con la búsqueda' : 'Todavía no cargaste ingredientes.<br>Incluí también envases, bolsas y etiquetas.'}</div>`;
  };
  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Ingredientes</h1><p class="suave">Lo que comprás y cuánto pagás. Tocá uno para actualizar el precio.</p></div>
      <button class="primario" id="b-nuevo">＋ Ingrediente</button>
    </div>
    <input class="buscar" type="search" placeholder="🔍 Buscar…" id="q" style="margin-bottom:12px">
    <div class="tarjeta" id="tabla-ing"></div>`;
  pintar();
  $('#q', el).addEventListener('input', (e) => { filtro = e.target.value.toLowerCase(); pintar(); });
  $('#b-nuevo', el).addEventListener('click', () => editarIngrediente(null, pintar));
  $('#tabla-ing', el).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) editarIngrediente(E.ingMap.get(Number(tr.dataset.id)), pintar);
  });
}

// =====================================================================
// RECETAS
// =====================================================================
async function recetas(el) {
  const { recetas } = E.datos;
  const filas = recetas.map((r) => ({ r, c: calc(r) }));
  const grupo = (lista) => lista.map(({ r, c }) => `
    <a class="tarjeta" href="#/receta/${r.id}" style="text-decoration:none;color:inherit;display:block;${r.activa ? '' : 'opacity:.55'}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <h3>${esc(r.nombre)}</h3>
        <span class="etiqueta ${c.ganancia < 0 ? 'rojo' : c.margenReal < 30 ? 'amarillo' : 'verde'}">${c.ganancia < 0 ? 'pérdida' : '+' + pct(c.margenReal)}</span>
      </div>
      <div class="desglose num">
        <span class="suave">Costo por porción</span><span>${plata(c.porPorcion)}</span>
        <span class="suave">Precio de venta</span><b>${plata(c.precio)}</b>
        <span class="suave">Ganás por porción</span><b style="color:${c.ganancia < 0 ? 'var(--rojo)' : 'var(--verde)'}">${plata(c.ganancia)}</b>
      </div>
      ${r.activa ? '' : '<small>No está a la venta</small>'}
    </a>`).join('');
  const cats = [...new Set(filas.map(({ r }) => r.categoria || ''))].sort();
  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Recetas</h1><p class="suave">Costo y precio de cada producto, con los precios de hoy.</p></div>
      <div class="acciones"><a class="boton" href="#/recetario">📖 Buscar en recetario</a><a class="boton primario" href="#/receta/nueva">＋ Receta</a></div>
    </div>
    ${filas.length ? cats.map((cat) => `
      ${cats.length > 1 ? `<h2>${esc(cat || 'Sin categoría')}</h2>` : ''}
      <div class="grilla">${grupo(filas.filter(({ r }) => (r.categoria || '') === cat))}</div>`).join('') :
      `<div class="tarjeta vacio"><span class="grande">🍲</span>Todavía no hay recetas.<br>${E.datos.ingredientes.length ? '' : 'Te conviene cargar primero algunos ingredientes.'}</div>`}`;
}

async function recetaForm(el, param) {
  const existente = param && param !== 'nueva' ? E.datos.recetas.find((r) => r.id === Number(param)) : null;
  if (param && param !== 'nueva' && !existente) { el.innerHTML = '<p>Esa receta no existe.</p><a href="#/recetas">Volver</a>'; return; }
  const r = existente
    ? structuredClone(existente)
    : { nombre: '', categoria: '', porciones: 1, minutos: 0, margen: null, precio: null, activa: 1, notas: '', items: [] };
  if (!r.items.length) r.items.push({ ingrediente_id: '', cantidad: '', unidad: 'g' });
  const { cfg } = E.datos;

  el.innerHTML = `
    <div class="cabecera">
      <div><a href="#/recetas">← Recetas</a><h1>${existente ? esc(r.nombre) : 'Nueva receta'}</h1></div>
    </div>
    <form id="f-rec" class="dos-col">
      <div>
        <div class="tarjeta">
          <div class="campo"><label>Nombre</label><input name="nombre" value="${esc(r.nombre)}" required placeholder="Ej: Tarta de jamón y queso" ${existente ? '' : 'autofocus'}></div>
          <div class="fila">
            <div class="campo"><label>Categoría</label><input name="categoria" value="${esc(r.categoria)}" list="cats-rec" placeholder="Ej: Tartas">
              <datalist id="cats-rec">${categorias(E.datos.recetas).map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
            <div class="campo"><label>Rinde (porciones)</label><input name="porciones" type="number" min="0.01" step="any" value="${esc(r.porciones)}" required></div>
            <div class="campo"><label>Minutos de trabajo</label><input name="minutos" type="number" min="0" step="any" value="${esc(r.minutos)}"></div>
          </div>
          <p class="ayuda" style="margin-top:-6px">Cargá la receta entera (ej: una tarta que rinde 8 porciones) y vendé por porción. Si vendés la tarta entera, poné "1".</p>
        </div>
        <div class="tarjeta">
          <h3>Ingredientes y envases</h3>
          <div id="items"></div>
          <div class="acciones" style="margin-top:6px">
            <button type="button" id="b-add" class="chico">＋ Agregar</button>
            <button type="button" id="b-crear-ing" class="chico">🥕 Crear ingrediente nuevo</button>
          </div>
        </div>
        <div class="tarjeta">
          <div class="campo"><label>Notas / preparación <small>(opcional)</small></label><textarea name="notas">${esc(r.notas)}</textarea></div>
          <label style="display:flex;gap:8px;align-items:center;color:var(--texto)"><input type="checkbox" name="activa" ${r.activa ? 'checked' : ''}> A la venta (aparece al tomar pedidos)</label>
        </div>
      </div>
      <div class="pegajoso">
        <div class="tarjeta">
          <div id="faltan"></div>
          <h3>Costo por porción</h3>
          <div class="desglose num" id="desglose"></div>
          <h3 style="margin-top:18px">Precio</h3>
          <div class="fila">
            <div class="campo"><label>Ganancia sobre el costo %</label><input name="margen" type="number" step="any" min="0" value="${r.margen ?? ''}" placeholder="${cfg.margen} (general)">
              <p class="ayuda">100% = vendés al doble de lo que te cuesta</p></div>
            <div class="campo"><label>Precio fijo <small>(opcional)</small></label><input name="precio" type="number" step="any" min="0" value="${r.precio ?? ''}" placeholder="Usar sugerido"></div>
          </div>
          <div id="resultado"></div>
        </div>
        <div class="acciones" style="margin-top:12px">
          <button class="primario">Guardar receta</button>
          ${existente ? '<button type="button" id="b-dup">Duplicar</button><button type="button" class="peligro" id="b-del">Borrar</button>' : ''}
        </div>
      </div>
    </form>`;

  const f = $('#f-rec', el);
  const itemsEl = $('#items', el);
  const opcionesIng = (sel) => `<option value="">— Elegí —</option>` + categorias(E.datos.ingredientes).concat(['']).map((cat) => {
    const ings = E.datos.ingredientes.filter((i) => (i.categoria || '') === cat);
    if (!ings.length) return '';
    const ops = ings.map((i) => `<option value="${i.id}" ${Number(sel) === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('');
    return cat ? `<optgroup label="${esc(cat)}">${ops}</optgroup>` : ops;
  }).join('');

  const pintarItems = () => {
    itemsEl.innerHTML = r.items.map((it, n) => {
      const ing = E.ingMap.get(Number(it.ingrediente_id));
      const unidades = ing ? unidadesPara(ing.unidad) : UNIDADES;
      return `<div class="item-receta" data-n="${n}">
        <select data-k="ingrediente_id" aria-label="Ingrediente">${opcionesIng(it.ingrediente_id)}</select>
        <input data-k="cantidad" type="number" step="any" min="0" value="${esc(it.cantidad)}" placeholder="Cant." aria-label="Cantidad">
        <select data-k="unidad" aria-label="Unidad">${unidades.map((u) => `<option ${u === it.unidad ? 'selected' : ''}>${u}</option>`).join('')}</select>
        <span class="costo num" data-costo></span>
        <button type="button" class="icono" data-quitar title="Quitar" aria-label="Quitar">✕</button>
      </div>`;
    }).join('') || '<p class="suave">Sin ingredientes.</p>';
    recalcular();
  };

  const leer = () => {
    const o = leerForm(f);
    return { ...r, nombre: o.nombre, categoria: o.categoria, porciones: Number(o.porciones) || 1, minutos: Number(o.minutos) || 0,
      margen: vacioONum(o.margen), precio: vacioONum(o.precio), activa: o.activa ? 1 : 0, notas: o.notas };
  };

  const recalcular = () => {
    const c = calc(leer());
    $$('.item-receta', itemsEl).forEach((row, n) => {
      const it = c.items[n];
      $('[data-costo]', row).textContent = it && it.ingrediente_id && Number(it.cantidad) ? plata(it.costo, it.costo < 100) : '';
    });
    const sinPrecio = [...new Set(r.items.map((it) => E.ingMap.get(Number(it.ingrediente_id))).filter((i) => i && !(i.precio > 0)))];
    $('#faltan', el).innerHTML = sinPrecio.length ? `<div class="alerta">💲 Falta el precio de: ${sinPrecio.map((i) => `<button type="button" class="chico" data-precio="${i.id}" style="margin:2px">${esc(i.nombre)}</button>`).join('')}<br><small>Tocá cada uno para cargarlo. Mientras tanto el costo sale más bajo de lo real.</small></div>` : '';
    $('#desglose', el).innerHTML = `
      <span class="suave">Ingredientes (receta entera)</span><span>${plata(c.ingredientes)}</span>
      ${c.manoObra ? `<span class="suave">Tu trabajo (${numero(leer().minutos)} min)</span><span>${plata(c.manoObra)}</span>` : ''}
      <span class="suave">÷ ${numero(c.porciones)} porciones</span><span>${plata(c.lote / c.porciones)}</span>
      ${c.fijos ? `<span class="suave">Gastos fijos por porción</span><span>${plata(c.fijos, c.fijos < 100)}</span>` : ''}
      <span class="total">Costo por porción</span><span class="total">${plata(c.porPorcion)}</span>`;
    const partes = c.precio > 0 ? [
      ['var(--rojo)', Math.min(c.porPorcion, c.precio) / c.precio],
      ['var(--amarillo)', c.comision / c.precio],
      ['var(--verde)', Math.max(c.ganancia, 0) / c.precio],
    ] : [];
    $('#resultado', el).innerHTML = `
      <p class="suave" style="margin:4px 0 0">${c.manual ? `Precio fijo (el sugerido sería ${plata(c.sugerido)})` : 'Precio sugerido'}</p>
      <div class="precio-grande">${plata(c.precio)}</div>
      <div class="barra" style="margin:8px 0" title="Costo / comisión / ganancia">${partes.map(([col, v]) => `<i style="background:${col};width:${(v * 100).toFixed(1)}%"></i>`).join('')}</div>
      <div class="desglose num">
        <span class="suave">🟥 Costo</span><span>${plata(c.porPorcion)}</span>
        ${c.comision ? `<span class="suave">🟨 Comisión (${numero(cfg.comision)}%)</span><span>${plata(c.comision)}</span>` : ''}
        <span class="suave">🟩 Ganancia por porción</span><b style="color:${c.ganancia < 0 ? 'var(--rojo)' : 'var(--verde)'}">${plata(c.ganancia)} (${pct(c.margenReal)})</b>
        ${c.porciones > 1 ? `<span class="suave">Receta entera (${numero(c.porciones)} porc.)</span><span>${plata(c.precio * c.porciones)}</span>` : ''}
      </div>
      ${c.ganancia < 0 ? '<div class="alerta" style="margin:10px 0 0">Con este precio perdés plata en cada venta.</div>' : ''}`;
  };

  itemsEl.addEventListener('change', (e) => {
    const row = e.target.closest('.item-receta');
    if (!row) return;
    const it = r.items[row.dataset.n];
    it[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.k === 'ingrediente_id') {
      const ing = E.ingMap.get(Number(e.target.value));
      if (ing) it.unidad = { kg: 'g', l: 'ml' }[ing.unidad] || ing.unidad;
      pintarItems();
      $(`.item-receta[data-n="${row.dataset.n}"] [data-k=cantidad]`, itemsEl)?.focus();
    } else recalcular();
  });
  itemsEl.addEventListener('input', (e) => {
    const row = e.target.closest('.item-receta');
    if (row && e.target.dataset.k === 'cantidad') { r.items[row.dataset.n].cantidad = e.target.value; recalcular(); }
  });
  itemsEl.addEventListener('click', (e) => {
    const row = e.target.closest('[data-quitar]')?.closest('.item-receta');
    if (row) { r.items.splice(Number(row.dataset.n), 1); pintarItems(); }
  });
  f.addEventListener('input', (e) => { if (!e.target.closest('#items')) recalcular(); });
  $('#faltan', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-precio]');
    if (b) editarIngrediente(E.ingMap.get(Number(b.dataset.precio)), pintarItems);
  });
  $('#b-add', el).addEventListener('click', () => {
    r.items.push({ ingrediente_id: '', cantidad: '', unidad: 'g' });
    pintarItems();
    $$('.item-receta select', itemsEl).at(-2)?.focus();
  });
  $('#b-crear-ing', el).addEventListener('click', () => editarIngrediente(null, (ing) => {
    if (!ing) return;
    const vacio = r.items.find((it) => !it.ingrediente_id);
    const unidad = { kg: 'g', l: 'ml' }[ing.unidad] || ing.unidad;
    if (vacio) Object.assign(vacio, { ingrediente_id: ing.id, unidad });
    else r.items.push({ ingrediente_id: ing.id, cantidad: '', unidad });
    pintarItems();
  }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = leer();
    datos.items = r.items.filter((it) => it.ingrediente_id && Number(it.cantidad) > 0);
    try {
      const g = await api(existente ? `/recetas/${existente.id}` : '/recetas', { method: existente ? 'PUT' : 'POST', body: datos });
      await cargarDatos();
      aviso('Receta guardada');
      if (!existente) location.hash = `#/receta/${g.id}`; else navegar();
    } catch (err) { aviso(err.message, true); }
  });
  $('#b-del', el)?.addEventListener('click', async () => {
    if (!(await confirmar(`¿Borrar la receta "${existente.nombre}"? Los pedidos viejos no se modifican.`))) return;
    await api(`/recetas/${existente.id}`, { method: 'DELETE' });
    await cargarDatos();
    aviso('Receta borrada');
    location.hash = '#/recetas';
  });
  $('#b-dup', el)?.addEventListener('click', async () => {
    const copia = { ...leer(), nombre: leer().nombre + ' (copia)', items: r.items.filter((it) => it.ingrediente_id) };
    const g = await api('/recetas', { method: 'POST', body: copia });
    await cargarDatos();
    aviso('Receta duplicada');
    location.hash = `#/receta/${g.id}`;
  });
  pintarItems();
}

// =====================================================================
// PEDIDOS
// =====================================================================
const ESTADOS = {
  nuevo: ['Nuevo', 'rojo'], preparando: ['Preparando', 'amarillo'], listo: ['Listo', 'verde'],
  entregado: ['Entregado', ''], cancelado: ['Cancelado', ''],
};
const SIGUIENTE = { nuevo: ['preparando', 'Empezar ▶'], preparando: ['listo', 'Listo ✓'], listo: ['entregado', 'Entregado 📦'] };
const ANTERIOR = { preparando: 'nuevo', listo: 'preparando', entregado: 'listo' };
const MEDIOS = ['Efectivo', 'Transferencia'];
const enCamino = (p) => p.estado === 'entregado' && p.tipo === 'envio';
const estadoDe = (p) => (enCamino(p) ? ['En camino', 'azul'] : ESTADOS[p.estado]);
// El último paso de un pedido con envío es "En camino" en vez de "Entregado"
const siguiente = (p) => (p.estado === 'listo' && p.tipo === 'envio' ? ['entregado', 'En camino 🛵'] : SIGUIENTE[p.estado]);

function tarjetaPedido(p) {
  const [nom, col] = estadoDe(p);
  const sig = siguiente(p);
  return `<div class="tarjeta pedido e-${p.estado}" data-id="${p.id}">
    <div class="top">
      <span class="nro">#${p.numero} ${esc(p.cliente) || '<span class="suave">Sin nombre</span>'}</span>
      <span class="etiqueta ${col}">${nom}</span>
    </div>
    <small>${p.tipo === 'envio' ? '🛵 Envío' : '🏃 Retira'}${p.entrega ? ` · para ${horaEntrega(p.entrega)}` : ''} · ${hace(p.creado)}</small>
    ${p.tipo === 'envio' && p.direccion ? `<br><small>📍 ${esc(p.direccion)}</small>` : ''}
    <ul>${p.items.map((i) => `<li><b>${numero(i.cantidad)}×</b> ${esc(i.nombre)}${i.nota ? ` <span class="nota">(${esc(i.nota)})</span>` : ''}</li>`).join('')}</ul>
    ${p.notas ? `<p class="nota" style="margin:0 0 8px">📝 ${esc(p.notas)}</p>` : ''}
    <div class="top">
      <b class="num">${plata(p.total)}</b>
      <button class="chico etiqueta ${p.pagado ? 'verde' : 'amarillo'}" data-acc="pagado" style="border:0" title="${p.pagado ? 'Marcar como no cobrado' : 'Confirmar que pagó'}">${p.pagado ? '✓ Pagado' : '💲 Sin cobrar'} · ${esc(p.medio_pago)}</button>
    </div>
    <div class="acciones" style="margin-top:10px">
      ${sig ? `<button class="chico primario" data-acc="avanzar">${sig[1]}</button>` : ''}
      <a class="boton chico" href="#/pedido/${p.id}">Editar</a>
      ${p.telefono ? '<button class="chico" data-acc="wa" title="Mandar por WhatsApp">WhatsApp</button>' : ''}
    </div>
  </div>`;
}

function activarTarjetasPedido(cont, refrescar, lista) {
  cont.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]');
    const card = e.target.closest('[data-id]');
    if (!b || !card) return;
    const id = Number(card.dataset.id);
    const buscar = async () => lista?.find((p) => p.id === id) || api(`/pedidos/${id}`);
    try {
      if (b.dataset.acc === 'avanzar') {
        const p = await buscar();
        const actualizado = await api(`/pedidos/${id}`, { method: 'PATCH', body: { estado: siguiente(p)[0] } });
        refrescar();
        if (enCamino(actualizado) && actualizado.telefono) avisarEnCamino(actualizado);
      } else if (b.dataset.acc === 'pagado') {
        const p = await buscar();
        if (p.pagado) {
          if (!(await confirmar(`¿Marcar el pedido #${p.numero} como NO cobrado?`, 'Sí, no cobrado'))) return;
          await api(`/pedidos/${id}`, { method: 'PATCH', body: { pagado: false } });
          refrescar();
        } else confirmarCobro(p, refrescar);
      } else if (b.dataset.acc === 'wa') whatsappPedido(await buscar());
    } catch (err) { aviso(err.message, true); }
  });
}

function confirmarCobro(p, refrescar) {
  modal(`<div class="cuerpo">
    <h2 style="margin-top:0">Cobrar pedido #${p.numero}</h2>
    <p>${esc(p.cliente) || 'Sin nombre'} · <b class="num">${plata(p.total)}</b></p>
    <p class="suave" style="margin-bottom:8px">¿Cómo pagó?</p>
    <div class="acciones">${MEDIOS.map((m) => `<button class="${m === p.medio_pago ? 'primario' : ''}" data-medio="${esc(m)}">${esc(m)}</button>`).join('')}</div>
    <div class="pie"><button onclick="this.closest('dialog').close()">Cancelar</button></div>
  </div>`, (d) => {
    $$('[data-medio]', d).forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/pedidos/${p.id}`, { method: 'PATCH', body: { pagado: true, medio_pago: b.dataset.medio } });
        d.close();
        aviso(`Pedido #${p.numero} cobrado`);
        refrescar();
      } catch (err) { aviso(err.message, true); }
    }));
  });
}

function avisarEnCamino(p) {
  modal(`<div class="cuerpo">
    <h2 style="margin-top:0">🛵 Pedido #${p.numero} en camino</h2>
    <p>¿Le avisás a ${esc(p.cliente) || 'el cliente'} por WhatsApp?</p>
    <div class="pie"><button onclick="this.closest('dialog').close()">No</button><button class="primario" id="b-avisar">Avisar por WhatsApp</button></div>
  </div>`, (d) => $('#b-avisar', d).addEventListener('click', () => { d.close(); whatsappPedido(p); }));
}

function telefonoWa(tel) {
  let d = String(tel || '').replace(/\D/g, '').replace(/^0/, '');
  if (d.length === 10) d = '549' + d;
  else if (d.length === 12 && d.startsWith('54') && d[2] !== '9') d = '549' + d.slice(2);
  return d;
}
function whatsappPedido(p) {
  const saludo = `¡Hola${p.cliente ? ' ' + p.cliente : ''}!`;
  if (enCamino(p)) {
    const msg = [
      `${saludo} Tu pedido está en camino 🛵`,
      p.pagado ? '' : `Total a pagar: ${plata(p.total)} (${p.medio_pago})`,
      '¡Gracias por elegirnos, que lo disfrutes!',
    ].filter(Boolean).join('\n');
    return window.open(`https://wa.me/${telefonoWa(p.telefono)}?text=${encodeURIComponent(msg)}`, '_blank');
  }
  const msg = [
    `${saludo} Te confirmo tu pedido de ${E.datos.cfg.negocio}:`,
    ...p.items.map((i) => `• ${numero(i.cantidad)} × ${i.nombre} — ${plata(i.precio * i.cantidad)}`),
    p.envio ? `• Envío — ${plata(p.envio)}` : '',
    `Total: ${plata(p.total)}${p.pagado ? ' (ya abonado ✅)' : ''}`,
    p.entrega ? `Entrega: ${horaEntrega(p.entrega)}` : '',
    p.estado === 'listo' ? '¡Ya está listo! 🙌' : '',
  ].filter(Boolean).join('\n');
  window.open(`https://wa.me/${telefonoWa(p.telefono)}?text=${encodeURIComponent(msg)}`, '_blank');
}
async function pedidos(el, _, vigente) {
  let vista = sessionStorage.getItem('vistaPedidos') || 'activos';
  const cargar = async () => {
    const lista = await api(vista === 'hoy' ? `/pedidos?vista=rango&desde=${fechaISO()}&hasta=${fechaISO()}` : `/pedidos?vista=${vista}`);
    if (!vigente()) return;
    E.listaPedidos = lista;
    const deuda = lista.reduce((t, p) => t + p.total, 0);
    $('#lista-ped', el).innerHTML = (vista === 'por_cobrar' && lista.length ? `<div class="alerta">Te deben <b>${plata(deuda)}</b> en ${lista.length} pedido${lista.length > 1 ? 's' : ''}. Tocá "💲 Sin cobrar" para confirmar cada pago.</div>` : '') +
      (lista.length ? `<div class="grilla">${lista.map(tarjetaPedido).join('')}</div>` :
      (vista === 'por_cobrar' ? '<div class="tarjeta vacio"><span class="grande">✅</span>No te deben nada</div>' : '<div class="tarjeta vacio"><span class="grande">🧾</span>No hay pedidos acá</div>'));
    $$('.pestanas button', el).forEach((b) => b.classList.toggle('activo', b.dataset.v === vista));
  };
  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Pedidos</h1><p class="suave">Tomá pedidos y seguilos hasta la entrega.</p></div>
      <div class="acciones"><a class="boton" href="#/cocina">👩‍🍳 Pantalla cocina</a><a class="boton primario" href="#/pedido/nuevo">＋ Nuevo pedido</a></div>
    </div>
    <div class="pestanas"><button data-v="activos">En curso</button><button data-v="por_cobrar">💲 Por cobrar</button><button data-v="hoy">Hoy</button><button data-v="todos">Últimos 200</button></div>
    <div id="lista-ped"><p class="cargando">Cargando…</p></div>`;
  $('.pestanas', el).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    vista = b.dataset.v;
    sessionStorage.setItem('vistaPedidos', vista);
    cargar();
  });
  activarTarjetasPedido($('#lista-ped', el), cargar, null);
  E.alEvento = (ev) => { if (ev.tipo === 'pedido') cargar(); };
  await cargar();
}

async function pedidoForm(el, param, vigente) {
  const existente = param && param !== 'nuevo' ? await api(`/pedidos/${param}`) : null;
  if (!vigente()) return;
  const p = existente || { cliente: '', telefono: '', tipo: 'envio', direccion: '', entrega: '', notas: '', pagado: 0, medio_pago: 'Efectivo', envio: 0, items: [] };
  const disponibles = E.datos.recetas.filter((r) => r.activa).map((r) => ({ r, c: calc(r) }));
  // elegidos: clave -> { receta_id, nombre, cantidad, precio, nota, costo }
  const elegidos = new Map();
  for (const it of p.items) elegidos.set(it.receta_id ? `r${it.receta_id}` : `x${it.id}`, { ...it });

  el.innerHTML = `
    <div class="cabecera"><div><a href="#/pedidos">← Pedidos</a><h1>${existente ? `Pedido #${existente.numero}` : 'Nuevo pedido'}</h1></div></div>
    <form id="f-ped">
      <div class="tarjeta">
        <h3>Productos</h3>
        ${disponibles.length > 8 ? '<input type="search" id="q-prod" placeholder="🔍 Buscar producto…" style="margin-bottom:10px">' : ''}
        <div class="selector-productos" id="prods"></div>
        ${disponibles.length ? '' : '<p class="suave">No hay recetas a la venta. <a href="#/receta/nueva">Creá una</a>.</p>'}
        <div id="detalle" style="margin-top:12px"></div>
      </div>
      <div class="tarjeta">
        <h3>Cliente y entrega</h3>
        <div class="fila">
          <div class="campo"><label>Nombre</label><input name="cliente" value="${esc(p.cliente)}" autocomplete="off"></div>
          <div class="campo"><label>Teléfono / WhatsApp</label><input name="telefono" type="tel" value="${esc(p.telefono)}" autocomplete="off"></div>
        </div>
        <input type="hidden" name="tipo" value="envio">
        <div class="campo"><label>Dirección de envío</label><input name="direccion" value="${esc(p.direccion)}" autocomplete="off"></div>
        <div class="fila">
          <div class="campo"><label>¿Para cuándo? <small>(opcional)</small></label><input name="entrega" type="datetime-local" value="${esc(p.entrega)}"></div>
          <div class="campo"><label>Costo de envío</label><input name="envio" type="number" min="0" step="any" value="${esc(p.envio || '')}" placeholder="$ 0"></div>
        </div>
        <label>Pago</label>
        <div class="segmentado" role="radiogroup" aria-label="Medio de pago">
          ${[...new Set([...MEDIOS, p.medio_pago])].map((m) => `<label><input type="radio" name="medio_pago" value="${esc(m)}" ${m === p.medio_pago ? 'checked' : ''}><span>${m === 'Efectivo' ? '💵' : m === 'Transferencia' ? '🏦' : ''} ${esc(m)}</span></label>`).join('')}
        </div>
        <div class="segmentado" role="radiogroup" aria-label="Estado del pago">
          <label><input type="radio" name="pagado" value="0" ${p.pagado ? '' : 'checked'}><span>⏳ Paga al recibir</span></label>
          <label><input type="radio" name="pagado" value="1" ${p.pagado ? 'checked' : ''}><span>✅ Ya abonó</span></label>
        </div>
        <p class="ayuda" style="margin:-4px 0 12px">Si ya abonó, el aviso de "en camino" no le menciona el monto.</p>
        <div class="campo"><label>Notas del pedido <small>(opcional)</small></label><textarea name="notas" placeholder="Ej: sin cebolla, tocar timbre 2B">${esc(p.notas)}</textarea></div>
        ${existente ? `<div class="acciones">
          ${existente.estado !== 'cancelado' ? '<button type="button" class="peligro" id="b-cancelar">Cancelar pedido</button>' : '<button type="button" id="b-reabrir">Reabrir pedido</button>'}
          <button type="button" class="peligro" id="b-borrar">Borrar</button></div>` : ''}
      </div>
      <div class="resumen-pedido"><span><span id="cant-total">0 productos</span><br><b id="total" class="num">$ 0</b></span><button class="primario">${existente ? 'Guardar cambios' : 'Guardar pedido'}</button></div>
    </form>`;

  const f = $('#f-ped', el);
  let filtro = '';
  const pintarProductos = () => {
    $('#prods', el).innerHTML = disponibles.filter(({ r }) => r.nombre.toLowerCase().includes(filtro)).map(({ r, c }) => {
      const sel = elegidos.get(`r${r.id}`);
      return `<div class="producto ${sel ? 'elegido' : ''}" data-r="${r.id}">
        <div class="crece"><b>${esc(r.nombre)}</b><small class="num">${plata(c.precio)}</small></div>
        <div class="contador">
          ${sel ? `<button type="button" class="icono" data-d="-1" aria-label="Quitar uno">−</button><output>${numero(sel.cantidad)}</output>` : ''}
          <button type="button" class="icono" data-d="1" aria-label="Agregar uno">＋</button>
        </div></div>`;
    }).join('');
  };
  const pintarDetalle = () => {
    const items = [...elegidos.entries()];
    $('#detalle', el).innerHTML = items.length ? `<table class="tabla"><tbody>${items.map(([k, it]) => `
      <tr data-k="${k}">
        <td style="width:46px"><b>${numero(it.cantidad)}×</b></td>
        <td>${esc(it.nombre)}<input data-campo="nota" value="${esc(it.nota || '')}" placeholder="Aclaración (opcional)" style="min-height:34px;padding:4px 8px;margin-top:4px;font-size:.9rem"></td>
        <td class="der" style="width:120px"><input data-campo="precio" type="number" min="0" step="any" value="${it.precio}" aria-label="Precio unitario" style="text-align:right;min-height:34px;padding:4px 8px"></td>
        <td style="width:40px"><button type="button" class="icono" data-quitar aria-label="Quitar">✕</button></td>
      </tr>`).join('')}</tbody></table>` : '<p class="suave">Tocá ＋ en los productos para agregarlos.</p>';
    totales();
  };
  const totales = () => {
    const o = leerForm(f);
    const sub = [...elegidos.values()].reduce((s, it) => s + it.cantidad * (Number(it.precio) || 0), 0);
    const n = [...elegidos.values()].reduce((s, it) => s + it.cantidad, 0);
    const envio = Number(o.envio) || 0;
    $('#cant-total', el).textContent = `${numero(n)} producto${n === 1 ? '' : 's'}${envio ? ' + envío' : ''}`;
    $('#total', el).textContent = plata(sub + envio);
  };
  $('#prods', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    const card = e.target.closest('[data-r]');
    if (!card) return;
    const id = Number(card.dataset.r);
    const k = `r${id}`;
    const d = b ? Number(b.dataset.d) : 1;
    const it = elegidos.get(k);
    if (it) { it.cantidad += d; if (it.cantidad <= 0) elegidos.delete(k); }
    else if (d > 0) {
      const { r, c } = disponibles.find((x) => x.r.id === id);
      elegidos.set(k, { receta_id: id, nombre: r.nombre, cantidad: 1, precio: c.precio, nota: '' });
    }
    pintarProductos();
    pintarDetalle();
  });
  $('#detalle', el).addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-k]');
    if (!tr || !e.target.dataset.campo) return;
    elegidos.get(tr.dataset.k)[e.target.dataset.campo] = e.target.value;
    totales();
  });
  $('#detalle', el).addEventListener('click', (e) => {
    const tr = e.target.closest('[data-quitar]')?.closest('tr');
    if (tr) { elegidos.delete(tr.dataset.k); pintarProductos(); pintarDetalle(); }
  });
  $('#q-prod', el)?.addEventListener('input', (e) => { filtro = e.target.value.toLowerCase(); pintarProductos(); });
  f.addEventListener('input', (e) => { if (!e.target.closest('#detalle')) totales(); });
  f.addEventListener('change', totales);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!elegidos.size) return aviso('Agregá al menos un producto', true);
    const o = leerForm(f);
    const body = { ...o, pagado: o.pagado === '1', items: [...elegidos.values()].map((it) => ({
      receta_id: it.receta_id, nombre: it.nombre, cantidad: it.cantidad, precio: it.precio, nota: it.nota, costo: it.costo,
    })) };
    try {
      const g = await api(existente ? `/pedidos/${existente.id}` : '/pedidos', { method: existente ? 'PUT' : 'POST', body });
      aviso(existente ? 'Pedido actualizado' : `Pedido #${g.numero} guardado`);
      location.hash = '#/pedidos';
    } catch (err) { aviso(err.message, true); }
  });
  $('#b-cancelar', el)?.addEventListener('click', async () => {
    if (!(await confirmar('¿Cancelar este pedido? No va a contar en las ganancias.', 'Sí, cancelar'))) return;
    await api(`/pedidos/${existente.id}`, { method: 'PATCH', body: { estado: 'cancelado' } });
    aviso('Pedido cancelado');
    location.hash = '#/pedidos';
  });
  $('#b-reabrir', el)?.addEventListener('click', async () => {
    await api(`/pedidos/${existente.id}`, { method: 'PATCH', body: { estado: 'nuevo' } });
    aviso('Pedido reabierto');
    navegar();
  });
  $('#b-borrar', el)?.addEventListener('click', async () => {
    if (!(await confirmar('¿Borrar el pedido para siempre?'))) return;
    await api(`/pedidos/${existente.id}`, { method: 'DELETE' });
    aviso('Pedido borrado');
    location.hash = '#/pedidos';
  });
  pintarProductos();
  pintarDetalle();
}

// =====================================================================
// PANTALLA COCINA (comandas en vivo)
// =====================================================================
let audio;
function sonar() {
  if (!audio || localStorage.getItem('sonido') !== '1') return;
  const t = audio.currentTime;
  [880, 1175, 880].forEach((f, n) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + n * 0.18);
    g.gain.exponentialRampToValueAtTime(0.4, t + n * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n * 0.18 + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t + n * 0.18);
    o.stop(t + n * 0.18 + 0.17);
  });
}

async function cocina(el, _, vigente) {
  document.body.classList.add('modo-cocina');
  const recien = new Set();
  let lista = [];
  try { E.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* sin soporte */ }

  el.innerHTML = `
    <div class="cocina-top">
      <h1>👩‍🍳 Comandas · <span id="reloj"></span></h1>
      <div class="acciones">
        <button id="b-sonido"></button>
        <button id="b-full">⛶ Pantalla completa</button>
        <a class="boton" href="#/pedidos" style="background:#2e2926;color:#f5efe9;border-color:#48403a">✕ Salir</a>
      </div>
    </div>
    <div class="columnas" id="cols"></div>`;

  const pintarSonido = () => { $('#b-sonido', el).textContent = localStorage.getItem('sonido') === '1' && audio ? '🔔 Sonido activado' : '🔕 Activar sonido'; };
  pintarSonido();
  $('#b-sonido', el).addEventListener('click', () => {
    const on = !(localStorage.getItem('sonido') === '1' && audio);
    localStorage.setItem('sonido', on ? '1' : '0');
    if (on) { audio = audio || new AudioContext(); audio.resume(); sonar(); }
    pintarSonido();
  });
  $('#b-full', el).addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()));

  const columna = (titulo, estado) => {
    const ps = lista.filter((p) => p.estado === estado);
    return `<section class="columna"><h2>${titulo} <span class="cuenta">${ps.length}</span></h2>${ps.map(comanda).join('') || '<p style="color:#8a7f77">—</p>'}</section>`;
  };
  const comanda = (p) => {
    const min = (Date.now() - new Date(p.creado)) / 60000;
    const sig = siguiente(p);
    return `<article class="comanda e-${p.estado} ${recien.has(p.id) ? 'recien' : ''}" data-id="${p.id}">
      <div class="top"><span class="nro">#${p.numero}</span><span class="tiempo ${min > 30 && p.estado !== 'listo' ? 'tarde' : ''}">${hace(p.creado)}</span></div>
      <div class="meta">${esc(p.cliente)} · ${p.tipo === 'envio' ? '🛵 Envío' : '🏃 Retira'}${p.entrega ? ` · <b style="color:#ffcf7a">para ${horaEntrega(p.entrega)}</b>` : ''}</div>
      <ul>${p.items.map((i) => `<li><b>${numero(i.cantidad)}×</b>${esc(i.nombre)}${i.nota ? `<div class="nota">↳ ${esc(i.nota)}</div>` : ''}</li>`).join('')}</ul>
      ${p.notas ? `<div class="nota">📝 ${esc(p.notas)}</div>` : ''}
      <div class="botones">
        ${ANTERIOR[p.estado] ? '<button data-acc="atras" style="flex:0 0 60px" aria-label="Volver atrás">↩</button>' : ''}
        ${sig ? `<button class="avanzar" data-acc="avanzar">${sig[1]}</button>` : ''}
      </div>
    </article>`;
  };
  const pintar = () => {
    if (!vigente()) return;
    $('#reloj', el).textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    $('#cols', el).innerHTML = columna('Nuevos', 'nuevo') + columna('Preparando', 'preparando') + columna('Listos', 'listo');
  };
  const cargar = async () => { lista = await api('/pedidos?vista=activos'); pintar(); };

  $('#cols', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acc]');
    const card = e.target.closest('[data-id]');
    if (!b || !card) return;
    const p = lista.find((x) => x.id === Number(card.dataset.id));
    const estado = b.dataset.acc === 'avanzar' ? siguiente(p)[0] : ANTERIOR[p.estado];
    p.estado = estado; // respuesta inmediata en pantalla
    recien.delete(p.id);
    pintar();
    try { await api(`/pedidos/${p.id}`, { method: 'PATCH', body: { estado } }); } catch (err) { aviso(err.message, true); cargar(); }
  });

  E.alEvento = async (ev) => {
    if (ev.tipo !== 'pedido') return;
    if (ev.nuevo) { recien.add(ev.id); sonar(); setTimeout(() => { recien.delete(ev.id); }, 8000); }
    await cargar();
  };
  const tic = setInterval(() => (vigente() ? pintar() : clearInterval(tic)), 30000);
  // Por si se cortó la conexión en vivo, refresca cada 2 minutos igual
  const respaldo = setInterval(() => (vigente() ? cargar() : clearInterval(respaldo)), 120000);
  await cargar();
}

// =====================================================================
// LISTA DE COMPRAS
// =====================================================================
async function compras(el, _, vigente) {
  const cargar = async () => {
    const lista = await api('/compras');
    if (!vigente()) return;
    E.compras = lista;
    const pendientes = lista.filter((c) => !c.comprado);
    const estimado = pendientes.reduce((s, c) => {
      const ing = E.ingMap.get(c.ingrediente_id);
      return ing && c.cantidad && FACTOR[c.unidad] && BASE[c.unidad] === BASE[ing.unidad] ? s + c.cantidad * FACTOR[c.unidad] * costoBase({ ...ing, merma: 0 }) : s;
    }, 0);
    $('#lista-compras', el).innerHTML = lista.length ? `
      <ul class="lista">${lista.map((c) => `
        <li class="compra ${c.comprado ? 'hecha' : ''}" data-id="${c.id}">
          <input type="checkbox" ${c.comprado ? 'checked' : ''} aria-label="Comprado">
          <span class="crece"><b>${esc(c.nombre)}</b>${c.cantidad ? ` <span class="suave num">${numero(c.cantidad)} ${esc(c.unidad)}</span>` : ''}</span>
          <button class="icono" data-borrar aria-label="Borrar">✕</button>
        </li>`).join('')}</ul>
      <p class="suave" style="margin:10px 0 0">${pendientes.length} por comprar${estimado ? ` · gasto estimado ${plata(estimado)}` : ''}</p>` :
      '<div class="vacio"><span class="grande">🛒</span>La lista está vacía</div>';
    $('#b-limpiar', el).hidden = !lista.some((c) => c.comprado);
  };

  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Lista de compras</h1><p class="suave">Se comparte entre todos los dispositivos.</p></div>
      <div class="acciones">
        <button id="b-desde-ped">🧾 Calcular desde pedidos</button>
        <button id="b-plan">📋 Planificar producción</button>
      </div>
    </div>
    <form class="tarjeta" id="f-compra" style="margin-bottom:12px">
      <div style="display:grid;grid-template-columns:1fr 80px 90px auto;gap:6px">
        <input name="nombre" placeholder="Agregar a la lista…" list="ings-compra" required aria-label="Producto">
        <input name="cantidad" type="number" step="any" min="0" placeholder="Cant." aria-label="Cantidad">
        <select name="unidad" aria-label="Unidad"><option value="">—</option>${UNIDADES.map((u) => `<option>${u}</option>`).join('')}</select>
        <button class="primario icono" aria-label="Agregar">＋</button>
      </div>
      <datalist id="ings-compra">${E.datos.ingredientes.map((i) => `<option value="${esc(i.nombre)}">`).join('')}</datalist>
    </form>
    <div class="tarjeta" id="lista-compras"><p class="cargando">Cargando…</p></div>
    <div class="acciones" style="margin-top:12px">
      <button id="b-wa">Compartir por WhatsApp</button>
      <button id="b-limpiar" class="peligro" hidden>Borrar los ya comprados</button>
    </div>`;

  $('#f-compra', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = leerForm(e.target);
    const ing = E.datos.ingredientes.find((i) => i.nombre.toLowerCase() === o.nombre.trim().toLowerCase());
    try {
      await api('/compras', { method: 'POST', body: { ...o, ingrediente_id: ing?.id } });
      e.target.reset();
      $('[name=nombre]', e.target).focus();
      cargar();
    } catch (err) { aviso(err.message, true); }
  });
  $('#lista-compras', el).addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    if (e.target.matches('[data-borrar]')) { await api(`/compras/${li.dataset.id}`, { method: 'DELETE' }); cargar(); }
    else if (e.target.matches('input[type=checkbox]')) { await api(`/compras/${li.dataset.id}`, { method: 'PATCH', body: { comprado: e.target.checked } }); cargar(); }
  });
  $('#b-limpiar', el).addEventListener('click', async () => { await api('/compras/comprados', { method: 'DELETE' }); cargar(); });
  $('#b-wa', el).addEventListener('click', () => {
    const pend = (E.compras || []).filter((c) => !c.comprado);
    if (!pend.length) return aviso('No hay nada pendiente', true);
    const txt = `🛒 Lista de compras\n${pend.map((c) => `• ${c.nombre}${c.cantidad ? ` — ${numero(c.cantidad)} ${c.unidad}` : ''}`).join('\n')}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
  });

  const mostrarNecesidades = (res, titulo) => {
    if (!res.length) return aviso('No hace falta comprar nada para eso', true);
    modal(`<form method="dialog" id="f-nec">
      <h2 style="margin-top:0">${titulo}</h2>
      <p class="suave">Destildá lo que ya tenés en casa.</p>
      <ul class="lista">${res.map((r, n) => `<li><input type="checkbox" checked data-n="${n}"><span class="crece">${esc(r.nombre)}</span><span class="num">${numero(r.cantidad)} ${r.unidad}</span></li>`).join('')}</ul>
      <div class="pie"><button type="button" onclick="this.closest('dialog').close()">Cancelar</button><button class="primario">Agregar a la lista</button></div>
    </form>`, (d) => {
      $('#f-nec', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const elegidos = $$('input[data-n]:checked', d).map((cb) => res[cb.dataset.n]);
        for (const r of elegidos) {
          const ya = (E.compras || []).find((c) => !c.comprado && c.ingrediente_id === r.ingrediente_id && c.unidad === r.unidad);
          if (ya) await api(`/compras/${ya.id}`, { method: 'PATCH', body: { cantidad: (ya.cantidad || 0) + r.cantidad, unidad: r.unidad } });
          else await api('/compras', { method: 'POST', body: r });
        }
        d.close();
        aviso(`${elegidos.length} agregados`);
        cargar();
      });
    });
  };
  $('#b-desde-ped', el).addEventListener('click', async () => {
    try { mostrarNecesidades(await api('/compras/calcular', { method: 'POST', body: { fuente: 'pedidos' } }), 'Para los pedidos pendientes'); }
    catch (err) { aviso(err.message, true); }
  });
  $('#b-plan', el).addEventListener('click', () => {
    const recs = E.datos.recetas.filter((r) => r.activa);
    if (!recs.length) return aviso('Primero creá recetas', true);
    modal(`<form method="dialog" id="f-plan">
      <h2 style="margin-top:0">¿Qué vas a cocinar?</h2>
      <p class="suave">Poné cuántas porciones de cada cosa y te calculo los ingredientes.</p>
      <ul class="lista">${recs.map((r) => `<li><span class="crece">${esc(r.nombre)} <small>(receta rinde ${numero(r.porciones)})</small></span>
        <input type="number" min="0" step="any" data-id="${r.id}" style="width:90px" placeholder="0" aria-label="Porciones de ${esc(r.nombre)}"></li>`).join('')}</ul>
      <div class="pie"><button type="button" onclick="this.closest('dialog').close()">Cancelar</button><button class="primario">Calcular</button></div>
    </form>`, (d) => {
      $('#f-plan', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const plan = $$('input[data-id]', d).filter((i) => Number(i.value) > 0).map((i) => ({ receta_id: i.dataset.id, cantidad: i.value }));
        if (!plan.length) return aviso('Poné al menos una cantidad', true);
        try { mostrarNecesidades(await api('/compras/calcular', { method: 'POST', body: { fuente: 'plan', plan } }), 'Necesitás'); }
        catch (err) { aviso(err.message, true); }
      });
    });
  });
  E.alEvento = (ev) => { if (ev.tipo === 'compras' && !dlg.open) cargar(); };
  await cargar();
}

// =====================================================================
// GANANCIAS
// =====================================================================
function periodo(clave) {
  const h = new Date();
  const d = (x) => fechaISO(x);
  if (clave === 'hoy') return [d(h), d(h)];
  if (clave === 'semana') { const l = new Date(h); l.setDate(h.getDate() - ((h.getDay() + 6) % 7)); return [d(l), d(h)]; }
  if (clave === 'mes') return [d(new Date(h.getFullYear(), h.getMonth(), 1)), d(h)];
  if (clave === 'pasado') return [d(new Date(h.getFullYear(), h.getMonth() - 1, 1)), d(new Date(h.getFullYear(), h.getMonth(), 0))];
  return null;
}

async function ganancias(el, _, vigente) {
  let clave = 'mes';
  let [desde, hasta] = periodo(clave);
  el.innerHTML = `
    <div class="cabecera"><div><h1>Ganancias</h1><p class="suave">Calculado con los costos del día de cada pedido. Los cancelados no cuentan.</p></div></div>
    <div class="pestanas">
      <button data-p="hoy">Hoy</button><button data-p="semana">Esta semana</button><button data-p="mes">Este mes</button><button data-p="pasado">Mes pasado</button><button data-p="otro">Elegir fechas</button>
    </div>
    <div class="fila" id="fechas" hidden style="max-width:420px;margin-bottom:12px">
      <div><label>Desde</label><input type="date" id="desde"></div><div><label>Hasta</label><input type="date" id="hasta"></div>
    </div>
    <div id="res"><p class="cargando">Cargando…</p></div>`;

  const cargar = async () => {
    $$('.pestanas button', el).forEach((b) => b.classList.toggle('activo', b.dataset.p === clave));
    const r = await api(`/resumen?desde=${desde}&hasta=${hasta}`);
    if (!vigente()) return;
    const max = Math.max(1, ...r.porDia.map((d) => Math.abs(d.ganancia)));
    $('#res', el).innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${plata(r.ventas)}</b><span>vendido (${r.pedidos} pedidos)</span></div>
        <div class="kpi"><b>${plata(r.costo)}</b><span>costo de lo vendido</span></div>
        ${r.comision ? `<div class="kpi"><b>${plata(r.comision)}</b><span>comisiones</span></div>` : ''}
        ${r.envios ? `<div class="kpi"><b>${plata(r.envios)}</b><span>cobrado en envíos</span></div>` : ''}
        <div class="kpi ${r.ganancia >= 0 ? 'verde' : 'rojo'}"><b>${plata(r.ganancia)}</b><span>ganancia</span></div>
        <div class="kpi"><b>${plata(r.pedidos ? r.ventas / r.pedidos : 0)}</b><span>ticket promedio</span></div>
        ${r.a_cobrar ? `<div class="kpi rojo"><b>${plata(r.a_cobrar)}</b><span>falta cobrar</span></div>` : ''}
      </div>
      <p class="ayuda">La ganancia ya descuenta tus gastos fijos y tu trabajo (si los cargaste en Ajustes), porque están dentro del costo de cada receta. No incluye lo cobrado por envío.</p>
      ${r.porDia.length > 1 ? `<div class="tarjeta"><h3>Ganancia por día</h3><div class="barras">${r.porDia.map((d) => `
        <div title="${d.dia}: ${plata(d.ganancia)} (${d.pedidos} pedidos)"><i class="${d.ganancia < 0 ? 'neg' : ''}" style="height:${(Math.abs(d.ganancia) / max) * 100}%"></i><small>${d.dia.slice(8)}/${d.dia.slice(5, 7)}</small></div>`).join('')}</div></div>` : ''}
      <div class="tarjeta"><h3>Productos</h3>${r.productos.length ? `<div class="tabla-scroll"><table class="tabla">
        <thead><tr><th>Producto</th><th class="der">Vendidos</th><th class="der">Ventas</th><th class="der">Ganancia</th></tr></thead>
        <tbody>${r.productos.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="der num">${numero(p.cantidad)}</td><td class="der num">${plata(p.ventas)}</td>
          <td class="der num" style="color:${p.ganancia < 0 ? 'var(--rojo)' : 'var(--verde)'}">${plata(p.ganancia)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="suave">Sin ventas en este período.</p>'}</div>
      ${r.medios.length ? `<div class="tarjeta"><h3>Medios de pago</h3><table class="tabla"><tbody>${r.medios.map((m) => `<tr><td>${esc(m.medio_pago)}</td><td class="der">${m.pedidos} pedidos</td><td class="der num">${plata(m.total)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };

  $('.pestanas', el).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    clave = b.dataset.p;
    $('#fechas', el).hidden = clave !== 'otro';
    if (clave === 'otro') { $('#desde', el).value = desde; $('#hasta', el).value = hasta; $$('.pestanas button', el).forEach((x) => x.classList.toggle('activo', x === b)); return; }
    [desde, hasta] = periodo(clave);
    cargar();
  });
  $('#fechas', el).addEventListener('change', () => {
    desde = $('#desde', el).value || desde;
    hasta = $('#hasta', el).value || hasta;
    cargar();
  });
  await cargar();
}

// =====================================================================
// AJUSTES
// =====================================================================
async function ajustes(el) {
  const { cfg } = E.datos;
  const pintarGastos = () => {
    const total = gastosMes();
    $('#gastos', el).innerHTML = `
      ${E.datos.gastos.map((g) => `<div data-id="${g.id}" style="display:grid;grid-template-columns:1fr 130px auto;gap:6px;margin-bottom:6px">
        <input data-k="nombre" value="${esc(g.nombre)}" aria-label="Gasto"><input data-k="monto" type="number" min="0" step="any" value="${g.monto}" aria-label="Monto por mes">
        <button type="button" class="icono" data-borrar aria-label="Borrar">✕</button></div>`).join('') || '<p class="suave">Sin gastos fijos cargados.</p>'}
      <p class="suave num" style="margin:8px 0 0">Total por mes: <b>${plata(total)}</b>${Number(cfg.porciones_mes) > 0 && total ? ` → ${plata(total / cfg.porciones_mes, true)} por porción` : ''}</p>`;
  };
  el.innerHTML = `
    <div class="cabecera"><div><h1>Ajustes</h1><p class="suave">Valores generales que usa la calculadora.</p></div></div>
    <form class="tarjeta" id="f-cfg">
      <div class="campo"><label>Nombre del emprendimiento</label><input name="negocio" value="${esc(cfg.negocio)}"></div>
      <div class="fila">
        <div class="campo"><label>Ganancia general sobre el costo %</label><input name="margen" type="number" min="0" step="any" value="${cfg.margen}">
          <p class="ayuda">Se usa en las recetas que no tienen una propia. 100% = el doble del costo.</p></div>
        <div class="campo"><label>Redondear precios a</label><select name="redondeo">${[0, 10, 50, 100, 500, 1000].map((v) => `<option value="${v}" ${Number(cfg.redondeo) === v ? 'selected' : ''}>${v ? plata(v) : 'Sin redondeo'}</option>`).join('')}</select></div>
      </div>
      <div class="fila">
        <div class="campo"><label>Valor de tu hora de trabajo</label><input name="valor_hora" type="number" min="0" step="any" value="${cfg.valor_hora}">
          <p class="ayuda">Se suma al costo según los minutos de cada receta. Poné 0 si no querés contarlo.</p></div>
        <div class="campo"><label>Porciones que vendés por mes (aprox.)</label><input name="porciones_mes" type="number" min="0" step="any" value="${cfg.porciones_mes}">
          <p class="ayuda">Para repartir los gastos fijos entre cada porción.</p></div>
      </div>
      <input type="hidden" name="comision" value="0"><input type="hidden" name="medios_comision" value="">
      <button class="primario">Guardar ajustes</button>
    </form>
    <div class="tarjeta">
      <h3>Gastos fijos por mes</h3>
      <p class="suave" style="margin-top:0">Gas, luz, internet, alquiler, monotributo… Se reparten en el costo de cada porción.</p>
      <div id="gastos"></div>
      <button type="button" class="chico" id="b-gasto" style="margin-top:8px">＋ Agregar gasto</button>
    </div>
    <div class="tarjeta">
      <h3>Sesión</h3>
      <p class="suave" style="margin-top:0">Para usar la app en otro celular o en la tablet de la cocina, abrí este mismo link e ingresá la contraseña.</p>
      <button id="b-salir" class="peligro">Cerrar sesión en este dispositivo</button>
    </div>`;
  pintarGastos();

  $('#f-cfg', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/config', { method: 'PUT', body: leerForm(e.target) }); await cargarDatos(); aviso('Ajustes guardados'); }
    catch (err) { aviso(err.message, true); }
  });
  $('#b-gasto', el).addEventListener('click', async () => {
    await api('/gastos', { method: 'POST', body: { nombre: 'Nuevo gasto', monto: 0 } });
    await cargarDatos();
    pintarGastos();
    $$('#gastos [data-k=nombre]', el).at(-1)?.select();
  });
  $('#gastos', el).addEventListener('change', async (e) => {
    const fila = e.target.closest('[data-id]');
    if (!fila) return;
    await api(`/gastos/${fila.dataset.id}`, { method: 'PUT', body: { nombre: $('[data-k=nombre]', fila).value, monto: $('[data-k=monto]', fila).value } });
    await cargarDatos();
    pintarGastos();
    aviso('Gasto guardado');
  });
  $('#gastos', el).addEventListener('click', async (e) => {
    const fila = e.target.closest('[data-borrar]')?.closest('[data-id]');
    if (!fila) return;
    await api(`/gastos/${fila.dataset.id}`, { method: 'DELETE' });
    await cargarDatos();
    pintarGastos();
  });
  $('#b-salir', el).addEventListener('click', async () => { await api('/logout', { method: 'POST' }); mostrarLogin(); });
}

// =====================================================================
// RECETARIO (gratis: busca links en sitios argentinos y convierte la lista pegada)
// =====================================================================
async function recetario(el, param, vigente) {
  if (param === 'pegar') return pegarReceta(el);
  const ultima = sessionStorage.getItem('busquedaRecetario') || '';
  el.innerHTML = `
    <div class="cabecera">
      <div><h1>Recetario</h1><p class="suave">Buscá un plato en Cocineros Argentinos y Paulina Cocina. Abrí la receta, copiá los ingredientes y pegalos: te armo la receta con costos.</p></div>
      <a class="boton" href="#/recetario/pegar">📋 Pegar una receta</a>
    </div>
    <form class="tarjeta" id="f-buscar">
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
        <div><label for="plato">¿Qué plato buscás?</label><input id="plato" name="q" required minlength="3" value="${esc(ultima)}" placeholder="Ej: empanadas de carne, pastel de papa…" autocomplete="off"></div>
        <button class="primario">Buscar</button>
      </div>
    </form>
    <div id="resultados" style="margin-top:12px"></div>`;

  const buscar = async (q) => {
    sessionStorage.setItem('busquedaRecetario', q);
    $('#resultados', el).innerHTML = '<p class="cargando">Buscando…</p>';
    try {
      const { resultados, fallaron } = await api(`/recetario/buscar?q=${encodeURIComponent(q)}`);
      if (!vigente()) return;
      $('#resultados', el).innerHTML = `
        ${fallaron.length ? `<div class="alerta">No pude consultar ${fallaron.join(' ni ')} en este momento.</div>` : ''}
        ${resultados.length ? `<div class="tarjeta"><ul class="lista">${resultados.map((r, n) => `
          <li>
            <span class="crece"><b>${esc(r.titulo)}</b><br><small>${esc(r.sitio)}</small></span>
            <a class="boton chico" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir ↗</a>
            <button class="chico primario" data-n="${n}">📋 Pegar</button>
          </li>`).join('')}</ul></div>` : '<div class="tarjeta vacio"><span class="grande">🔍</span>No encontré recetas con ese nombre. Probá con menos palabras.</div>'}`;
      $$('[data-n]', el).forEach((b) => b.addEventListener('click', () => {
        const r = resultados[b.dataset.n];
        sessionStorage.setItem('pegarReceta', JSON.stringify({ nombre: r.titulo, fuente: r.url }));
        location.hash = '#/recetario/pegar';
      }));
    } catch (err) { $('#resultados', el).innerHTML = ''; aviso(err.message, true); }
  };
  $('#f-buscar', el).addEventListener('submit', (e) => { e.preventDefault(); buscar(e.target.q.value.trim()); });
  if (ultima) buscar(ultima); else $('#plato', el).focus();
}

function pegarReceta(el) {
  let previo = {};
  try { previo = JSON.parse(sessionStorage.getItem('pegarReceta') || '{}'); } catch { /* nada */ }
  sessionStorage.removeItem('pegarReceta');
  let filas = [];

  el.innerHTML = `
    <div class="cabecera"><div><a href="#/recetario">← Recetario</a><h1>Pegar una receta</h1>
      <p class="suave">Copiá la lista de ingredientes de cualquier página o libro y pegala abajo, un ingrediente por renglón.</p></div></div>
    <form id="f-pegar" class="dos-col">
      <div>
        <div class="tarjeta">
          <div class="campo"><label>Nombre</label><input name="nombre" required value="${esc(previo.nombre || '')}" placeholder="Ej: Pastel de papa"></div>
          <div class="fila">
            <div class="campo"><label>Rinde (porciones)</label><input name="porciones" type="number" min="1" step="any" value="1" required></div>
            <div class="campo"><label>Minutos de trabajo</label><input name="minutos" type="number" min="0" step="any" value="0"></div>
          </div>
          ${previo.fuente ? `<p class="ayuda" style="margin-top:-4px">Fuente: <a href="${esc(previo.fuente)}" target="_blank" rel="noopener">${esc(previo.fuente)}</a> — tenela abierta en otra pestaña para copiar.</p>` : ''}
          <input type="hidden" name="fuente" value="${esc(previo.fuente || '')}">
          <div class="campo"><label>Ingredientes</label><textarea name="texto" rows="9" autofocus placeholder="500 g de harina&#10;2 tazas de leche&#10;3 huevos&#10;1 cda de aceite&#10;Sal a gusto"></textarea></div>
          <div class="campo"><label>Preparación <small>(opcional, se guarda en las notas)</small></label><textarea name="preparacion" rows="4"></textarea></div>
        </div>
      </div>
      <div class="pegajoso">
        <div class="tarjeta">
          <h3>Así lo entendí</h3>
          <p class="ayuda" style="margin-top:0">Revisá las cantidades. Lo marcado en amarillo conviene chequearlo. Las tazas y cucharadas se pasan a gramos o ml.</p>
          <div id="vista-previa"><p class="suave">Pegá los ingredientes para ver la conversión.</p></div>
        </div>
        <button class="primario" style="margin-top:12px;width:100%">Crear receta y calcular costo</button>
      </div>
    </form>`;

  const f = $('#f-pegar', el);
  const compatibles = (unidad) => (i) => !!i && BASE[i.unidad] === BASE[unidad];
  const opciones = (fila) => {
    const ings = E.datos.ingredientes.filter(compatibles(fila.unidad));
    return `<option value="nuevo" ${fila.ing === 'nuevo' ? 'selected' : ''}>➕ Nuevo: ${esc(fila.nombre)}</option>` +
      ings.map((i) => `<option value="${i.id}" ${Number(fila.ing) === i.id ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('');
  };
  const pintar = () => {
    $('#vista-previa', el).innerHTML = filas.length ? filas.map((fi, n) => `
      <div data-n="${n}" style="padding:8px;border-radius:10px;margin-bottom:6px;background:${fi.dudoso ? 'var(--amarillo-claro)' : '#faf6f1'};${fi.usar ? '' : 'opacity:.5'}">
        <small class="suave">${esc(fi.original)}</small>
        <div style="display:grid;grid-template-columns:auto 1fr 72px;gap:6px;align-items:center;margin-top:4px">
          <input type="checkbox" data-k="usar" ${fi.usar ? 'checked' : ''} aria-label="Incluir">
          <input data-k="cantidad" type="number" min="0" step="any" value="${fi.cantidad}" aria-label="Cantidad" style="min-height:36px;padding:4px 8px">
          <select data-k="unidad" aria-label="Unidad" style="min-height:36px;padding:4px">${UNIDADES.map((u) => `<option ${u === fi.unidad ? 'selected' : ''}>${u}</option>`).join('')}</select>
          <select data-k="ing" aria-label="Ingrediente" style="min-height:36px;padding:4px;grid-column:2 / -1">${opciones(fi)}</select>
        </div>
      </div>`).join('') : '<p class="suave">Pegá los ingredientes para ver la conversión.</p>';
  };
  const analizar = () => {
    filas = parsearLista(f.texto.value).map((p) => {
      const ing = buscarIngrediente(p.nombre, E.datos.ingredientes, compatibles(p.unidad));
      return { ...p, usar: p.cantidad > 0, ing: compatibles(p.unidad)(ing) ? String(ing.id) : 'nuevo' };
    });
    pintar();
  };
  let espera;
  f.texto.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(analizar, 300); });
  $('#vista-previa', el).addEventListener('change', (e) => {
    const box = e.target.closest('[data-n]');
    if (!box) return;
    const fi = filas[box.dataset.n];
    const k = e.target.dataset.k;
    if (k === 'usar') fi.usar = e.target.checked;
    else if (k === 'cantidad') fi.cantidad = Number(e.target.value) || 0;
    else fi[k] = e.target.value;
    if (k === 'unidad' && fi.ing !== 'nuevo' && !compatibles(fi.unidad)(E.ingMap.get(Number(fi.ing)))) fi.ing = 'nuevo';
    if (k !== 'cantidad') pintar();
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usar = filas.filter((fi) => fi.usar && fi.cantidad > 0);
    if (!usar.length) return aviso('Pegá al menos un ingrediente con cantidad', true);
    const boton = $('button.primario', f);
    boton.disabled = true;
    try {
      const creados = new Map();
      const items = [];
      for (const fi of usar) {
        let id = Number(fi.ing);
        if (fi.ing === 'nuevo') {
          const clave = normalizar(fi.nombre) + '|' + BASE[fi.unidad];
          if (!creados.has(clave)) {
            const unidadCompra = { g: 'kg', ml: 'l', u: 'u' }[BASE[fi.unidad]];
            const nuevo = await api('/ingredientes', { method: 'POST', body: { nombre: fi.nombre, unidad: unidadCompra, cantidad: 1, precio: 0 } });
            creados.set(clave, nuevo.id);
          }
          id = creados.get(clave);
        }
        items.push({ ingrediente_id: id, cantidad: fi.cantidad, unidad: fi.unidad });
      }
      const o = leerForm(f);
      const notas = [o.preparacion.trim(), o.fuente ? `Fuente: ${o.fuente}` : ''].filter(Boolean).join('\n\n');
      const r = await api('/recetas', { method: 'POST', body: { nombre: o.nombre, porciones: o.porciones, minutos: o.minutos, notas, items } });
      await cargarDatos();
      aviso(creados.size ? `Receta creada. Cargá el precio de ${creados.size} ingrediente${creados.size > 1 ? 's' : ''} nuevo${creados.size > 1 ? 's' : ''}` : 'Receta creada');
      location.hash = `#/receta/${r.id}`;
    } catch (err) { aviso(err.message, true); boton.disabled = false; }
  });
}

function mas(el) {
  el.innerHTML = `<h1>Más</h1>
    <div class="tarjeta"><ul class="lista">
      <li><span>📖</span><a class="crece" href="#/recetario">Recetario (buscar y pegar recetas)</a></li>
      <li><span>🥕</span><a class="crece" href="#/ingredientes">Ingredientes y precios</a></li>
      <li><span>📈</span><a class="crece" href="#/ganancias">Ganancias</a></li>
      <li><span>👩‍🍳</span><a class="crece" href="#/cocina">Pantalla de cocina (comandas en vivo)</a></li>
      <li><span>⚙️</span><a class="crece" href="#/ajustes">Ajustes y gastos fijos</a></li>
    </ul></div>`;
}

// ---------- Arranque ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
iniciar();

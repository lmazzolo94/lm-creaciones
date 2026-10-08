// Demo de Mi-Cocina que corre entera en el navegador: la base SQLite vive acá
// (sql.js) y las rutas son las mismas del servidor real (server.js de
// cocina-costos), atendidas interceptando fetch('/api/...'). Cada visitante
// tiene su copia (guardada en este navegador) con datos inventados de un
// negocio ficticio. Las comandas en vivo funcionan entre pestañas.
import { calcularReceta, totalGastos, necesidades, legible, compatibles, UNIDADES } from './calc.js';

const CLAVE = 'lm-demo-micocina-v1';
const TZ = 'America/Argentina/Buenos_Aires';
// Avisos a las otras pestañas: por localStorage (el evento "storage" llega
// cuando el dato ya está visible en la otra pestaña).
const CLAVE_EV = `${CLAVE}-eventos`;

// ---------- Base de datos ----------
let SQL;
let db;
const aB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
function guardar() {
  try { localStorage.setItem(CLAVE, aB64(db.export())); } catch { /* sin almacenamiento: vale para esta visita */ }
}
function abrirGuardada() {
  try { const b = localStorage.getItem(CLAVE); if (b) { db = new SQL.Database(deB64(b)); return true; } } catch { /* nada guardado */ }
  return false;
}

const all = async (sql, args = []) => {
  const st = db.prepare(sql);
  st.bind(args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a)));
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
};
const get = async (sql, args = []) => (await all(sql, args))[0];
const run = async (sql, args = []) => {
  db.run(sql, args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a)));
  return { id: db.exec('SELECT last_insert_rowid() id')[0].values[0][0], cambios: db.getRowsModified() };
};

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS ingredientes (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT DEFAULT '',
  unidad TEXT NOT NULL DEFAULT 'kg', cantidad REAL NOT NULL DEFAULT 1, precio REAL NOT NULL DEFAULT 0,
  merma REAL NOT NULL DEFAULT 0, actualizado TEXT);
CREATE TABLE IF NOT EXISTS recetas (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, categoria TEXT DEFAULT '', porciones REAL NOT NULL DEFAULT 1,
  minutos REAL NOT NULL DEFAULT 0, margen REAL, precio REAL, activa INTEGER NOT NULL DEFAULT 1, notas TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS receta_items (
  id INTEGER PRIMARY KEY, receta_id INTEGER NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id), cantidad REAL NOT NULL, unidad TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gastos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, monto REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY, numero INTEGER NOT NULL, dia TEXT NOT NULL, cliente TEXT DEFAULT '', telefono TEXT DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'retiro', direccion TEXT DEFAULT '', entrega TEXT DEFAULT '', notas TEXT DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'nuevo', pagado INTEGER NOT NULL DEFAULT 0, medio_pago TEXT DEFAULT 'Efectivo',
  envio REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, costo REAL NOT NULL DEFAULT 0, comision REAL NOT NULL DEFAULT 0,
  creado TEXT NOT NULL, actualizado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pedido_items (
  id INTEGER PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE, receta_id INTEGER,
  nombre TEXT NOT NULL, cantidad REAL NOT NULL, precio REAL NOT NULL, costo REAL NOT NULL, nota TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, cantidad REAL, unidad TEXT DEFAULT '', ingrediente_id INTEGER,
  comprado INTEGER NOT NULL DEFAULT 0, creado TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pedidos_dia ON pedidos(dia);
CREATE INDEX IF NOT EXISTS idx_items_receta ON receta_items(receta_id);
CREATE INDEX IF NOT EXISTS idx_pitems_pedido ON pedido_items(pedido_id);
`;

const CONFIG_DEFECTO = {
  negocio: 'Mi-Cocina', valor_hora: 0, porciones_mes: 200, margen: 100, comision: 0, redondeo: 100,
  medios_comision: '',
};
const NUMERICAS = ['valor_hora', 'porciones_mes', 'margen', 'comision', 'redondeo'];
const ESTADOS = ['nuevo', 'preparando', 'listo', 'entregado', 'cancelado'];
const ahora = () => new Date().toISOString();
const diaDe = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const hoy = () => diaDe(new Date());
const num = (v, d = 0) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? d : Number(v));
const numONull = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
const txt = (v, max = 500) => String(v ?? '').trim().slice(0, max);

async function leerConfig() {
  const filas = await all('SELECT clave, valor FROM config');
  const cfg = { ...CONFIG_DEFECTO };
  for (const f of filas) cfg[f.clave] = NUMERICAS.includes(f.clave) ? Number(f.valor) : f.valor;
  return cfg;
}
async function leerRecetas() {
  const recetas = await all('SELECT * FROM recetas ORDER BY categoria, nombre');
  const items = await all('SELECT * FROM receta_items ORDER BY id');
  const porReceta = new Map(recetas.map((r) => [r.id, (r.items = [])]));
  for (const it of items) porReceta.get(it.receta_id)?.push(it);
  return recetas;
}
async function contexto() {
  const [cfg, ingredientes, recetas, gastos] = await Promise.all([
    leerConfig(), all('SELECT * FROM ingredientes ORDER BY categoria, nombre'), leerRecetas(), all('SELECT * FROM gastos ORDER BY id'),
  ]);
  return { cfg, ingredientes, recetas, gastos, ingMap: new Map(ingredientes.map((i) => [i.id, i])), gastosMes: totalGastos(gastos) };
}

// ---------- Comandas en vivo (EventSource simulado + otras pestañas) ----------
const oyentes = new Set();
function emitir(datos) {
  for (const es of oyentes) es.onmessage?.({ data: JSON.stringify(datos) });
}
let sembrando = false;
function avisar(tipo, datos = {}) {
  if (sembrando) return;
  emitir({ tipo, ...datos });
  // Las otras pestañas se enteran después de guardar (ver fetch).
  pendientes.push({ tipo, ...datos });
}
const pendientes = [];
addEventListener('storage', (e) => {
  // Otra pestaña reinició la demo o cambió algo: se relee la base guardada
  // y se avisa a la vista.
  if (e.key === CLAVE && e.newValue === null) return location.reload();
  if (e.key !== CLAVE_EV || !e.newValue) return;
  if (!abrirGuardada()) return;
  try { for (const ev of JSON.parse(e.newValue).eventos) emitir(ev); } catch { /* aviso roto */ }
});

// ---------- Rutas (las mismas que server.js) ----------
const rutas = [];
const api = {};
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  api[m] = (patron, fn) => {
    const claves = [];
    const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, k) => (claves.push(k), '([^/]+)')) + '$');
    rutas.push({ metodo: m.toUpperCase(), re, claves, fn });
  };
}
const h = (fn) => fn;

api.post('/login', (req, res) => res.json({ ok: true }));
api.post('/logout', (req, res) => res.json({ ok: true }));

api.get('/datos', h(async (req, res) => {
  const { cfg, ingredientes, recetas, gastos } = await contexto();
  res.json({ cfg, ingredientes, recetas, gastos });
}));

api.put('/config', h(async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in CONFIG_DEFECTO)) continue;
    const valor = NUMERICAS.includes(k) ? String(num(v)) : txt(v, 300);
    await run('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', [k, valor]);
  }
  res.json(await leerConfig());
}));

const datosIngrediente = (b) => {
  const unidad = UNIDADES.includes(b.unidad) ? b.unidad : 'kg';
  return [txt(b.nombre, 120), txt(b.categoria, 60), unidad, num(b.cantidad, 1) || 1, num(b.precio), Math.min(Math.max(num(b.merma), 0), 95), ahora()];
};
api.post('/ingredientes', h(async (req, res) => {
  if (!txt(req.body?.nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  const { id } = await run('INSERT INTO ingredientes (nombre, categoria, unidad, cantidad, precio, merma, actualizado) VALUES (?,?,?,?,?,?,?)', datosIngrediente(req.body));
  res.json(await get('SELECT * FROM ingredientes WHERE id = ?', [id]));
}));
api.put('/ingredientes/:id', h(async (req, res) => {
  if (!txt(req.body?.nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  const previo = await get('SELECT * FROM ingredientes WHERE id = ?', [req.params.id]);
  if (!previo) return res.status(404).json({ error: 'No existe' });
  const d = datosIngrediente(req.body);
  if (!compatibles(d[2], previo.unidad)) {
    const usos = await get('SELECT COUNT(*) n FROM receta_items WHERE ingrediente_id = ?', [req.params.id]);
    if (usos.n > 0) return res.status(400).json({ error: `Este ingrediente se usa en recetas con otra unidad. No se puede pasar a "${d[2]}".` });
  }
  await run('UPDATE ingredientes SET nombre=?, categoria=?, unidad=?, cantidad=?, precio=?, merma=?, actualizado=? WHERE id=?', [...d, req.params.id]);
  res.json(await get('SELECT * FROM ingredientes WHERE id = ?', [req.params.id]));
}));
api.delete('/ingredientes/:id', h(async (req, res) => {
  const usos = await all('SELECT DISTINCT r.nombre FROM receta_items i JOIN recetas r ON r.id = i.receta_id WHERE i.ingrediente_id = ?', [req.params.id]);
  if (usos.length) return res.status(400).json({ error: `Se usa en: ${usos.map((u) => u.nombre).join(', ')}. Sacalo de esas recetas primero.` });
  await run('DELETE FROM ingredientes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

async function guardarItems(recetaId, items) {
  await run('DELETE FROM receta_items WHERE receta_id = ?', [recetaId]);
  for (const it of Array.isArray(items) ? items : []) {
    const cant = num(it.cantidad);
    if (!it.ingrediente_id || cant <= 0 || !UNIDADES.includes(it.unidad)) continue;
    await run('INSERT INTO receta_items (receta_id, ingrediente_id, cantidad, unidad) VALUES (?,?,?,?)', [recetaId, Number(it.ingrediente_id), cant, it.unidad]);
  }
}
const datosReceta = (b) => [txt(b.nombre, 120), txt(b.categoria, 60), num(b.porciones, 1) || 1, num(b.minutos), numONull(b.margen), numONull(b.precio), b.activa === false || b.activa === 0 ? 0 : 1, txt(b.notas, 2000)];
async function recetaCompleta(id) {
  const r = await get('SELECT * FROM recetas WHERE id = ?', [id]);
  if (r) r.items = await all('SELECT * FROM receta_items WHERE receta_id = ? ORDER BY id', [id]);
  return r;
}
api.post('/recetas', h(async (req, res) => {
  if (!txt(req.body?.nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  const { id } = await run('INSERT INTO recetas (nombre, categoria, porciones, minutos, margen, precio, activa, notas) VALUES (?,?,?,?,?,?,?,?)', datosReceta(req.body));
  await guardarItems(id, req.body.items);
  res.json(await recetaCompleta(id));
}));
api.put('/recetas/:id', h(async (req, res) => {
  if (!txt(req.body?.nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  await run('UPDATE recetas SET nombre=?, categoria=?, porciones=?, minutos=?, margen=?, precio=?, activa=?, notas=? WHERE id=?', [...datosReceta(req.body), req.params.id]);
  await guardarItems(req.params.id, req.body.items);
  res.json(await recetaCompleta(req.params.id));
}));
api.delete('/recetas/:id', h(async (req, res) => {
  await run('DELETE FROM receta_items WHERE receta_id = ?', [req.params.id]);
  await run('DELETE FROM recetas WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

api.post('/gastos', h(async (req, res) => {
  const { id } = await run('INSERT INTO gastos (nombre, monto) VALUES (?, ?)', [txt(req.body?.nombre, 120) || 'Gasto', num(req.body?.monto)]);
  res.json(await get('SELECT * FROM gastos WHERE id = ?', [id]));
}));
api.put('/gastos/:id', h(async (req, res) => {
  await run('UPDATE gastos SET nombre = ?, monto = ? WHERE id = ?', [txt(req.body?.nombre, 120) || 'Gasto', num(req.body?.monto), req.params.id]);
  res.json(await get('SELECT * FROM gastos WHERE id = ?', [req.params.id]));
}));
api.delete('/gastos/:id', h(async (req, res) => {
  await run('DELETE FROM gastos WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

async function pedidosCon(where, args) {
  const pedidos = await all(`SELECT * FROM pedidos ${where}`, args);
  if (!pedidos.length) return [];
  const items = await all(`SELECT * FROM pedido_items WHERE pedido_id IN (${pedidos.map(() => '?').join(',')}) ORDER BY id`, pedidos.map((p) => p.id));
  const mapa = new Map(pedidos.map((p) => [p.id, (p.items = [])]));
  for (const it of items) mapa.get(it.pedido_id)?.push(it);
  return pedidos;
}
api.get('/pedidos', h(async (req, res) => {
  const { vista = 'activos', desde, hasta } = req.query;
  if (vista === 'activos') return res.json(await pedidosCon("WHERE estado IN ('nuevo','preparando','listo') ORDER BY CASE WHEN entrega = '' THEN creado ELSE entrega END, id", []));
  if (vista === 'por_cobrar') return res.json(await pedidosCon("WHERE pagado = 0 AND estado <> 'cancelado' ORDER BY id DESC", []));
  if (vista === 'rango') return res.json(await pedidosCon('WHERE dia BETWEEN ? AND ? ORDER BY id DESC', [desde || hoy(), hasta || hoy()]));
  res.json(await pedidosCon('ORDER BY id DESC LIMIT 200', []));
}));
api.get('/pedidos/:id', h(async (req, res) => {
  const [p] = await pedidosCon('WHERE id = ?', [req.params.id]);
  p ? res.json(p) : res.status(404).json({ error: 'No existe' });
}));
async function armarPedido(b) {
  const ctx = await contexto();
  const recetas = new Map(ctx.recetas.map((r) => [r.id, r]));
  const items = [];
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const cantidad = num(it.cantidad);
    if (cantidad <= 0) continue;
    const r = recetas.get(Number(it.receta_id));
    const calc = r ? calcularReceta(r, ctx.ingMap, ctx.cfg, ctx.gastosMes) : null;
    items.push({
      receta_id: r ? r.id : null,
      nombre: txt(it.nombre, 120) || r?.nombre || 'Producto',
      cantidad,
      precio: it.precio === undefined || it.precio === '' ? (calc?.precio ?? 0) : num(it.precio),
      costo: it.costo !== undefined && !r ? num(it.costo) : (calc?.porPorcion ?? 0),
      nota: txt(it.nota, 200),
    });
  }
  const envio = num(b.envio);
  const subtotal = items.reduce((s, it) => s + it.precio * it.cantidad, 0);
  const total = subtotal + envio;
  const medio = txt(b.medio_pago, 60) || 'Efectivo';
  const conComision = String(ctx.cfg.medios_comision || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const comision = conComision.includes(medio.toLowerCase()) ? (total * (Number(ctx.cfg.comision) || 0)) / 100 : 0;
  return {
    items,
    campos: {
      cliente: txt(b.cliente, 120), telefono: txt(b.telefono, 40), tipo: b.tipo === 'retiro' ? 'retiro' : 'envio',
      direccion: txt(b.direccion, 200), entrega: txt(b.entrega, 30), notas: txt(b.notas, 1000),
      pagado: b.pagado ? 1 : 0, medio_pago: medio, envio, total,
      costo: items.reduce((s, it) => s + it.costo * it.cantidad, 0), comision,
    },
  };
}
async function guardarPedidoItems(pedidoId, items) {
  await run('DELETE FROM pedido_items WHERE pedido_id = ?', [pedidoId]);
  for (const it of items) {
    await run('INSERT INTO pedido_items (pedido_id, receta_id, nombre, cantidad, precio, costo, nota) VALUES (?,?,?,?,?,?,?)',
      [pedidoId, it.receta_id, it.nombre, it.cantidad, it.precio, it.costo, it.nota]);
  }
}
api.post('/pedidos', h(async (req, res) => {
  const { items, campos } = await armarPedido(req.body || {});
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene productos' });
  const dia = req.dia || hoy();
  const { n } = await get('SELECT COALESCE(MAX(numero), 0) n FROM pedidos WHERE dia = ?', [dia]);
  const t = req.creado || ahora();
  const cols = Object.keys(campos);
  const { id } = await run(`INSERT INTO pedidos (numero, dia, estado, creado, actualizado, ${cols.join(',')}) VALUES (?,?,?,?,?,${cols.map(() => '?').join(',')})`,
    [n + 1, dia, 'nuevo', t, t, ...Object.values(campos)]);
  await guardarPedidoItems(id, items);
  avisar('pedido', { id, nuevo: true });
  const [p] = await pedidosCon('WHERE id = ?', [id]);
  res.json(p);
}));
api.put('/pedidos/:id', h(async (req, res) => {
  const previo = await get('SELECT id FROM pedidos WHERE id = ?', [req.params.id]);
  if (!previo) return res.status(404).json({ error: 'No existe' });
  const { items, campos } = await armarPedido(req.body || {});
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene productos' });
  const cols = Object.keys(campos);
  await run(`UPDATE pedidos SET ${cols.map((c) => `${c} = ?`).join(', ')}, actualizado = ? WHERE id = ?`, [...Object.values(campos), ahora(), req.params.id]);
  await guardarPedidoItems(req.params.id, items);
  avisar('pedido', { id: Number(req.params.id) });
  const [p] = await pedidosCon('WHERE id = ?', [req.params.id]);
  res.json(p);
}));
api.patch('/pedidos/:id', h(async (req, res) => {
  const b = req.body || {};
  if (b.estado !== undefined) {
    if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'Estado inválido' });
    await run('UPDATE pedidos SET estado = ?, actualizado = ? WHERE id = ?', [b.estado, ahora(), req.params.id]);
  }
  if (b.pagado !== undefined) await run('UPDATE pedidos SET pagado = ?, actualizado = ? WHERE id = ?', [b.pagado ? 1 : 0, ahora(), req.params.id]);
  if (b.medio_pago !== undefined) {
    const medio = txt(b.medio_pago, 60) || 'Efectivo';
    const cfg = await leerConfig();
    const conComision = String(cfg.medios_comision || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const pct = conComision.includes(medio.toLowerCase()) ? (Number(cfg.comision) || 0) / 100 : 0;
    await run('UPDATE pedidos SET medio_pago = ?, comision = total * ?, actualizado = ? WHERE id = ?', [medio, pct, ahora(), req.params.id]);
  }
  avisar('pedido', { id: Number(req.params.id) });
  const [p] = await pedidosCon('WHERE id = ?', [req.params.id]);
  p ? res.json(p) : res.status(404).json({ error: 'No existe' });
}));
api.delete('/pedidos/:id', h(async (req, res) => {
  await run('DELETE FROM pedido_items WHERE pedido_id = ?', [req.params.id]);
  await run('DELETE FROM pedidos WHERE id = ?', [req.params.id]);
  avisar('pedido', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

api.get('/resumen', h(async (req, res) => {
  const desde = txt(req.query.desde, 10) || hoy();
  const hasta = txt(req.query.hasta, 10) || hoy();
  const filtro = "dia BETWEEN ? AND ? AND estado <> 'cancelado'";
  const tot = await get(`SELECT COUNT(*) pedidos, COALESCE(SUM(total),0) ventas, COALESCE(SUM(envio),0) envios,
    COALESCE(SUM(costo),0) costo, COALESCE(SUM(comision),0) comision,
    COALESCE(SUM(CASE WHEN pagado = 0 THEN total ELSE 0 END),0) a_cobrar FROM pedidos WHERE ${filtro}`, [desde, hasta]);
  const porDia = await all(`SELECT dia, COUNT(*) pedidos, SUM(total) ventas, SUM(total - envio - costo - comision) ganancia
    FROM pedidos WHERE ${filtro} GROUP BY dia ORDER BY dia`, [desde, hasta]);
  const productos = await all(`SELECT i.nombre, SUM(i.cantidad) cantidad, SUM(i.precio * i.cantidad) ventas,
    SUM((i.precio - i.costo) * i.cantidad - CASE WHEN p.total > 0 THEN p.comision * i.precio * i.cantidad / p.total ELSE 0 END) ganancia FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
    WHERE p.dia BETWEEN ? AND ? AND p.estado <> 'cancelado' GROUP BY i.nombre ORDER BY cantidad DESC`, [desde, hasta]);
  const medios = await all(`SELECT medio_pago, COUNT(*) pedidos, SUM(total) total FROM pedidos WHERE ${filtro} GROUP BY medio_pago ORDER BY total DESC`, [desde, hasta]);
  res.json({ desde, hasta, ...tot, ganancia: tot.ventas - tot.envios - tot.costo - tot.comision, porDia, productos, medios });
}));

api.get('/compras', h(async (req, res) => res.json(await all('SELECT * FROM compras ORDER BY comprado, id'))));
api.post('/compras', h(async (req, res) => {
  if (!txt(req.body?.nombre)) return res.status(400).json({ error: 'Falta el nombre' });
  const { id } = await run('INSERT INTO compras (nombre, cantidad, unidad, ingrediente_id, comprado, creado) VALUES (?,?,?,?,0,?)',
    [txt(req.body.nombre, 120), numONull(req.body.cantidad), txt(req.body.unidad, 20), numONull(req.body.ingrediente_id), ahora()]);
  avisar('compras');
  res.json(await get('SELECT * FROM compras WHERE id = ?', [id]));
}));
api.patch('/compras/:id', h(async (req, res) => {
  const b = req.body || {};
  if (b.comprado !== undefined) await run('UPDATE compras SET comprado = ? WHERE id = ?', [b.comprado ? 1 : 0, req.params.id]);
  if (b.cantidad !== undefined) await run('UPDATE compras SET cantidad = ?, unidad = ? WHERE id = ?', [numONull(b.cantidad), txt(b.unidad, 20), req.params.id]);
  avisar('compras');
  res.json(await get('SELECT * FROM compras WHERE id = ?', [req.params.id]));
}));
api.delete('/compras/comprados', h(async (req, res) => {
  await run('DELETE FROM compras WHERE comprado = 1');
  avisar('compras');
  res.json({ ok: true });
}));
api.delete('/compras/:id', h(async (req, res) => {
  await run('DELETE FROM compras WHERE id = ?', [req.params.id]);
  avisar('compras');
  res.json({ ok: true });
}));
api.post('/compras/calcular', h(async (req, res) => {
  const ctx = await contexto();
  const recetas = new Map(ctx.recetas.map((r) => [r.id, r]));
  let lineas = [];
  if (req.body?.fuente === 'plan') {
    lineas = (req.body.plan || []).map((p) => ({ receta: recetas.get(Number(p.receta_id)), cantidad: num(p.cantidad) }));
  } else {
    const items = await all("SELECT i.receta_id, SUM(i.cantidad) cantidad FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id WHERE p.estado IN ('nuevo','preparando') GROUP BY i.receta_id");
    lineas = items.map((i) => ({ receta: recetas.get(i.receta_id), cantidad: i.cantidad }));
  }
  const nec = necesidades(lineas);
  const resultado = [...nec.entries()].map(([id, base]) => {
    const ing = ctx.ingMap.get(id);
    if (!ing) return null;
    return { ingrediente_id: id, nombre: ing.nombre, categoria: ing.categoria, ...legible(base, ing.unidad) };
  }).filter(Boolean).sort((a, b) => (a.categoria + a.nombre).localeCompare(b.categoria + b.nombre));
  res.json(resultado);
}));

// Recetario: en la app real lo busca el servidor; desde el navegador solo se
// puede consultar Paulina Cocina (Cocineros Argentinos no lo permite).
api.get('/recetario/buscar', h(async (req, res) => {
  const q = txt(req.query.q, 80);
  if (q.length < 3) return res.status(400).json({ error: 'Escribí el nombre del plato' });
  const deco = (s) => { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; };
  try {
    const r = await fetchReal(`https://www.paulinacocina.net/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=12&_fields=link,title`);
    const lista = r.ok ? await r.json() : [];
    res.json({ resultados: lista.map((p) => ({ titulo: deco(p.title.rendered), url: p.link, sitio: 'Paulina Cocina' })), fallaron: ['Cocineros Argentinos'] });
  } catch {
    res.json({ resultados: [], fallaron: ['Cocineros Argentinos', 'Paulina Cocina'] });
  }
}));

// ---------- Datos de ejemplo: "Viandas Doña Rosa" (negocio inventado) ----------
async function sembrar() {
  const cfg = { negocio: 'Viandas Doña Rosa', valor_hora: 3500, porciones_mes: 400, margen: 90, comision: 6.5, redondeo: 100, medios_comision: 'Mercado Pago' };
  for (const [k, v] of Object.entries(cfg)) await run('INSERT INTO config (clave, valor) VALUES (?, ?)', [k, String(v)]);
  const ING = [
    ['Harina 000', 'Almacén', 'kg', 1, 1100, 0], ['Tapas de empanada', 'Almacén', 'u', 12, 2600, 0], ['Masa de tarta (2 discos)', 'Almacén', 'u', 2, 2300, 0],
    ['Huevos', 'Almacén', 'u', 30, 7500, 0], ['Pan rallado', 'Almacén', 'kg', 1, 2400, 0], ['Aceite de girasol', 'Almacén', 'l', 1.5, 4200, 0],
    ['Azúcar', 'Almacén', 'kg', 1, 1300, 0], ['Especias (comino, pimentón)', 'Almacén', 'g', 100, 1500, 0],
    ['Carne picada especial', 'Carnicería', 'kg', 1, 9800, 0], ['Nalga para milanesa', 'Carnicería', 'kg', 1, 12500, 5], ['Pollo (cuarto trasero)', 'Carnicería', 'kg', 1, 4900, 20],
    ['Cebolla', 'Verdulería', 'kg', 1, 1200, 10], ['Morrón rojo', 'Verdulería', 'kg', 1, 4500, 15], ['Papa', 'Verdulería', 'kg', 1, 1100, 15], ['Acelga', 'Verdulería', 'kg', 1, 2200, 30],
    ['Leche', 'Lácteos', 'l', 1, 1500, 0], ['Queso cremoso', 'Lácteos', 'kg', 1, 9000, 0], ['Dulce de leche', 'Lácteos', 'kg', 1, 5200, 0],
    ['Envase descartable con tapa', 'Envases', 'u', 50, 15000, 0],
  ];
  const id = {};
  for (const [nombre, categoria, unidad, cantidad, precio, merma] of ING) {
    const r = await run('INSERT INTO ingredientes (nombre, categoria, unidad, cantidad, precio, merma, actualizado) VALUES (?,?,?,?,?,?,?)', [nombre, categoria, unidad, cantidad, precio, merma, ahora()]);
    id[nombre] = r.id;
  }
  const REC = [
    ['Empanadas de carne (unidad)', 'Empanadas', 12, 60, 'Cortada a cuchillo, con huevo y morrón. Se venden por unidad o docena.',
      [['Tapas de empanada', 12, 'u'], ['Carne picada especial', 500, 'g'], ['Cebolla', 400, 'g'], ['Morrón rojo', 150, 'g'], ['Huevos', 2, 'u'], ['Aceite de girasol', 50, 'ml'], ['Especias (comino, pimentón)', 10, 'g']]],
    ['Tarta de acelga y queso', 'Tartas', 8, 40, '', [['Masa de tarta (2 discos)', 2, 'u'], ['Acelga', 800, 'g'], ['Cebolla', 200, 'g'], ['Huevos', 3, 'u'], ['Queso cremoso', 200, 'g']]],
    ['Milanesa con puré', 'Platos', 4, 50, 'Vianda individual.', [['Nalga para milanesa', 600, 'g'], ['Huevos', 2, 'u'], ['Pan rallado', 200, 'g'], ['Aceite de girasol', 300, 'ml'], ['Papa', 800, 'g'], ['Leche', 100, 'ml'], ['Envase descartable con tapa', 4, 'u']]],
    ['Pollo al horno con papas', 'Platos', 4, 70, 'Vianda individual.', [['Pollo (cuarto trasero)', 1.6, 'kg'], ['Papa', 1, 'kg'], ['Cebolla', 300, 'g'], ['Aceite de girasol', 60, 'ml'], ['Especias (comino, pimentón)', 10, 'g'], ['Envase descartable con tapa', 4, 'u']]],
    ['Pastel de papa', 'Platos', 6, 60, '', [['Carne picada especial', 700, 'g'], ['Papa', 1.2, 'kg'], ['Cebolla', 300, 'g'], ['Huevos', 2, 'u'], ['Leche', 150, 'ml'], ['Queso cremoso', 100, 'g'], ['Envase descartable con tapa', 6, 'u']]],
    ['Flan casero con dulce de leche', 'Postres', 8, 60, '', [['Leche', 1, 'l'], ['Huevos', 6, 'u'], ['Azúcar', 250, 'g'], ['Dulce de leche', 300, 'g']]],
  ];
  const recId = {};
  for (const [nombre, categoria, porciones, minutos, notas, items] of REC) {
    const r = await run('INSERT INTO recetas (nombre, categoria, porciones, minutos, margen, precio, activa, notas) VALUES (?,?,?,?,NULL,NULL,1,?)', [nombre, categoria, porciones, minutos, notas]);
    recId[nombre] = r.id;
    for (const [ing, cant, u] of items) await run('INSERT INTO receta_items (receta_id, ingrediente_id, cantidad, unidad) VALUES (?,?,?,?)', [r.id, id[ing], cant, u]);
  }
  for (const [n, m] of [['Gas', 28000], ['Luz', 22000], ['Publicidad en Instagram', 20000], ['Monotributo', 35000]]) await run('INSERT INTO gastos (nombre, monto) VALUES (?, ?)', [n, m]);

  // Pedidos: dos semanas de historia + los de hoy en distintos estados.
  const CLIENTES = [['Marta G.', '11 5823-1190', 'Rivadavia 14.250, 3° B'], ['Lucas P.', '11 6012-4478', 'Belgrano 233'], ['Sofi R.', '11 3345-9021', 'Av. de Mayo 980, 1° A'],
    ['Don Carlos', '11 4420-7765', 'Alvarado 1520'], ['Vero (oficina)', '11 5998-3310', 'Bolívar 410, piso 2'], ['Familia Pérez', '11 6677-1203', 'Pueyrredón 2711'],
    ['Juli M.', '11 3021-6654', 'Gral. Paz 1890'], ['Ana y Tomi', '11 4789-2211', 'Rosales 655']];
  const MENU = [['Empanadas de carne (unidad)', [6, 12, 12, 24]], ['Tarta de acelga y queso', [1, 2, 4]], ['Milanesa con puré', [1, 2, 3]], ['Pollo al horno con papas', [1, 2]], ['Pastel de papa', [1, 2]], ['Flan casero con dulce de leche', [1, 2]]];
  const MEDIOS = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Transferencia', 'Efectivo'];
  let semilla = 7;
  const azar = (n) => { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor((semilla / 233280) * n); };
  const pedidoAzar = () => {
    const [cliente, telefono, direccion] = CLIENTES[azar(CLIENTES.length)];
    const items = [];
    const cuantos = 1 + azar(2);
    for (let k = 0; k < cuantos; k++) {
      const [receta, cants] = MENU[azar(MENU.length)];
      if (!items.some((i) => i.receta_id === recId[receta])) items.push({ receta_id: recId[receta], cantidad: cants[azar(cants.length)] });
    }
    return { cliente, telefono, direccion, tipo: 'envio', envio: 1500, medio_pago: MEDIOS[azar(MEDIOS.length)], items };
  };
  const hora = (d, h, m) => `${diaDe(d)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  for (let atras = 14; atras >= 1; atras--) {
    const d = new Date(Date.now() - atras * 86400000);
    if (d.getDay() === 1) continue; // los lunes no se cocina
    const cantidad = 3 + azar(4);
    for (let k = 0; k < cantidad; k++) {
      const body = { ...pedidoAzar(), pagado: atras > 2 || azar(3) > 0, entrega: hora(d, 12 + azar(2) * 8, azar(2) * 30) };
      const p = await despachar('POST', '/pedidos', body, { dia: diaDe(d), creado: new Date(d.getTime() - 3 * 3600000).toISOString() });
      await run("UPDATE pedidos SET estado = 'entregado' WHERE id = ?", [p.id]);
    }
  }
  const ahoraD = new Date();
  const estadosHoy = ['listo', 'preparando', 'preparando', 'nuevo', 'nuevo'];
  for (let k = 0; k < estadosHoy.length; k++) {
    const entrega = new Date(ahoraD.getTime() + (k * 35 + 20) * 60000);
    const body = { ...pedidoAzar(), pagado: k % 2 === 0, entrega: hora(entrega, entrega.getHours(), Math.floor(entrega.getMinutes() / 15) * 15), notas: k === 3 ? 'Timbre B, depto 3. Dejar en portería si no atiendo.' : '' };
    const p = await despachar('POST', '/pedidos', body, { creado: new Date(ahoraD.getTime() - (5 - k) * 12 * 60000).toISOString() });
    await run('UPDATE pedidos SET estado = ? WHERE id = ?', [estadosHoy[k], p.id]);
  }
  for (const [nombre, cantidad, unidad, ing] of [['Tapas de empanada', 4, 'docenas', 'Tapas de empanada'], ['Carne picada especial', 2, 'kg', 'Carne picada especial'], ['Servilletas', 2, 'paquetes', null], ['Dulce de leche', 1, 'kg', 'Dulce de leche']]) {
    await run('INSERT INTO compras (nombre, cantidad, unidad, ingrediente_id, comprado, creado) VALUES (?,?,?,?,0,?)', [nombre, cantidad, unidad, ing ? id[ing] : null, ahora()]);
  }
}

// ---------- Atender los pedidos de la app ----------
async function despachar(metodo, url, body, extra = {}) {
  const u = new URL(url, location.origin);
  const ruta = u.pathname.replace(/^.*?\/api/, '') || u.pathname;
  for (const r of rutas) {
    if (r.metodo !== metodo) continue;
    const m = ruta.match(r.re);
    if (!m) continue;
    const req = { params: Object.fromEntries(r.claves.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query: Object.fromEntries(u.searchParams), body, ...extra };
    let estado = 200;
    let datos;
    const res = { status(c) { estado = c; return res; }, json(d) { datos = d; return res; } };
    await r.fn(req, res);
    if (estado >= 400) throw Object.assign(new Error(datos?.error || 'Error'), { estado, datos });
    return datos;
  }
  throw Object.assign(new Error('No encontrado'), { estado: 404, datos: { error: 'No encontrado' } });
}

let listo;
async function iniciar() {
  SQL = await window.initSqlJs({ locateFile: (f) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/${f}` });
  if (!abrirGuardada()) {
    db = new SQL.Database();
    db.exec(ESQUEMA);
    sembrando = true;
    await sembrar();
    sembrando = false;
    guardar();
  }
}

const fetchReal = window.fetch.bind(window);
window.fetch = async (entrada, opciones = {}) => {
  const url = typeof entrada === 'string' ? entrada : entrada.url;
  if (typeof url !== 'string' || !url.startsWith('/api')) return fetchReal(entrada, opciones);
  await listo;
  const metodo = (opciones.method || 'GET').toUpperCase();
  const body = opciones.body ? JSON.parse(opciones.body) : undefined;
  try {
    const datos = await despachar(metodo, url, body);
    if (metodo !== 'GET') {
      guardar();
      const eventos = pendientes.splice(0);
      if (eventos.length) try { localStorage.setItem(CLAVE_EV, JSON.stringify({ eventos, n: Math.random() })); } catch { /* sin almacenamiento */ }
    }
    return new Response(JSON.stringify(datos ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (!e.estado) console.error(e);
    return new Response(JSON.stringify(e.datos ?? { error: 'Error del servidor' }), { status: e.estado || 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Las comandas en vivo de la app (EventSource('/api/eventos')).
const EventSourceReal = window.EventSource;
window.EventSource = class {
  constructor(url) {
    if (!String(url).startsWith('/api')) return new EventSourceReal(url);
    this.onmessage = null;
    oyentes.add(this);
  }
  close() { oyentes.delete(this); }
};

// Reiniciar la demo (botón en la barra de arriba).
window.reiniciarDemo = () => {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
  location.reload();
};

listo = iniciar();

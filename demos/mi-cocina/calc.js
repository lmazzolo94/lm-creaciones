// Cálculos de costos. Lo usan el navegador y el servidor (mismo archivo).

export const UNIDADES = ['kg', 'g', 'l', 'ml', 'u'];
export const FACTOR = { kg: 1000, g: 1, l: 1000, ml: 1, u: 1 };
export const BASE = { kg: 'g', g: 'g', l: 'ml', ml: 'ml', u: 'u' };

export const compatibles = (a, b) => BASE[a] === BASE[b];
export const unidadesPara = (u) => UNIDADES.filter((x) => compatibles(x, u));

// Costo de 1 g / 1 ml / 1 unidad del ingrediente, considerando la merma.
export function costoBase(ing) {
  const cant = (Number(ing.cantidad) || 0) * (FACTOR[ing.unidad] || 1);
  if (!cant) return 0;
  const merma = Math.min(Math.max(Number(ing.merma) || 0, 0), 95) / 100;
  return (Number(ing.precio) || 0) / cant / (1 - merma);
}

export function costoItem(item, ing) {
  if (!ing || !compatibles(item.unidad, ing.unidad)) return 0;
  return (Number(item.cantidad) || 0) * FACTOR[item.unidad] * costoBase(ing);
}

export function redondear(valor, paso) {
  paso = Number(paso) || 0;
  return paso > 0 ? Math.ceil(valor / paso - 1e-9) * paso : Math.round(valor * 100) / 100;
}

export const totalGastos = (gastos) => gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);

// cfg: { valor_hora, porciones_mes, margen, comision, redondeo }
export function calcularReceta(receta, ingMap, cfg, gastosMes) {
  const items = (receta.items || []).map((it) => ({ ...it, costo: costoItem(it, ingMap.get(Number(it.ingrediente_id))) }));
  const ingredientes = items.reduce((s, it) => s + it.costo, 0);
  const manoObra = ((Number(receta.minutos) || 0) / 60) * (Number(cfg.valor_hora) || 0);
  const porciones = Number(receta.porciones) > 0 ? Number(receta.porciones) : 1;
  const fijos = Number(cfg.porciones_mes) > 0 ? gastosMes / Number(cfg.porciones_mes) : 0;
  const lote = ingredientes + manoObra;
  const porPorcion = lote / porciones + fijos;
  const margen = receta.margen === null || receta.margen === undefined || receta.margen === '' ? Number(cfg.margen) || 0 : Number(receta.margen);
  const comision = Math.min(Number(cfg.comision) || 0, 90) / 100;
  const sugerido = redondear((porPorcion * (1 + margen / 100)) / (1 - comision), cfg.redondeo);
  const manual = receta.precio !== null && receta.precio !== undefined && receta.precio !== '';
  const precio = manual ? Number(receta.precio) : sugerido;
  const ganancia = precio * (1 - comision) - porPorcion;
  return {
    items, ingredientes, manoObra, fijos, lote, porciones, porPorcion, margen, sugerido, precio, manual, ganancia,
    comision: precio * comision,
    margenReal: porPorcion > 0 ? (ganancia / porPorcion) * 100 : 0,
  };
}

// lineas: [{ receta, cantidad }] (cantidad en porciones) -> Map(ingrediente_id -> cantidad en unidad base)
export function necesidades(lineas) {
  const tot = new Map();
  for (const { receta, cantidad } of lineas) {
    if (!receta) continue;
    const f = (Number(cantidad) || 0) / (Number(receta.porciones) > 0 ? Number(receta.porciones) : 1);
    for (const it of receta.items || []) {
      const id = Number(it.ingrediente_id);
      tot.set(id, (tot.get(id) || 0) + (Number(it.cantidad) || 0) * (FACTOR[it.unidad] || 1) * f);
    }
  }
  return tot;
}

// Pasa una cantidad en unidad base (g/ml/u) a la unidad más legible.
export function legible(base, unidad) {
  const b = BASE[unidad] || unidad;
  if (b === 'g' && base >= 1000) return { cantidad: Math.round(base / 10) / 100, unidad: 'kg' };
  if (b === 'ml' && base >= 1000) return { cantidad: Math.round(base / 10) / 100, unidad: 'l' };
  return { cantidad: b === 'u' ? Math.ceil(base * 100 - 1e-9) / 100 : Math.ceil(base), unidad: b };
}

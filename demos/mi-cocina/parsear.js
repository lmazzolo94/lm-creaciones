// Convierte una lista de ingredientes pegada ("2 tazas de harina", "½ kg de carne") en cantidades en g / ml / unidades.

export const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const FRACCIONES = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };
const PALABRAS = { un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, docena: 12 };

// Medidas: a qué equivalen en ml (si es líquido) o en g (si es sólido, se ajusta por ingrediente)
const MEDIDAS = [
  { re: /^(kg|kgs|kilo|kilos|kilogramos?)\b/, tipo: 'peso', g: 1000 },
  { re: /^(g|gr|grs|gramos?)\b/, tipo: 'peso', g: 1 },
  { re: /^(l|lt|lts|litros?)\b/, tipo: 'vol', ml: 1000 },
  { re: /^(ml|cc|cm3|mililitros?)\b/, tipo: 'vol', ml: 1 },
  { re: /^(tazas?|tz)\b/, tipo: 'taza', ml: 240 },
  { re: /^(pocillos?)\b/, tipo: 'taza', ml: 100 },
  { re: /^(vasos?)\b/, tipo: 'taza', ml: 200 },
  { re: /^(cucharaditas?|cditas?|cdtas?|cdita|cdta)\b/, tipo: 'cuch', ml: 5 },
  { re: /^(cucharadas?|cdas?|cda)\b/, tipo: 'cuch', ml: 15 },
  { re: /^(pizcas?)\b/, tipo: 'pizca', g: 0.5 },
  { re: /^(chorritos?|chorros?)\b/, tipo: 'vol', ml: 15 },
  { re: /^(dientes?)\b/, tipo: 'peso', g: 5 },
  { re: /^(latas?|paquetes?|sobres?|atados?|planchas?|tapas?|discos?|fetas?|rodajas?|hojas?|ramas?|ramitas?|unidades?|u|un)\b/, tipo: 'u' },
];

// Gramos por taza para sólidos comunes (una cucharada = 1/16 de taza)
const GRAMOS_POR_TAZA = [
  [/harina/, 130], [/azucar impalpable|azucar glas/, 120], [/azucar/, 200], [/arroz/, 190], [/avena/, 90],
  [/cacao/, 100], [/manteca|mantequilla/, 225], [/queso rallado|rallado/, 100], [/pan rallado/, 110],
  [/fecula|maicena|almidon/, 130], [/polenta|semola/, 170], [/coco/, 80], [/nuez|nueces|almendra/, 120],
  [/sal/, 280], [/lenteja|garbanzo|poroto/, 190], [/arveja|choclo/, 150], [/dulce de leche/, 300],
];
const LIQUIDOS = /leche|agua|aceite|crema|caldo|vino|jugo|vinagre|cerveza|salsa de soja|esencia|extracto|licor|ron|coñac|almibar|soda/;
const A_GUSTO = /\b(a gusto|c\/?n|cantidad necesaria|cant nec|lo necesario|opcional)\b/;
const CONDIMENTO = /^(sal|pimienta|oregano|aji molido|pimenton|comino|nuez moscada|perejil|ciboulette|laurel|condimento)/;

function leerNumero(txt) {
  let s = txt.trim();
  let total = 0;
  let usado = '';
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/))) { total = Number(m[1]) + Number(m[2]) / Number(m[3]); usado = m[0]; } // 1 1/2
  else if ((m = s.match(/^(\d+)\s*\/\s*(\d+)/))) { total = Number(m[1]) / Number(m[2]); usado = m[0]; } // 3/4
  else if ((m = s.match(/^(\d+(?:[.,]\d+)?)?\s*([½⅓⅔¼¾⅛])/))) { total = Number((m[1] || '0').replace(',', '.')) + FRACCIONES[m[2]]; usado = m[0]; } // ½, 1½
  else if ((m = s.match(/^\d+(?:[.,]\d+)?/))) { total = Number(m[0].replace(',', '.')); usado = m[0]; } // 2, 1,5
  else {
    const w = s.match(/^(\p{L}+)(?=\s|$)/u);
    const p = w && PALABRAS[normalizar(w[1])];
    if (p) { total = p; usado = w[0]; }
  }
  // "1 y 1/2" / "1 y medio"
  const extra = s.slice(usado.length).match(/^\s*y\s+(medio|media|1\s*\/\s*2|½)(?=\s|$)/);
  if (total && extra) { total += 0.5; usado += extra[0]; }
  // "una docena de huevos" / "media docena"
  const doc = s.slice(usado.length).match(/^\s*docenas?(\s+de)?(?=\s|$)/i);
  if (doc) { total = (total || 1) * 12; usado += doc[0]; }
  else if (usado && PALABRAS[normalizar(usado)] === 12) total = 12;
  return usado ? { valor: total, resto: s.slice(usado.length).trim() } : null;
}

const gramosPorTaza = (nombre) => (GRAMOS_POR_TAZA.find(([re]) => re.test(nombre)) || [null, 200])[1];

function limpiarNombre(s) {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(de|del)\s+/i, '')
    .split(/,|;| - | – |\bpara\b/)[0]
    .replace(/\b(a gusto|c\/?n|cantidad necesaria|opcional)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\p{L}/u, (c) => c.toUpperCase());
}

// Devuelve { nombre, cantidad, unidad (g|ml|u), original, dudoso }
export function parsearLinea(linea) {
  const original = linea.trim();
  let s = original.replace(/^[\s\-•*·–—>]+/, '').replace(/^\d+[.)]\s+(?=\D)/, '').trim();
  if (!s || /:\s*$/.test(s) || /^ingredientes\b/i.test(s)) return null;
  const aGusto = A_GUSTO.test(s.toLowerCase());
  const num = leerNumero(s);
  let cantidad = num ? num.valor : null;
  let resto = num ? num.resto : s;
  let medida = null;
  const rn = normalizar(resto);
  for (const md of MEDIDAS) {
    const mm = rn.match(md.re);
    if (mm) {
      medida = md;
      // sacar la palabra de la medida del texto original
      resto = resto.replace(new RegExp('^\\S+\\.?\\s*', 'u'), '');
      break;
    }
  }
  resto = resto.replace(/^(de|del)\s+/i, '');
  if (medida?.g === 5 && /^dientes?\b/.test(rn)) resto = resto.replace(/^(de|del)\s+/i, '') || 'Ajo';
  const nombre = limpiarNombre(resto) || limpiarNombre(s);
  const n = normalizar(nombre);
  let unidad = 'u';
  let dudoso = false;

  if (cantidad === null) {
    if (medida && medida.tipo === 'pizca') cantidad = 1;
    else if (aGusto || CONDIMENTO.test(n)) { cantidad = CONDIMENTO.test(n) ? 2 : 0; unidad = LIQUIDOS.test(n) ? 'ml' : 'g'; dudoso = !CONDIMENTO.test(n); return { nombre, cantidad, unidad, original, dudoso }; }
    else { cantidad = 1; dudoso = true; }
  }

  if (!medida) unidad = 'u';
  else if (medida.tipo === 'peso') { cantidad *= medida.g; unidad = 'g'; }
  else if (medida.tipo === 'vol') { cantidad *= medida.ml; unidad = 'ml'; }
  else if (medida.tipo === 'pizca') { cantidad *= medida.g; unidad = 'g'; }
  else if (medida.tipo === 'u') unidad = 'u';
  else if (LIQUIDOS.test(n)) { cantidad *= medida.ml; unidad = 'ml'; }
  else {
    // taza o cucharada de un sólido -> gramos según el ingrediente
    const porTaza = gramosPorTaza(n);
    cantidad *= (medida.ml / 240) * porTaza;
    unidad = 'g';
    dudoso = !GRAMOS_POR_TAZA.some(([re]) => re.test(n));
  }
  cantidad = unidad === 'u' ? Math.round(cantidad * 100) / 100 : Math.round(cantidad * 10) / 10;
  return { nombre, cantidad, unidad, original, dudoso };
}

export const parsearLista = (texto) => String(texto || '').split(/\r?\n/).map(parsearLinea).filter(Boolean);

// Busca un ingrediente ya cargado que corresponda al nombre
export function buscarIngrediente(nombre, ingredientes, compatible) {
  const n = normalizar(nombre);
  if (!n) return null;
  const sing = (x) => x.replace(/(es|s)$/, '');
  return ingredientes.find((i) => normalizar(i.nombre) === n)
    || ingredientes.find((i) => sing(normalizar(i.nombre)) === sing(n))
    || ingredientes.find((i) => { const m = normalizar(i.nombre); return compatible(i) && (n.startsWith(m + ' ') || m.startsWith(n + ' ')); })
    || null;
}

import DxfParser from "dxf-parser";

// ---------------------------------------------------------------
// LECTOR DE DXF
//
// Un shop drawing en DXF trae las medidas EXACTAS, no estimadas.
// Aqui se extraen tres cosas:
//   1. Cotas (entidades DIMENSION): el valor medido real
//   2. Textos: leyendas de material y nombres de vista
//   3. Vistas: grupos de geometria separados en el espacio
//
// No adivina el mueble: propone candidatos y tu decides el mapeo.
// ---------------------------------------------------------------

export interface DxfCota {
  valor: number;
  texto?: string;
  x: number;
  y: number;
}

export interface DxfVista {
  nombre: string;
  ancho: number;
  alto: number;
  x: number;
  y: number;
  entidades: number;
}

export interface DxfLectura {
  ok: boolean;
  error?: string;
  unidades: "mm" | "cm" | "m" | "desconocido";
  factorAmm: number;
  cotas: DxfCota[];
  textos: string[];
  vistas: DxfVista[];
  capas: string[];
  totalEntidades: number;
  /** Medidas candidatas ordenadas de mayor a menor, ya en mm */
  candidatos: number[];
  /** Las mismas medidas, sabiendo de donde salio cada una */
  candidatosDetalle: { valor: number; fuente: "cota" | "texto" | "vista" }[];
  notas: string[];
}

interface Pt {
  x?: number;
  y?: number;
  z?: number;
}

interface Ent {
  type?: string;
  layer?: string;
  vertices?: Pt[];
  center?: Pt;
  radius?: number;
  position?: Pt;
  text?: string;
  measurement?: number;
  actualMeasurement?: number;
  startPoint?: Pt;
  endPoint?: Pt;
  [k: string]: unknown;
}

const UNIT_FACTOR: Record<number, { u: DxfLectura["unidades"]; f: number }> = {
  1: { u: "mm", f: 25.4 }, // pulgadas
  4: { u: "mm", f: 1 },
  5: { u: "cm", f: 10 },
  6: { u: "m", f: 1000 },
};

export function leerDxf(contenido: string): DxfLectura {
  const base: DxfLectura = {
    ok: false,
    unidades: "desconocido",
    factorAmm: 1,
    cotas: [],
    textos: [],
    vistas: [],
    capas: [],
    totalEntidades: 0,
    candidatos: [],
    candidatosDetalle: [],
    notas: [],
  };

  let dxf: { entities?: Ent[]; header?: Record<string, unknown>; tables?: Record<string, unknown> };
  try {
    const parser = new DxfParser();
    dxf = parser.parseSync(contenido) as unknown as typeof dxf;
  } catch (e) {
    return { ...base, error: `No se pudo leer el DXF: ${String(e).slice(0, 160)}` };
  }

  const entities = dxf?.entities ?? [];
  if (!entities.length) {
    return { ...base, error: "El DXF no contiene entidades de dibujo." };
  }

  // ---- Unidades ----
  const insunits = Number(dxf?.header?.["$INSUNITS"] ?? 0);
  let unidades: DxfLectura["unidades"] = "desconocido";
  let factor = 1;
  if (UNIT_FACTOR[insunits]) {
    unidades = UNIT_FACTOR[insunits].u;
    factor = UNIT_FACTOR[insunits].f;
  }

  // ---- Recorrido de entidades ----
  const cotas: DxfCota[] = [];
  const textos: string[] = [];
  const capas = new Set<string>();
  const puntos: { x: number; y: number }[] = [];

  for (const e of entities) {
    if (e.layer) capas.add(e.layer);
    const t = (e.type ?? "").toUpperCase();

    if (t === "DIMENSION") {
      const v = Number(e.actualMeasurement ?? e.measurement ?? 0);
      const p = (e.position ?? e.startPoint ?? {}) as Pt;
      if (Number.isFinite(v) && Math.abs(v) > 0.0001) {
        cotas.push({
          valor: Math.abs(v),
          texto: typeof e.text === "string" ? e.text : undefined,
          x: Number(p.x ?? 0),
          y: Number(p.y ?? 0),
        });
      }
      // El texto de la cota puede traer el valor cuando measurement viene vacio
      if (typeof e.text === "string" && e.text.trim()) textos.push(e.text.trim());
      continue;
    }

    if (t === "TEXT" || t === "MTEXT" || t === "ATTRIB") {
      const s = typeof e.text === "string" ? limpiarMtext(e.text) : "";
      if (s) textos.push(s);
      const p = (e.position ?? e.startPoint ?? {}) as Pt;
      if (p.x != null && p.y != null) puntos.push({ x: Number(p.x), y: Number(p.y) });
      continue;
    }

    // Geometria: se acumulan puntos para detectar vistas.
    // Se muestrea A LO LARGO de cada segmento, no solo las esquinas,
    // para que un contorno forme una region continua.
    if (Array.isArray(e.vertices) && e.vertices.length > 1) {
      const vs = e.vertices.filter((v) => v?.x != null && v?.y != null);
      const cerrado = e.shape === true || t === "LWPOLYLINE";
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i];
        const b = vs[(i + 1) % vs.length];
        if (i === vs.length - 1 && !cerrado) break;
        muestrear(puntos, Number(a.x), Number(a.y), Number(b.x), Number(b.y));
      }
    } else if (Array.isArray(e.vertices)) {
      for (const v of e.vertices) {
        if (v?.x != null && v?.y != null) puntos.push({ x: Number(v.x), y: Number(v.y) });
      }
    }
    if (e.startPoint?.x != null && e.endPoint?.x != null) {
      muestrear(
        puntos,
        Number(e.startPoint.x),
        Number(e.startPoint.y ?? 0),
        Number(e.endPoint.x),
        Number(e.endPoint.y ?? 0)
      );
    } else if (e.startPoint?.x != null) {
      puntos.push({ x: Number(e.startPoint.x), y: Number(e.startPoint.y ?? 0) });
    }
    if (e.center?.x != null && e.radius) {
      const r = Number(e.radius);
      const cx = Number(e.center.x);
      const cy = Number(e.center.y ?? 0);
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        puntos.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
      }
    }
  }

  // ---- Si no hay unidades declaradas, se infiere por la escala del dibujo ----
  const notas: string[] = [];
  if (unidades === "desconocido") {
    const ext = extension(puntos);
    const mayor = Math.max(ext.w, ext.h, ...cotas.map((c) => c.valor));
    if (mayor > 0 && mayor < 12) {
      unidades = "m";
      factor = 1000;
      notas.push("No habia unidades declaradas. Por la escala del dibujo se asumieron metros.");
    } else if (mayor >= 12 && mayor < 400) {
      unidades = "cm";
      factor = 10;
      notas.push("No habia unidades declaradas. Por la escala del dibujo se asumieron centimetros.");
    } else {
      unidades = "mm";
      factor = 1;
      notas.push("No habia unidades declaradas. Se asumieron milimetros.");
    }
  }

  // ---- Deteccion de vistas por agrupacion espacial ----
  const vistas = detectarVistas(puntos, factor);
  for (const v of vistas) {
    v.nombre = nombrarVista(v, textos);
  }

  // ---- Candidatos de medida ----
  const cotasMm = cotas.map((c) => redondear(c.valor * factor));
  const desdeVistas: number[] = [];
  for (const v of vistas) {
    desdeVistas.push(redondear(v.ancho), redondear(v.alto));
  }
  // Tambien se leen medidas escritas como texto: "0.50 m", "500 mm", "45 cm"
  const desdeTexto = textos.flatMap(medidasEnTexto);

  const detalle: { valor: number; fuente: "cota" | "texto" | "vista" }[] = [];
  const vistos = new Set<number>();
  const agregar = (v: number, fuente: "cota" | "texto" | "vista") => {
    if (v < 20 || v > 4000 || vistos.has(v)) return;
    vistos.add(v);
    detalle.push({ valor: v, fuente });
  };
  // Orden de confianza: cota medida > medida escrita > tamano de vista
  for (const v of cotasMm) agregar(v, "cota");
  for (const v of desdeTexto) agregar(v, "texto");
  for (const v of desdeVistas) agregar(v, "vista");
  detalle.sort((a, b) => b.valor - a.valor);
  const candidatos = detalle.map((d) => d.valor);

  if (cotas.length === 0) {
    notas.push(
      "El DXF no trae cotas (entidades DIMENSION). Las medidas se tomaron del tamano de las vistas, que puede incluir margenes."
    );
  }

  return {
    ok: true,
    unidades,
    factorAmm: factor,
    cotas: cotas.map((c) => ({ ...c, valor: redondear(c.valor * factor) })),
    textos: [...new Set(textos)].slice(0, 60),
    vistas,
    capas: [...capas],
    totalEntidades: entities.length,
    candidatos,
    candidatosDetalle: detalle,
    notas,
  };
}

// ---------------------------------------------------------------

function limpiarMtext(s: string): string {
  return s
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\P/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Agrega puntos intermedios a lo largo de un segmento. */
function muestrear(
  dst: { x: number; y: number }[],
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.min(120, Math.ceil(d / 8)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    dst.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
  }
}

function redondear(v: number): number {
  return Math.round(v * 10) / 10;
}

function extension(pts: { x: number; y: number }[]) {
  if (!pts.length) return { w: 0, h: 0, x0: 0, y0: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { w: 0, h: 0, x0: 0, y0: 0 };
  return { w: x1 - x0, h: y1 - y0, x0, y0 };
}

/**
 * Agrupa los puntos en vistas. Un shop drawing suele traer planta, alzado
 * frontal y alzado lateral separados por espacio en blanco.
 */
function detectarVistas(pts: { x: number; y: number }[], factor: number): DxfVista[] {
  const validos = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (validos.length < 4) return [];

  const ext = extension(validos);
  const escala = Math.max(ext.w, ext.h);
  if (escala <= 0) return [];

  // Rejilla de ocupacion: celdas contiguas ocupadas forman una vista
  const N = 48;
  const cw = ext.w / N || 1;
  const ch = ext.h / N || 1;
  const grid = new Map<string, { n: number }>();
  for (const p of validos) {
    const gx = Math.min(N - 1, Math.floor((p.x - ext.x0) / cw));
    const gy = Math.min(N - 1, Math.floor((p.y - ext.y0) / ch));
    const k = `${gx},${gy}`;
    grid.set(k, { n: (grid.get(k)?.n ?? 0) + 1 });
  }

  const visitados = new Set<string>();
  const grupos: { gx: number; gy: number }[][] = [];
  for (const k of grid.keys()) {
    if (visitados.has(k)) continue;
    const grupo: { gx: number; gy: number }[] = [];
    const cola = [k];
    visitados.add(k);
    while (cola.length) {
      const cur = cola.pop()!;
      const [cx, cy] = cur.split(",").map(Number);
      grupo.push({ gx: cx, gy: cy });
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cx + dx},${cy + dy}`;
          if (grid.has(nk) && !visitados.has(nk)) {
            visitados.add(nk);
            cola.push(nk);
          }
        }
      }
    }
    grupos.push(grupo);
  }

  const vistas: DxfVista[] = [];
  for (const g of grupos) {
    if (g.length < 3) continue;
    const gx0 = Math.min(...g.map((c) => c.gx));
    const gx1 = Math.max(...g.map((c) => c.gx));
    const gy0 = Math.min(...g.map((c) => c.gy));
    const gy1 = Math.max(...g.map((c) => c.gy));
    const w = (gx1 - gx0 + 1) * cw * factor;
    const h = (gy1 - gy0 + 1) * ch * factor;
    if (w < 20 || h < 20) continue;
    vistas.push({
      nombre: "Vista",
      ancho: redondear(w),
      alto: redondear(h),
      x: redondear((ext.x0 + gx0 * cw) * factor),
      y: redondear((ext.y0 + gy0 * ch) * factor),
      entidades: g.length,
    });
  }

  return vistas.sort((a, b) => b.ancho * b.alto - a.ancho * a.alto).slice(0, 6);
}

function nombrarVista(v: DxfVista, textos: string[]): string {
  const t = textos.map((s) => s.toLowerCase()).join(" ");
  const rel = v.alto / Math.max(1, v.ancho);
  if (/planta/.test(t) && rel > 0.6 && rel < 1.6) return "Posible planta";
  if (rel > 0.9) return "Posible alzado";
  return "Vista";
}

/** Encuentra medidas escritas en texto y las convierte a mm. */
export function medidasEnTexto(s: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const v = parseFloat(m[1].replace(",", "."));
    const u = m[2].toLowerCase();
    if (!Number.isFinite(v)) continue;
    const mm = u === "mm" ? v : u === "cm" ? v * 10 : v * 1000;
    if (mm >= 20 && mm <= 4000) out.push(redondear(mm));
  }
  return out;
}

/**
 * Propone ancho, alto y profundidad a partir de la lectura.
 * Heuristica conservadora: se queda con los tres candidatos mas grandes
 * que sean distintos entre si. Siempre se muestran para confirmar.
 */
export function proponerEnvolvente(l: DxfLectura): {
  ancho?: number;
  alto?: number;
  prof?: number;
  razon: string;
} {
  // Si el dibujo trae cotas medidas, se usan SOLO esas: son exactas.
  // El tamano de las vistas es una estimacion y solo sirve de respaldo.
  const exactas = l.candidatosDetalle
    .filter((d) => d.fuente !== "vista" && d.valor >= 100)
    .map((d) => d.valor);
  const fuente = exactas.length >= 3 ? exactas : l.candidatos.filter((v) => v >= 100);

  if (fuente.length === 0) {
    return { razon: "No se encontraron medidas utilizables en el archivo." };
  }

  // Se descartan duplicados cercanos
  const distintos: number[] = [];
  for (const v of fuente) {
    if (!distintos.some((d) => Math.abs(d - v) < Math.max(8, d * 0.03))) distintos.push(v);
    if (distintos.length >= 4) break;
  }

  // El alto suele venir del alzado: la vista mas vertical
  const alzados = l.vistas.filter((v) => v.alto >= v.ancho * 0.8);
  const altoVista = alzados.length ? Math.max(...alzados.map((v) => v.alto)) : undefined;
  const alto =
    altoVista !== undefined
      ? distintos.find((d) => Math.abs(d - altoVista) < Math.max(25, altoVista * 0.06)) ??
        distintos[0]
      : distintos[0];

  const resto = distintos.filter((d) => d !== alto);

  return {
    alto,
    ancho: resto[0],
    prof: resto[1],
    razon:
      exactas.length >= 3
        ? `Medidas tomadas de ${l.cotas.length} cota(s) del dibujo. Revisa el mapeo antes de generar.`
        : "El dibujo no traia cotas suficientes; se estimo desde el tamano de las vistas. Revisa con cuidado.",
  };
}

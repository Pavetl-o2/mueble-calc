import DxfParser from "dxf-parser";

// ---------------------------------------------------------------
// LECTOR DE DXF DE CORTE (modulo CNC)
//
// Este lector NO es el de shop drawings (lib/dxf.ts). Aquel busca cotas
// y vistas para proponer tres medidas. Este asume lo contrario: que el
// archivo trae las PIEZAS ya despiezadas y acomodadas para nesting, que
// es lo que sale de un CAM o de un diseno flat-pack.
//
// Lo que hace:
//   1. Encadena los fragmentos sueltos (lineas, arcos, polilineas) en
//      contornos cerrados. Un CAM parte el contorno en muchas entidades.
//   2. Decide que contorno es pieza y cual es hueco, por anidamiento.
//   3. Mide area y perimetro REALES, no la caja envolvente.
//   4. Infiere el espesor del material a partir del ancho de las mortajas.
//
// La regla de oro del proyecto se mantiene: de aqui sale una lista de
// piezas, y la geometria 3D se deriva de ella.
// ---------------------------------------------------------------

export type Pt = [number, number];

export interface ContornoCnc {
  id: string;
  /** Contorno exterior, cerrado (el ultimo punto repite el primero). */
  ext: Pt[];
  /** Contornos interiores: mortajas, barrenos, calados. */
  huecos: Pt[][];
  /** Area neta en mm2, ya descontando los huecos. */
  areaMm2: number;
  /** Perimetro exterior en mm. Es el canto que se ve. */
  perimetroMm: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Lado mayor y menor de la caja envolvente, en mm. */
  largo: number;
  ancho: number;
}

export interface RanuraCnc {
  /** Ancho de la ranura en mm. Con espiga perpendicular es el espesor. */
  ancho: number;
  /** Cuantas veces aparece esa medida en el archivo. */
  veces: number;
  /**
   * Angulo implicito si la ranura fuera espesor/cos(t). Solo tiene
   * sentido cuando el ancho es mayor que el espesor inferido.
   */
  anguloGrados?: number;
}

export interface LecturaCnc {
  ok: boolean;
  error?: string;
  piezas: ContornoCnc[];
  /** Contornos descartados por ser demasiado chicos para ser pieza. */
  descartados: number;
  /** Espesor mas probable del material, en mm. */
  espesor?: number;
  /** Anchos de ranura encontrados, de mas a menos frecuente. */
  ranuras: RanuraCnc[];
  /** Extremos que no cerraron. Si hay muchos, el archivo viene sucio. */
  extremosSueltos: number;
  totalEntidades: number;
  notas: string[];
}

interface Ent {
  type?: string;
  vertices?: { x?: number; y?: number }[];
  startPoint?: { x?: number; y?: number };
  endPoint?: { x?: number; y?: number };
  center?: { x?: number; y?: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  angleLength?: number;
  controlPoints?: { x?: number; y?: number }[];
  fitPoints?: { x?: number; y?: number }[];
  shape?: boolean;
  [k: string]: unknown;
}

/** Tolerancia para considerar que dos extremos son el mismo punto. */
const TOL = 0.05;
/** Un contorno menor a esto no se considera pieza. */
const AREA_MIN_MM2 = 400;

// ---------------------------------------------------------------

export function leerCorteDxf(contenido: string): LecturaCnc {
  const base: LecturaCnc = {
    ok: false,
    piezas: [],
    descartados: 0,
    ranuras: [],
    extremosSueltos: 0,
    totalEntidades: 0,
    notas: [],
  };

  let dxf: { entities?: Ent[] };
  try {
    dxf = new DxfParser().parseSync(contenido) as unknown as { entities?: Ent[] };
  } catch (e) {
    return { ...base, error: `No se pudo leer el DXF: ${String(e).slice(0, 160)}` };
  }

  const entities = dxf?.entities ?? [];
  if (!entities.length) return { ...base, error: "El DXF no contiene entidades de dibujo." };

  // ---- 1) Entidades -> polilineas sueltas ----
  const trazos: Pt[][] = [];
  for (const e of entities) {
    for (const t of aTrazos(e)) if (t.length >= 2) trazos.push(t);
  }
  if (!trazos.length) {
    return {
      ...base,
      totalEntidades: entities.length,
      error: "El DXF no trae geometria encadenable (lineas, arcos o polilineas).",
    };
  }

  // ---- 2) Encadenar en contornos cerrados ----
  const { lazos, sueltos } = encadenar(trazos);

  // ---- 3) Medir y clasificar pieza vs hueco ----
  const medidos = lazos
    .map((l, i) => ({ id: `c${i}`, pts: l, area: areaPoligono(l), bbox: bboxDe(l) }))
    .filter((m) => m.area >= AREA_MIN_MM2)
    .sort((a, b) => b.area - a.area);

  const descartados = lazos.length - medidos.length;

  // Un contorno dentro de otro es hueco. Dentro de un hueco vuelve a ser
  // pieza (una isla), asi que se cuenta la profundidad de anidamiento.
  const profundidad = medidos.map((m) =>
    medidos.filter((o) => o !== m && o.area > m.area && contiene(o.pts, m.pts[0])).length
  );

  const piezas: ContornoCnc[] = [];
  medidos.forEach((m, i) => {
    if (profundidad[i] % 2 !== 0) return; // es hueco de alguien
    const huecos = medidos
      .filter((o, j) => profundidad[j] === profundidad[i] + 1 && contiene(m.pts, o.pts[0]))
      .map((o) => o.pts);
    const areaHuecos = huecos.reduce((a, h) => a + areaPoligono(h), 0);
    const b = m.bbox;
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    piezas.push({
      id: m.id,
      ext: m.pts,
      huecos,
      areaMm2: r2(m.area - areaHuecos),
      perimetroMm: r2(perimetro(m.pts)),
      bbox: b,
      largo: r2(Math.max(w, h)),
      ancho: r2(Math.min(w, h)),
    });
  });

  // ---- 4) Espesor a partir del ancho de las mortajas ----
  const { espesor, ranuras, notas } = inferirEspesor(piezas);

  if (sueltos > 0) {
    notas.push(
      `${sueltos} extremo(s) no cerraron contorno. Revisa que el dibujo no tenga lineas sueltas o duplicadas.`
    );
  }
  if (!piezas.length) {
    return {
      ...base,
      totalEntidades: entities.length,
      extremosSueltos: sueltos,
      error: "No se encontro ningun contorno cerrado. Este lector espera piezas de corte cerradas.",
    };
  }

  return {
    ok: true,
    piezas,
    descartados,
    espesor,
    ranuras,
    extremosSueltos: sueltos,
    totalEntidades: entities.length,
    notas,
  };
}

// ---------------------------------------------------------------
// Entidades -> trazos
// ---------------------------------------------------------------

function aTrazos(e: Ent): Pt[][] {
  const t = (e.type ?? "").toUpperCase();
  const pt = (p?: { x?: number; y?: number }): Pt | null =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [Number(p.x), Number(p.y)] : null;

  if (t === "CIRCLE" && e.center && e.radius) {
    return [tesela(Number(e.center.x ?? 0), Number(e.center.y ?? 0), Number(e.radius), 0, Math.PI * 2)];
  }

  if (t === "ARC" && e.center && e.radius) {
    const a0 = ((Number(e.startAngle ?? 0) % 360) * Math.PI) / 180;
    let a1 = ((Number(e.endAngle ?? 0) % 360) * Math.PI) / 180;
    if (a1 <= a0) a1 += Math.PI * 2;
    return [tesela(Number(e.center.x ?? 0), Number(e.center.y ?? 0), Number(e.radius), a0, a1)];
  }

  if (Array.isArray(e.vertices) && e.vertices.length >= 2) {
    const vs = e.vertices.map(pt).filter((p): p is Pt => p !== null);
    if (vs.length < 2) return [];
    // Una polilinea marcada cerrada trae implicito el tramo final.
    if (e.shape === true && dist(vs[0], vs[vs.length - 1]) > TOL) vs.push(vs[0]);
    return [vs];
  }

  const a = pt(e.startPoint);
  const b = pt(e.endPoint);
  if (a && b) return [[a, b]];

  // Splines: se aproximan por sus puntos de ajuste o de control.
  const sp = (e.fitPoints ?? e.controlPoints ?? []).map(pt).filter((p): p is Pt => p !== null);
  if (sp.length >= 2) return [sp];

  return [];
}

function tesela(cx: number, cy: number, r: number, a0: number, a1: number): Pt[] {
  const span = a1 - a0;
  const n = Math.max(8, Math.min(180, Math.ceil((Math.abs(span) * r) / 3)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (span * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// ---------------------------------------------------------------
// Encadenado
// ---------------------------------------------------------------

const clave = (p: Pt) => `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`;

/**
 * Une los trazos por sus extremos hasta cerrar lazos. Un CAM suele
 * exportar cada tramo como entidad aparte, asi que sin esto cada pieza
 * se leeria como decenas de fragmentos.
 */
function encadenar(trazos: Pt[][]): { lazos: Pt[][]; sueltos: number } {
  const porNodo = new Map<string, number[]>();
  trazos.forEach((t, i) => {
    for (const p of [t[0], t[t.length - 1]]) {
      const k = clave(p);
      if (!porNodo.has(k)) porNodo.set(k, []);
      porNodo.get(k)!.push(i);
    }
  });

  const usado = new Array(trazos.length).fill(false);
  const lazos: Pt[][] = [];
  let sueltos = 0;

  for (let i = 0; i < trazos.length; i++) {
    if (usado[i]) continue;
    usado[i] = true;
    let cadena = [...trazos[i]];

    // Se extiende por la cola hasta cerrar o quedarse sin vecinos.
    for (let guard = 0; guard < trazos.length + 2; guard++) {
      if (dist(cadena[0], cadena[cadena.length - 1]) <= TOL) break;
      const cola = cadena[cadena.length - 1];
      const cand = (porNodo.get(clave(cola)) ?? []).filter((j) => !usado[j]);
      if (!cand.length) break;
      const j = cand[0];
      usado[j] = true;
      const s = [...trazos[j]];
      if (dist(s[s.length - 1], cola) <= TOL) s.reverse();
      cadena = cadena.concat(s.slice(1));
    }

    if (dist(cadena[0], cadena[cadena.length - 1]) <= TOL) {
      lazos.push(cadena);
    } else {
      sueltos += 1;
    }
  }

  return { lazos, sueltos };
}

// ---------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------

function dist(a: Pt, b: Pt) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function areaPoligono(l: Pt[]): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const [x1, y1] = l[i];
    const [x2, y2] = l[(i + 1) % l.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function perimetro(l: Pt[]): number {
  let p = 0;
  for (let i = 0; i < l.length - 1; i++) p += dist(l[i], l[i + 1]);
  return p;
}

function bboxDe(l: Pt[]) {
  const xs = l.map((p) => p[0]);
  const ys = l.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Punto dentro de poligono, por cruce de rayo. */
function contiene(poly: Pt[], p: Pt): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------
// Analisis del canto superior
//
// Lo usan tanto la orientacion como la deteccion de espigas, y por eso
// vive aqui: si cada una lo resolviera por su cuenta podrian discrepar
// sobre cual canto es el de union.
// ---------------------------------------------------------------

/** Tramos de material que corta una horizontal a la altura y. */
export function tramosEn(pts: Pt[], y: number): [number, number][] {
  const cortes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    if (ay > y !== by > y) cortes.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
  }
  cortes.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cortes.length; i += 2) out.push([cortes[i], cortes[i + 1]]);
  return out;
}

export interface Canto {
  /** Altura del hombro: donde el material se ensancha de golpe. */
  hombro: number;
  /** Cuanto sobresalen las espigas por encima del hombro. */
  vuelo: number;
  /** Tramos de las espigas, medidos a media altura. */
  salientes: [number, number][];
  /** Cuanto se ensancha al pasar el hombro. 1 = canto liso, sin espigas. */
  salto: number;
  /**
   * Cuanto material hay a la altura del hombro, en mm.
   *
   * Es lo que dice si el canto es de verdad la union de la pieza o solo
   * una esquina que casualmente parece espiga: la linea de hombro de un
   * faldon de mesa mide casi todo su largo, la de un recorte cualquiera
   * unos milimetros.
   */
  anchoHombro: number;
}

/**
 * Busca espigas en el canto SUPERIOR de un contorno ya orientado.
 *
 * Bajando desde el borde de arriba, el material cubierto da un salto al
 * pasar el hombro: encima solo estan las espigas, debajo el cuerpo
 * entero. Si no hay salto, el canto es liso y no tiene espigas.
 */
export function analizarCanto(pts: Pt[], espesor?: number): Canto | null {
  const ys = pts.map((p) => p[1]);
  const yMax = Math.max(...ys);
  const alto = yMax - Math.min(...ys);
  if (alto <= 0) return null;

  const cubierto = (t: [number, number][]) => t.reduce((a, [p, q]) => a + (q - p), 0);
  const arriba = tramosEn(pts, yMax - Math.max(0.5, alto * 0.002));
  const base = cubierto(arriba);
  if (!arriba.length || base <= 0) return null;

  const paso = Math.max(0.5, alto / 400);
  for (let d = paso; d < alto * 0.35; d += paso) {
    const ancho = cubierto(tramosEn(pts, yMax - d));
    if (ancho > base * 2.5) {
      const hombro = yMax - d;
      const vuelo = d;
      let salientes = tramosEn(pts, hombro + vuelo / 2);

      // Filtro de sensatez. Sin el, cualquier muesca o redondeo del canto
      // pasa por espiga: en una silla salian "espigas" de 0.8 mm con 4 mm
      // de vuelo sobre tablero de 18. Una espiga real es al menos tan
      // ancha como el tablero y sobresale lo que tenga que atravesar.
      if (espesor && espesor > 0) {
        salientes = salientes.filter(([a, b]) => b - a >= espesor * 0.6);
        if (!salientes.length || vuelo < espesor * 0.35) return null;
      }

      return { hombro, vuelo, salientes, salto: ancho / base, anchoHombro: ancho };
    }
  }
  return null;
}

// ---------------------------------------------------------------
// Espesor
// ---------------------------------------------------------------

/**
 * El espesor sale del ancho de las mortajas, no del contorno exterior.
 * Una espiga que entra perpendicular deja una ranura del ancho exacto
 * del tablero; una que entra en angulo la deja mas ancha, por
 * espesor/cos(angulo). Por eso el espesor es el MENOR de los anchos de
 * ranura repetidos, y los mayores delatan el angulo de armado.
 */
function inferirEspesor(piezas: ContornoCnc[]): {
  espesor?: number;
  ranuras: RanuraCnc[];
  notas: string[];
} {
  const notas: string[] = [];
  const anchos: number[] = [];

  for (const p of piezas) {
    for (const h of p.huecos) {
      // El ancho de una mortaja es la menor de sus aristas rectas
      // repetidas: en una cruz son los brazos, en una ranura los lados.
      const rectas = aristasRectas(h);
      if (!rectas.length) continue;
      const min = Math.min(...rectas);
      if (min >= 3 && min <= 60) anchos.push(Math.round(min * 10) / 10);
      // Una cruz tiene dos anchos distintos: se toman ambos.
      const otro = rectas.find((v) => v > min * 1.15 && v <= 60);
      if (otro) anchos.push(Math.round(otro * 10) / 10);
    }
  }

  if (!anchos.length) {
    notas.push(
      "No se detectaron mortajas, asi que no se pudo inferir el espesor. Escribelo a mano."
    );
    return { ranuras: [], notas };
  }

  const cuenta = new Map<number, number>();
  for (const a of anchos) {
    // Se agrupan a 0.5mm para absorber el ruido del teselado.
    const k = Math.round(a * 2) / 2;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }

  const ordenado = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const espesor = Math.min(...ordenado.map(([v]) => v));

  const ranuras: RanuraCnc[] = ordenado.map(([ancho, veces]) => {
    const rel = espesor / ancho;
    return {
      ancho,
      veces,
      anguloGrados:
        ancho > espesor * 1.05 && rel <= 1
          ? Math.round(Math.acos(rel) * (180 / Math.PI) * 10) / 10
          : undefined,
    };
  });

  notas.push(
    `Espesor inferido del ancho de las mortajas: ${espesor} mm. Confirmalo contra tu tablero real.`
  );
  const angulares = ranuras.filter((r) => r.anguloGrados);
  if (angulares.length) {
    notas.push(
      `Hay mortajas mas anchas que el espesor (${angulares
        .map((a) => `${a.ancho} mm, equivalente a ${a.anguloGrados}°`)
        .join("; ")}). Eso dice que la ESPIGA entra en angulo, no que el tablero vaya inclinado: ` +
        `en flat-pack casi siempre se consigue cortando el hombro en diagonal con la pieza a plomo. ` +
        `Por eso el armado arranca con apertura 0; subela si tu diseno de verdad lleva las piezas inclinadas.`
    );
  }

  return { espesor, ranuras, notas };
}

/** Longitudes de las aristas rectas de un contorno, ignorando el teselado. */
function aristasRectas(l: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < l.length - 1; i++) {
    const d = dist(l[i], l[i + 1]);
    if (d > 1.5) out.push(d);
  }
  return out;
}

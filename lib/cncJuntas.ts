import type { ContornoCnc, Pt } from "./cnc";

// ---------------------------------------------------------------
// JUNTAS
//
// Lee, de cada contorno, las features con las que la pieza se une a
// otra. Es la capa que faltaba: hasta ahora solo se reconocia una
// familia -espigas en el canto de ARRIBA que entran en mortajas
// interiores del panel- y con eso alcanza para una mesa de faldones,
// pero no para nada mas. Una silla se arma con espigas en los cuatro
// cantos, cajas abiertas en las puntas y ranuras pasantes en los
// costados, y de todo eso el detector viejo no veia nada.
//
// Aqui no hay heuristica de "que pieza es cual". Una junta es una
// medida, y dos medidas iguales encajan. Eso es lo que permite que el
// armado salga del dibujo en vez de adivinarse.
// ---------------------------------------------------------------

/**
 * Familias de junta que se reconocen.
 *
 *   espiga  saliente rectangular del contorno; es lo que ENTRA.
 *   caja    entrante rectangular abierto al canto; recibe por el borde.
 *   ranura  hueco interior pasante; recibe por la cara.
 */
export type TipoJunta = "espiga" | "caja" | "ranura";

export interface Junta {
  piezaId: string;
  tipo: TipoJunta;
  /** Medida a lo largo de la junta. Es la que tiene que coincidir. */
  largo: number;
  /**
   * Cuanto sobresale la espiga, o cuanto entra la caja. En una junta
   * enrasada vale el espesor del tablero contrario.
   */
  fondo: number;
  /**
   * Centro de la junta a MEDIA PROFUNDIDAD, en coordenadas de la pieza.
   * Es el punto que coincide con el de su pareja: el plano medio del
   * tablero que la recibe pasa justo por ahi.
   */
  centro: Pt;
  /** Unitario a lo largo de la junta, en coordenadas de la pieza. */
  eje: Pt;
  /**
   * Unitario perpendicular al eje y hacia AFUERA del cuerpo: por donde
   * sale la espiga o por donde entra la caja. Una ranura interior no
   * tiene, porque se entra por la cara y no por el canto.
   */
  normal: Pt;
  /** Para poder nombrarla en pantalla. */
  etiqueta: string;
}

/** Tolerancia al comparar medidas de junta, en mm. */
export const TOL_JUNTA = 3;

/**
 * Cuanto se puede alejar el contorno simplificado del original, en mm.
 *
 * Los archivos de CAM traen las esquinas redondeadas en pasos de 1 mm y
 * alivios de fresa en los rincones. Sobre esos vertices no hay escalon
 * que reconocer: hay que quedarse con las rectas y tirar el ruido. 2.5
 * mm limpia el fresado sin tocar una junta, que nunca baja de 15.
 */
const EPS_SIMPLIFICAR = 2.5;

const resta = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const largoDe = (v: Pt) => Math.hypot(v[0], v[1]);
const unit = (v: Pt): Pt => {
  const l = largoDe(v) || 1;
  return [v[0] / l, v[1] / l];
};
const cruz = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const punto = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/** Area con signo. Negativa = el anillo viene en sentido horario. */
function areaFirmada(l: Pt[]): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const [x1, y1] = l[i];
    const [x2, y2] = l[(i + 1) % l.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Quita el punto de cierre repetido y deja el anillo en antihorario. */
function anilloLimpio(pts: Pt[]): Pt[] {
  const r = pts.slice();
  while (r.length > 1) {
    const a = r[0];
    const b = r[r.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) r.pop();
    else break;
  }
  return areaFirmada(r) < 0 ? r.reverse() : r;
}

function dpRec(pts: Pt[], i: number, j: number, eps: number, guardar: boolean[]) {
  if (j <= i + 1) return;
  const d = resta(pts[j], pts[i]);
  const l = largoDe(d);
  const u = unit(d);
  let peor = -1;
  let idx = -1;
  for (let k = i + 1; k < j; k++) {
    const v = resta(pts[k], pts[i]);
    const dist = l < 1e-9 ? largoDe(v) : Math.abs(cruz(u, v));
    if (dist > peor) {
      peor = dist;
      idx = k;
    }
  }
  if (peor > eps && idx > i) {
    guardar[idx] = true;
    dpRec(pts, i, idx, eps, guardar);
    dpRec(pts, idx, j, eps, guardar);
  }
}

/** Douglas-Peucker sobre un anillo cerrado, anclado en dos puntos opuestos. */
function simplificar(anillo: Pt[], eps: number): Pt[] {
  const n = anillo.length;
  if (n < 5) return anillo;
  let m = 0;
  let peor = -1;
  for (let k = 1; k < n; k++) {
    const d = largoDe(resta(anillo[k], anillo[0]));
    if (d > peor) {
      peor = d;
      m = k;
    }
  }
  const guardar = new Array(n).fill(false);
  guardar[0] = true;
  guardar[m] = true;
  dpRec(anillo, 0, m, eps, guardar);
  const cola = [...anillo.slice(m), anillo[0]];
  const g2 = new Array(cola.length).fill(false);
  dpRec(cola, 0, cola.length - 1, eps, g2);
  for (let k = 1; k < cola.length - 1; k++) if (g2[k]) guardar[m + k] = true;
  const out = anillo.filter((_, k) => guardar[k]);
  return out.length >= 3 ? out : anillo;
}

interface Arista {
  a: Pt;
  b: Pt;
  dir: Pt;
  len: number;
}

/**
 * Aristas rectas de peso, en orden y sin las cortas.
 *
 * Saltarse las cortas es a proposito: entre dos lados de una junta hay
 * casi siempre un redondeo o un alivio de fresa, y si se exige que las
 * tres aristas del escalon sean consecutivas vertice a vertice, no se
 * reconoce ni una sola junta de un archivo de CAM real.
 */
function aristasDe(anillo: Pt[], min: number): Arista[] {
  const out: Arista[] = [];
  for (let i = 0; i < anillo.length; i++) {
    const a = anillo[i];
    const b = anillo[(i + 1) % anillo.length];
    const d = resta(b, a);
    const len = largoDe(d);
    if (len >= min) out.push({ a, b, dir: unit(d), len });
  }
  return out;
}

interface Recta {
  dir: Pt;
  base: Pt;
}

/**
 * Funde las aristas colineales en una sola recta.
 *
 * En una mortaja en cruz, la pared de un brazo aparece cortada en dos o
 * tres tramos -el otro brazo la interrumpe, y los alivios de fresa le
 * comen las puntas-. Tratados por separado, ningun par de tramos se
 * enfrenta lo suficiente para pasar por ranura.
 */
function rectasDe(ar: Arista[]): Recta[] {
  const out: Recta[] = [];
  for (const e of ar) {
    if (out.some((r) => punto(r.dir, e.dir) > 0.97 && aRecta(e.a, r.base, r.dir) < 1)) continue;
    out.push({ dir: e.dir, base: e.a });
  }
  return out;
}

/** Cruce de dos rectas dadas por punto y direccion. */
function corte(a: Pt, da: Pt, b: Pt, db: Pt): Pt | null {
  const den = cruz(da, db);
  if (Math.abs(den) < 1e-9) return null;
  const t = cruz(resta(b, a), db) / den;
  return [a[0] + da[0] * t, a[1] + da[1] * t];
}

/** Distancia de un punto a la recta que pasa por `p` con direccion `u`. */
const aRecta = (x: Pt, p: Pt, u: Pt) => Math.abs(cruz(u, resta(x, p)));

/**
 * Juntas del canto: escalones rectangulares del contorno.
 *
 * Un escalon son tres rectas seguidas donde la primera y la tercera van
 * en sentidos opuestos y la del medio les es perpendicular. Si el
 * contorno gira dos veces hacia afuera es una espiga; si gira dos veces
 * hacia adentro es una caja. El sentido lo da el signo del producto
 * cruz, y por eso el anillo se normaliza a antihorario antes.
 *
 * Las medidas salen de los cruces de las rectas, no de los vertices:
 * asi el redondeo de las esquinas no acorta la junta.
 */
function juntasDeCanto(c: ContornoCnc, espesor: number): Junta[] {
  const p = simplificar(anilloLimpio(c.ext), EPS_SIMPLIFICAR);
  const ar = aristasDe(p, Math.max(3, espesor * 0.4));
  const n = ar.length;
  if (n < 3) return [];

  const dim = Math.min(c.bbox.x1 - c.bbox.x0, c.bbox.y1 - c.bbox.y0);
  const out: Junta[] = [];
  for (let i = 0; i < n; i++) {
    const e1 = ar[i];
    const e2 = ar[(i + 1) % n];
    const e3 = ar[(i + 2) % n];
    if (punto(e1.dir, e3.dir) > -0.95) continue; // flancos opuestos
    if (Math.abs(punto(e1.dir, e2.dir)) > 0.12) continue; // fondo perpendicular

    const g1 = cruz(e1.dir, e2.dir);
    const g2 = cruz(e2.dir, e3.dir);
    if (g1 * g2 <= 0) continue; // los dos giros al mismo lado, o no es escalon
    const espiga = g1 > 0;

    const p12 = corte(e1.a, e1.dir, e2.a, e2.dir);
    const p23 = corte(e2.a, e2.dir, e3.a, e3.dir);
    if (!p12 || !p23) continue;
    const largo = largoDe(resta(p23, p12));
    // El fondo se mide desde el arranque de los flancos, que estan sobre
    // el canto principal, hasta la recta del medio.
    const fondo = (aRecta(e1.a, e2.a, e2.dir) + aRecta(e3.b, e2.a, e2.dir)) / 2;

    // Filtros de sensatez. El largo de una junta es un detalle de la
    // pieza, no un lado entero: sin este tope los propios costados del
    // contorno entran como juntas gigantes.
    if (largo < espesor * 0.5 || largo > dim * 0.75) continue;
    if (fondo < espesor * 0.4) continue;

    // El fondo tiene dos lecturas segun la junta. Una espiga sobresale
    // lo que mide el tablero que atraviesa, y poco mas: si sobresale el
    // doble no es espiga, es un pico del contorno -en la mesa, las dos
    // orejas que flanquean una media madera salian como espigas de 53-.
    // Una media madera, en cambio, se come media pieza a proposito: sus
    // 90 mm de fondo son legitimos, y lo que la identifica no es el
    // fondo sino que mida de ancho justo un tablero.
    const anchoDeTablero = largo >= espesor * 0.85 && largo <= espesor * 1.7;
    if (espiga && fondo > espesor * 2) continue;
    if (!espiga && !anchoDeTablero && fondo > espesor * 3) continue;

    const medio: Pt = [(p12[0] + p23[0]) / 2, (p12[1] + p23[1]) / 2];
    const centro: Pt = [
      medio[0] - e1.dir[0] * (fondo / 2),
      medio[1] - e1.dir[1] * (fondo / 2),
    ];
    out.push({
      piezaId: c.id,
      tipo: espiga ? "espiga" : "caja",
      largo: Math.round(largo * 10) / 10,
      fondo: Math.round(fondo * 10) / 10,
      centro,
      eje: unit(resta(p23, p12)),
      normal: espiga ? e1.dir : [-e1.dir[0], -e1.dir[1]],
      etiqueta: `${espiga ? "espiga" : "caja"} ${Math.round(largo)}`,
    });
  }
  return out;
}

/**
 * Ranuras: pares de lados paralelos de un hueco separados el espesor.
 *
 * Se busca el PAR y no la caja envolvente del hueco porque una mortaja
 * en cruz -la que recibe dos piezas, o una sola entrando en angulo- da
 * una caja de 90x90 y ninguna espiga le emparejaria. Como par de lados,
 * la misma cruz da sus dos ranuras de 90 por separado.
 *
 * La separacion se admite hasta 1.6 veces el espesor: una espiga que
 * entra en angulo deja la ranura mas ancha por espesor/cos(angulo).
 */
function juntasDeCara(c: ContornoCnc, espesor: number): Junta[] {
  const out: Junta[] = [];
  for (const h of c.huecos) {
    const p = simplificar(anilloLimpio(h), EPS_SIMPLIFICAR);
    const rectas = rectasDe(aristasDe(p, espesor * 0.4));
    for (let i = 0; i < rectas.length; i++) {
      for (let j = i + 1; j < rectas.length; j++) {
        const A = rectas[i];
        const B = rectas[j];
        if (punto(A.dir, B.dir) > -0.95) continue;
        const sep = aRecta(B.base, A.base, A.dir);
        if (sep < espesor * 0.85 || sep > espesor * 1.6) continue;

        const u = A.dir;
        const nrm: Pt = [-u[1], u[0]];
        const tMedio = (punto(nrm, A.base) + punto(nrm, B.base)) / 2;

        // El largo se mide sobre la BANDA, no sobre el solape de las dos
        // paredes. En una mortaja en cruz cada pared llega partida y
        // ademas recortada por los alivios de fresa, asi que el solape
        // se queda en 77 de los 90 reales y ninguna espiga emparejaria.
        // Los vertices que caen dentro de la banda si llegan a la punta.
        let s0 = Infinity;
        let s1 = -Infinity;
        for (const q of p) {
          if (Math.abs(punto(nrm, q) - tMedio) > sep / 2 + 1) continue;
          const s = punto(u, q);
          s0 = Math.min(s0, s);
          s1 = Math.max(s1, s);
        }
        if (!(s1 - s0 >= espesor)) continue;

        const centro: Pt = [
          u[0] * ((s0 + s1) / 2) + nrm[0] * tMedio,
          u[1] * ((s0 + s1) / 2) + nrm[1] * tMedio,
        ];
        // La misma ranura puede salir por mas de un par de paredes.
        if (
          out.some(
            (q) => largoDe(resta(q.centro, centro)) < espesor && Math.abs(punto(q.eje, u)) > 0.95
          )
        ) {
          continue;
        }
        out.push({
          piezaId: c.id,
          tipo: "ranura",
          largo: Math.round((s1 - s0) * 10) / 10,
          fondo: Math.round(sep * 10) / 10,
          centro,
          eje: u,
          normal: [0, 0],
          etiqueta: `ranura ${Math.round(s1 - s0)}`,
        });
      }
    }
  }
  return out;
}

/** Todas las juntas de una pieza. */
export function juntasDe(c: ContornoCnc, espesor: number): Junta[] {
  return [...juntasDeCanto(c, espesor), ...juntasDeCara(c, espesor)];
}

/** Una junta que recibe a otra, en vez de entrar en ella. */
export function recibe(j: Junta): boolean {
  return j.tipo !== "espiga";
}

/**
 * Holgura maxima que se acepta entre una espiga y su caja, en mm.
 *
 * La comparacion es ASIMETRICA a proposito: una espiga siempre se corta
 * un pelo mas chica que su alojamiento, si no la pieza no entra. En la
 * mesa la mortaja mide 91 y la espiga 87.6, y con una tolerancia
 * simetrica de 3 mm esa pareja -que es real- se perdia.
 */
const HOLGURA_MAX = 6;
const APRIETE_MAX = 1.5;

/**
 * Si dos juntas encajan, y como.
 *
 * Hay dos maneras de unir dos tableros planos y las dos aparecen en los
 * archivos reales:
 *
 *   "pasante"  una espiga entra en una ranura o en una caja. El fondo
 *              no se compara: la espiga puede quedar enrasada o
 *              sobresalir y sigue siendo la misma junta.
 *   "media"    dos cajas se montan una en otra. Solo tiene sentido si
 *              cada caja mide de ancho justo un tablero; si no,
 *              cualquier par de escotaduras del dibujo se emparejaria.
 */
export function encajan(a: Junta, b: Junta, espesor: number): "pasante" | "media" | null {
  const receptA = recibe(a);
  const receptB = recibe(b);
  if (receptA !== receptB) {
    const esp = receptA ? b : a;
    const rec = receptA ? a : b;
    const d = rec.largo - esp.largo;
    return d >= -APRIETE_MAX && d <= HOLGURA_MAX ? "pasante" : null;
  }
  if (a.tipo === "caja" && b.tipo === "caja") {
    if (Math.abs(a.largo - b.largo) > TOL_JUNTA) return null;
    const anchoTablero = (x: Junta) => x.largo >= espesor * 0.85 && x.largo <= espesor * 1.7;
    return anchoTablero(a) && anchoTablero(b) ? "media" : null;
  }
  return null;
}

export interface ClaseJunta {
  largo: number;
  espigas: number;
  receptaculos: number;
  /** Piezas donde aparece esa medida. */
  piezas: string[];
  /** Si esa medida llega a formar pareja con alguna otra junta. */
  empareja: boolean;
}

export interface ResumenJuntas {
  porPieza: Record<string, Junta[]>;
  clases: ClaseJunta[];
  notas: string[];
}

/**
 * Inventario de juntas del archivo completo, agrupado por medida.
 *
 * El conteo por clase es lo que despues dice cuantas copias de cada
 * pieza hacen falta: si el asiento trae cuatro espigas de 65 y el
 * costado solo dos ranuras de 65, el mueble lleva dos costados aunque
 * el DXF traiga uno solo dibujado.
 */
export function inventarioJuntas(piezas: ContornoCnc[], espesor: number): ResumenJuntas {
  const porPieza: Record<string, Junta[]> = {};
  for (const p of piezas) porPieza[p.id] = juntasDe(p, espesor);

  const todas = Object.values(porPieza).flat();

  // Las clases se agrupan con el mismo criterio con el que despues se
  // emparejan, no por una ventana fija sobre el largo: una espiga se
  // corta mas chica que su mortaja, asi que la de 87.6 y la ranura de
  // 91 son la MISMA junta y tienen que contarse juntas. Separadas, el
  // resumen decia "91 mm: 8 reciben, 1 entra" y "88 mm: 3 entran, 0
  // reciben", que no describe nada.
  const grupos: Junta[][] = [];
  for (const j of todas) {
    const g = grupos.find((k) =>
      k.some((q) => encajan(q, j, espesor) || Math.abs(q.largo - j.largo) <= 1)
    );
    if (g) g.push(j);
    else grupos.push([j]);
  }

  const clases: ClaseJunta[] = grupos.map((g) => {
    const piezas: string[] = [];
    for (const j of g) if (!piezas.includes(j.piezaId)) piezas.push(j.piezaId);
    return {
      largo: Math.round(g.reduce((a, j) => a + j.largo, 0) / g.length),
      espigas: g.filter((j) => !recibe(j)).length,
      receptaculos: g.filter(recibe).length,
      piezas,
      empareja: g.some((j) => todas.some((k) => k !== j && encajan(j, k, espesor))),
    };
  });
  clases.sort((a, b) => b.espigas + b.receptaculos - (a.espigas + a.receptaculos));

  const utiles = clases.filter((c) => c.empareja);
  const notas: string[] = [];
  if (!todas.length) {
    notas.push("No se reconocio ninguna junta en el dibujo.");
  } else if (!utiles.length) {
    notas.push(
      `Se reconocieron ${todas.length} junta(s), pero ninguna empareja con otra: no hay con que armar.`
    );
  } else {
    notas.push(
      `${todas.length} junta(s), ${utiles.length} medida(s) que emparejan: ${utiles
        .map((c) => `${Math.round(c.largo)} mm (${c.espigas} entran, ${c.receptaculos} reciben)`)
        .join("; ")}.`
    );
  }
  return { porPieza, clases, notas };
}

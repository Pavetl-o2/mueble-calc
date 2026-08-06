import type { ContornoCnc, Pt } from "./cnc";
import { encajan, inventarioJuntas, recibe, type Junta } from "./cncJuntas";

// ---------------------------------------------------------------
// SOLVER DE ARMADO
//
// Arma el mueble resolviendo sus juntas, no colocando piezas por
// parametros. La diferencia importa: un radio y un giro son numeros que
// hay que adivinar y que solo describen bien a la familia de mueble
// para la que se calibraron, mientras que una junta es un dato exacto
// del dibujo. Cuando una espiga entra en su mortaja, la posicion y el
// angulo de la pieza quedan fijados: no queda nada que suponer.
//
// El recorrido es por propagacion. Se apoya la pieza mayor y desde ahi
// se van colgando las que emparejan con alguna junta ya colocada. Lo
// que no llega a emparejar NO se inventa: se reporta suelto.
// ---------------------------------------------------------------

export type V3 = [number, number, number];

/**
 * Sitio de una pieza en el espacio.
 *
 * Se guarda como base y origen en vez de angulos de Euler porque el
 * solver la construye directamente de dos direcciones -el eje de la
 * junta y por donde entra- y pasar por angulos solo agregaria una
 * conversion que se puede equivocar de orden.
 */
export interface Pose {
  /** Donde cae el (0,0) del dibujo de la pieza. */
  o: V3;
  /** Imagen del eje X del dibujo. */
  u: V3;
  /** Imagen del eje Y del dibujo. */
  v: V3;
  /** Normal de la cara. El tablero ocupa +-espesor/2 en esta direccion. */
  w: V3;
}

export interface Instancia {
  /** Unico por copia: una misma pieza puede ir varias veces. */
  id: string;
  piezaId: string;
  /** Numero de copia, empezando en 1. */
  copia: number;
  pose: Pose;
  /** Con que junta se colgo, para poder explicarlo. */
  via: string;
}

export interface Union {
  a: string;
  b: string;
  largo: number;
  modo: "pasante" | "media";
}

export interface Armadura {
  instancias: Instancia[];
  uniones: Union[];
  /** Juntas reconocidas en cada pieza, para poder mostrarlas. */
  juntasPorPieza: Record<string, Junta[]>;
  /** Piezas que no emparejaron con nada y quedaron fuera. */
  sueltas: string[];
  /** Juntas que quedaron sin pareja, contadas por pieza. */
  juntasLibres: number;
  notas: string[];
}

const suma = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const resta3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const escala = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cruz3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norma = (a: V3) => Math.hypot(a[0], a[1], a[2]);
/** Coseno entre dos direcciones, para comparar orientaciones. */
const punto3 = (a: V3, b: V3) =>
  (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((norma(a) * norma(b)) || 1);

/**
 * Boca y fondo de una junta de canto, en coordenadas de la pieza.
 *
 * En una junta pasante las dos parejas coinciden en su centro. En una
 * media madera no, y el punto que coincide es el FONDO de las dos
 * cajas: ahi es donde se parte el solape. Cada tablero se ranura hasta
 * ese plano comun -uno desde arriba, otro desde abajo- y por eso el
 * material de cada uno llena exactamente el hueco del otro. Si en vez
 * de eso se hace coincidir la boca de una con el fondo de la otra, los
 * tableros quedan montados a medias: en el banco de costillas eso
 * repartia las laminas por un metro y medio de altura.
 */
const boca = (j: Junta): Pt => [
  j.centro[0] + j.normal[0] * (j.fondo / 2),
  j.centro[1] + j.normal[1] * (j.fondo / 2),
];
const fondoDe = (j: Junta): Pt => [
  j.centro[0] - j.normal[0] * (j.fondo / 2),
  j.centro[1] - j.normal[1] * (j.fondo / 2),
];

/** Punto del dibujo llevado al espacio. */
export function alMundo(p: Pose, q: Pt): V3 {
  return suma(p.o, suma(escala(p.u, q[0]), escala(p.v, q[1])));
}
/** Direccion del dibujo llevada al espacio. */
export function dirMundo(p: Pose, d: Pt): V3 {
  return suma(escala(p.u, d[0]), escala(p.v, d[1]));
}

/** Cuanto tolera el solver que dos juntas emparejadas no coincidan, en mm. */
const TOL_CIERRE = 12;
/** Tope de copias de una misma pieza, por si un archivo se descontrola. */
const MAX_COPIAS = 8;
/**
 * Tope de poses evaluadas en un armado.
 *
 * El solver corre en el navegador cada vez que cambia el archivo, asi
 * que no puede permitirse tardar. Con juntas todas iguales -un banco de
 * costillas tiene 116 cajas de 20 mm que encajan todas con todas- el
 * numero de combinaciones se dispara, y vale mas entregar lo resuelto
 * diciendo que se quedo a medias que colgar la pestana.
 */
const PRESUPUESTO = 300_000;

/**
 * Cuantas copias de cada pieza pide el dibujo.
 *
 * Un DXF de corte trae cada pieza DISTINTA una vez; si el mueble lleva
 * dos costados iguales, el costado esta dibujado una sola vez. Sin esto
 * el armado sale cojo, y peor: al solver le sobran espigas sin donde
 * entrar y se pone a inventar copias sin freno.
 *
 * El conteo sale del balance de juntas: en un mueble armado cada espiga
 * tiene su alojamiento y cada alojamiento su espiga. Si el asiento trae
 * cuatro espigas de 65 y el costado solo dos ranuras de 65, hacen falta
 * dos costados; y al reves, cuatro ranuras en el fondo con dos espigas
 * por costado piden tambien dos costados.
 *
 * Las juntas que caen en el mismo sitio de una pieza cuentan una sola
 * vez. Hace falta porque una mortaja en cruz se lee como dos ranuras
 * -son dos pares de paredes- pero recibe una sola espiga, y contandolas
 * por separado la mesa pedia el doble de patas.
 */
function multiplicidad(
  piezas: ContornoCnc[],
  porPieza: Record<string, Junta[]>,
  espesor: number
): Map<string, number> {
  const n = new Map(piezas.map((p) => [p.id, 1]));

  // Clases: medidas que se emparejan entre si.
  const todas = Object.values(porPieza).flat();
  const clases: Junta[][] = [];
  for (const j of todas) {
    const c = clases.find((k) =>
      k.some((q) => encajan(q, j, espesor) || Math.abs(q.largo - j.largo) < 1)
    );
    if (c) c.push(j);
    else clases.push([j]);
  }

  /** Juntas de una pieza en una clase, contando una vez las del mismo sitio. */
  const sitios = (piezaId: string, clase: Junta[], recept: boolean) => {
    const vistos: Pt[] = [];
    for (const j of porPieza[piezaId] ?? []) {
      if (!clase.includes(j) || recibe(j) !== recept) continue;
      if (vistos.some((v) => Math.hypot(v[0] - j.centro[0], v[1] - j.centro[1]) < espesor)) continue;
      vistos.push(j.centro);
    }
    return vistos.length;
  };

  for (let iter = 0; iter < piezas.length * 4; iter++) {
    let cambio = false;
    for (const clase of clases) {
      let esp = 0;
      let rec = 0;
      const meten: string[] = [];
      const reciben: string[] = [];
      for (const p of piezas) {
        const copias = n.get(p.id) ?? 1;
        const e = sitios(p.id, clase, false);
        const r = sitios(p.id, clase, true);
        esp += e * copias;
        rec += r * copias;
        if (e) meten.push(p.id);
        if (r) reciben.push(p.id);
      }
      if (esp === rec || !esp || !rec) continue;

      // Se sube la pieza del lado corto, y solo si acerca el balance:
      // sin esa condicion las dos partes se persiguen y el conteo se
      // dispara hasta el tope.
      const lado = esp < rec ? meten : reciben;
      lado.sort((a, b) => (n.get(a) ?? 1) - (n.get(b) ?? 1));
      const sube = lado[0];
      if (!sube || (n.get(sube) ?? 1) >= MAX_COPIAS) continue;
      const aporta = sitios(sube, clase, esp >= rec);
      const antes = Math.abs(esp - rec);
      const despues = Math.abs(esp < rec ? esp + aporta - rec : esp - (rec + aporta));
      if (despues >= antes) continue;
      n.set(sube, (n.get(sube) ?? 1) + 1);
      cambio = true;
    }
    if (!cambio) break;
  }
  return n;
}

/**
 * Serie de juntas iguales, en linea y a paso constante.
 *
 * Es el patron de un larguero de banco de costillas, de un lomo con
 * repisas o de una maqueta de curvas de nivel: una pieza larga peinada
 * con N cajas identicas donde se enfila una familia de piezas.
 *
 * Hay que reconocerlo aparte porque rompe el supuesto del emparejado por
 * medida. En este banco las 116 cajas miden 20 mm -el espesor del
 * tablero- asi que TODAS encajan con todas: cualquier costilla entra en
 * cualquier ranura y el solver, que elige por medida, encadenaba
 * costillas unas sobre otras. Lo que distingue una ranura de la de al
 * lado no es su ancho sino su FONDO, que en el larguero recorre una V
 * de 158 a 60 y de vuelta a 158, y esa V es literalmente la curva del
 * asiento.
 */
interface Serie {
  piezaId: string;
  /** Las juntas de la serie, ordenadas a lo largo de la pieza. */
  juntas: Junta[];
}

function seriesDe(porPieza: Record<string, Junta[]>): Serie[] {
  const out: Serie[] = [];
  for (const [piezaId, js] of Object.entries(porPieza)) {
    const grupos = new Map<string, Junta[]>();
    for (const j of js) {
      const k = `${j.tipo}:${Math.round(j.largo)}`;
      const g = grupos.get(k);
      if (g) g.push(j);
      else grupos.set(k, [j]);
    }
    for (const g of grupos.values()) {
      if (g.length < 4) continue;
      // La alineacion se mide sobre la BOCA de cada caja, no sobre su
      // centro: el centro esta a media profundidad y las profundidades
      // varian -en el banco van de 60 a 158 mm-, asi que los centros
      // dibujan la curva del asiento y no una recta. Las bocas, en
      // cambio, estan todas sobre el mismo canto.
      const bocas = g.map(boca);
      const a = bocas[0];
      const b = bocas[bocas.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const desvio = bocas.map((q) => Math.abs(u[0] * (q[1] - a[1]) - u[1] * (q[0] - a[0])));
      if (Math.max(...desvio) > 2) continue;
      // Y a paso regular.
      const s = g
        .map((j, i) => ({ j, t: u[0] * (bocas[i][0] - a[0]) + u[1] * (bocas[i][1] - a[1]) }))
        .sort((p, q) => p.t - q.t);
      const pasos = s.slice(1).map((p, i) => p.t - s[i].t);
      const medio = pasos.reduce((x, y) => x + y, 0) / pasos.length;
      if (medio < 1 || pasos.some((p) => Math.abs(p - medio) > medio * 0.15)) continue;
      out.push({ piezaId, juntas: s.map((p) => p.j) });
    }
  }
  return out;
}

/**
 * Reparte la familia que enfila un peine, en orden.
 *
 * Con las juntas todas iguales, la geometria local no dice que pieza va
 * en que ranura; pero la serie completa si. Las profundidades del peine
 * y las de las piezas que enfila son dos sucesiones monotonas, y solo
 * hay una forma de emparejarlas que respete el orden: la mas honda con
 * la mas honda. En el banco eso deja cada costilla en su sitio y
 * reconstruye la curva sin mas dato que el dibujo.
 *
 * Devuelve, por cada junta del peine, la pieza que le toca.
 */
function repartirSeries(
  piezas: ContornoCnc[],
  porPieza: Record<string, Junta[]>,
  espesor: number,
  invertir: boolean
): {
  asignado: Map<Junta, string>;
  serieDe: Map<Junta, number>;
  familia: Map<string, number>;
  peines: Set<string>;
} {
  const asignado = new Map<Junta, string>();
  const serieDe = new Map<Junta, number>();
  const familia = new Map<string, number>();
  const peines = new Set<string>();
  seriesDe(porPieza).forEach((serie, idx) => {
    // Candidatas: las piezas -que no son el propio peine ni otro peine-
    // con una junta que encaje en la serie.
    const cand: { id: string; fondo: number }[] = [];
    for (const j of serie.juntas) serieDe.set(j, idx);
    for (const p of piezas) {
      if (p.id === serie.piezaId) continue;
      const js = (porPieza[p.id] ?? []).filter((j) =>
        serie.juntas.some((k) => encajan(k, j, espesor))
      );
      if (!js.length || js.length > 4) continue;
      cand.push({ id: p.id, fondo: Math.min(...js.map((j) => j.fondo)) });
    }
    if (cand.length < serie.juntas.length) return;

    const porFondo = [...serie.juntas].sort((a, b) => a.fondo - b.fondo);
    cand.sort((a, b) => (invertir ? b.fondo - a.fondo : a.fondo - b.fondo));
    porFondo.forEach((j, i) => asignado.set(j, cand[i].id));
    for (const c of cand) familia.set(c.id, idx);
    peines.add(serie.piezaId);
  });
  return { asignado, serieDe, familia, peines };
}

function dentro(poly: Pt[], x: number, y: number): boolean {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/**
 * Puntos repartidos por dentro del tablero, sin contar sus huecos.
 *
 * Son las sondas con las que se comprueba que una pieza no se meta
 * dentro de otra. Los huecos quedan fuera a proposito: por ahi pasan
 * las espigas, y una junta bien resuelta tiene que dar cero.
 */
const cacheMuestras = new Map<string, Pt[]>();
function muestras(c: ContornoCnc): Pt[] {
  const hit = cacheMuestras.get(c.id);
  if (hit) return hit;
  const out: Pt[] = [];
  const N = 9;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = c.bbox.x0 + ((c.bbox.x1 - c.bbox.x0) * i) / N;
      const y = c.bbox.y0 + ((c.bbox.y1 - c.bbox.y0) * j) / N;
      if (!dentro(c.ext, x, y)) continue;
      if (c.huecos.some((h) => dentro(h, x, y))) continue;
      out.push([x, y]);
    }
  }
  cacheMuestras.set(c.id, out);
  return out;
}

/**
 * Que fraccion de la pieza quedaria METIDA dentro de otra ya colocada.
 *
 * Es la unica restriccion realmente dura del armado: dos tableros no
 * pueden ocupar el mismo sitio. Y resuelve lo que ni las juntas ni la
 * compacidad resolvian, porque una junta con el signo cambiado suele
 * seguir encajando -la espiga entra igual de bien- y solo se delata
 * cuando el resto de la pieza atraviesa a su vecina. En la mesa, dos
 * faldones caian sobre el mismo lado del tablero, uno encima del otro.
 */
function penetracion(
  pose: Pose,
  pieza: ContornoCnc,
  colocadas: { pose: Pose; pieza: ContornoCnc }[],
  espesor: number
): number {
  const ms = muestras(pieza);
  if (!ms.length || !colocadas.length) return 0;
  let choca = 0;
  for (const m of ms) {
    const p = alMundo(pose, m);
    for (const otra of colocadas) {
      const d = resta3(p, otra.pose.o);
      const z = d[0] * otra.pose.w[0] + d[1] * otra.pose.w[1] + d[2] * otra.pose.w[2];
      if (Math.abs(z) > espesor * 0.4) continue;
      const lx = d[0] * otra.pose.u[0] + d[1] * otra.pose.u[1] + d[2] * otra.pose.u[2];
      const ly = d[0] * otra.pose.v[0] + d[1] * otra.pose.v[1] + d[2] * otra.pose.v[2];
      if (!dentro(otra.pieza.ext, lx, ly)) continue;
      if (otra.pieza.huecos.some((h) => dentro(h, lx, ly))) continue;
      choca++;
      break;
    }
  }
  return choca / ms.length;
}

/**
 * Construye la pose de una pieza a partir de una pareja de juntas.
 *
 * Toda la geometria del armado esta aqui. Se le pide a la pieza nueva
 * que dos de sus direcciones caigan sobre dos direcciones ya conocidas
 * del mundo, y con eso su base queda determinada; el origen sale de
 * hacer coincidir el punto de la junta.
 *
 * `r` y `s` son los dos signos que quedan sueltos -la pieza puede
 * entrar por una cara o por la otra, y de frente o al reves-. El solver
 * prueba las cuatro y se queda con la que ademas cierra las otras
 * juntas de la pieza.
 */
function poseDeJunta(
  basePose: Pose,
  base: Junta,
  nueva: Junta,
  modo: "pasante" | "media",
  r: number,
  s: number
): Pose | null {
  const P = alMundo(basePose, base.centro);
  const E = dirMundo(basePose, base.eje);

  let a: Pt;
  let b: Pt;
  let Aw: V3;
  let Bw: V3;
  let destino: V3;
  let origenLocal: Pt;

  if (modo === "media") {
    // Media madera: la caja de la pieza nueva mide de ancho justo el
    // tablero de la otra, asi que su eje va sobre la normal de esa
    // pieza. Y como las dos se montan de lados opuestos, las bocas se
    // miran de frente.
    const nB = dirMundo(basePose, base.normal);
    a = nueva.eje;
    b = nueva.normal;
    Aw = escala(basePose.w, r);
    Bw = escala(nB, -1);
    // La pieza entra hasta el fondo: su boca queda al ras del fondo de
    // la caja contraria, que es lo que hace que las dos caras queden
    // enrasadas al cruzarse.
    origenLocal = fondoDe(nueva);
    destino = alMundo(basePose, fondoDe(base));
  } else if (!recibe(nueva)) {
    // La pieza nueva mete su espiga. La espiga atraviesa el espesor de
    // la pieza que la recibe, asi que su direccion de salida cae sobre
    // la normal de esa pieza.
    a = nueva.eje;
    b = nueva.normal;
    Aw = escala(E, r);
    Bw = escala(basePose.w, s);
    origenLocal = nueva.centro;
    destino = P;
  } else {
    // Al reves: la pieza nueva recibe una espiga ya colocada. Solo hay
    // una direccion en su plano que amarrar -el eje de la ranura-, y la
    // otra sale de exigir que su cara quede perpendicular a la espiga.
    const N = dirMundo(basePose, base.normal);
    a = nueva.eje;
    b = [-nueva.eje[1], nueva.eje[0]];
    Aw = escala(E, r);
    Bw = cruz3(escala(N, s), Aw);
    origenLocal = nueva.centro;
    destino = P;
  }

  if (norma(Aw) < 0.5 || norma(Bw) < 0.5) return null;

  // base = Aw (x) a + Bw (x) b, con {a,b} ortonormales en el plano.
  const u: V3 = suma(escala(Aw, a[0]), escala(Bw, b[0]));
  const v: V3 = suma(escala(Aw, a[1]), escala(Bw, b[1]));
  const w = cruz3(u, v);
  if (norma(w) < 0.5) return null;

  const o = resta3(destino, suma(escala(u, origenLocal[0]), escala(v, origenLocal[1])));
  return { o, u, v, w };
}

interface JuntaLibre {
  instancia: string;
  piezaId: string;
  pose: Pose;
  junta: Junta;
  /** Centro de la junta ya en el espacio, para comparar rapido. */
  mundo: V3;
}

/**
 * Arma el mueble propagando desde la pieza mayor.
 *
 * En cada vuelta se busca la pieza que mas juntas cierra a la vez
 * contra lo ya colocado. Preferir la que mas cierra no es un detalle:
 * es lo que resuelve la ambiguedad. Una pieza colgada de una sola junta
 * puede entrar de cuatro maneras y las cuatro son validas por separado;
 * con dos juntas solo una las satisface a las dos.
 */
function resolverUno(
  piezas: ContornoCnc[],
  espesor: number,
  invertir: boolean
): Armadura & { series: number } {
  const notas: string[] = [];
  if (!piezas.length) {
    return {
      instancias: [], uniones: [], juntasPorPieza: {}, sueltas: [],
      juntasLibres: 0, notas: ["Sin piezas."], series: 0,
    };
  }

  const inv = inventarioJuntas(piezas, espesor);
  notas.push(...inv.notas);

  const porId = new Map(piezas.map((p) => [p.id, p]));
  const cupo = multiplicidad(piezas, inv.porPieza, espesor);
  // Reparto de las series ANTES de propagar: con las juntas todas
  // iguales, decidirlo sobre la marcha es imposible.
  const { asignado, serieDe, familia, peines } = repartirSeries(
    piezas, inv.porPieza, espesor, invertir
  );
  // Orientacion comun de cada serie. Las piezas que enfila un peine son
  // paralelas entre si -eso es lo que hace que sea un peine-, asi que en
  // cuanto se coloca la primera, las demas heredan su orientacion. Sin
  // esto cada costilla elegia su cara por separado y el banco salia en
  // abanico.
  const orientSerie = new Map<number, { u: V3; v: V3 }>();
  const raiz = piezas.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));

  // La pieza mayor se acuesta y se centra: es el marco de referencia.
  // Cual sea no cambia el mueble, solo desde donde se mira, y el
  // conjunto se endereza al final.
  const cx = (raiz.bbox.x0 + raiz.bbox.x1) / 2;
  const cy = (raiz.bbox.y0 + raiz.bbox.y1) / 2;
  const uR: V3 = [1, 0, 0];
  const vR: V3 = [0, 0, -1];
  const poseRaiz: Pose = {
    o: resta3([0, 0, 0], suma(escala(uR, cx), escala(vR, cy))),
    u: uR,
    v: vR,
    w: cruz3(uR, vR),
  };

  const instancias: Instancia[] = [
    { id: `${raiz.id}#1`, piezaId: raiz.id, copia: 1, pose: poseRaiz, via: "referencia" },
  ];
  const copias = new Map<string, number>([[raiz.id, 1]]);
  const uniones: Union[] = [];

  const libres: JuntaLibre[] = (inv.porPieza[raiz.id] ?? []).map((j) => ({
    instancia: instancias[0].id,
    piezaId: raiz.id,
    pose: poseRaiz,
    junta: j,
    mundo: alMundo(poseRaiz, j.centro),
  }));

  const sinColocar = new Set(piezas.filter((p) => p !== raiz).map((p) => p.id));
  let gasto = 0;
  let agotado = false;

  for (let vuelta = 0; vuelta < piezas.length * MAX_COPIAS; vuelta++) {
    // Centro de lo ya armado, para medir contra el que tan lejos cae
    // cada candidata.
    let centroArmado: V3 = [0, 0, 0];
    for (const inst of instancias) {
      const c = porId.get(inst.piezaId);
      if (!c) continue;
      centroArmado = suma(
        centroArmado,
        alMundo(inst.pose, [(c.bbox.x0 + c.bbox.x1) / 2, (c.bbox.y0 + c.bbox.y1) / 2])
      );
    }
    centroArmado = escala(centroArmado, 1 / Math.max(1, instancias.length));

    // Huella en planta de lo ya armado. Sirve para descartar la pieza
    // que entra bien en su junta pero apuntando al reves: un mueble no
    // se extiende a metro y medio de su propia cubierta.
    let hx0 = Infinity, hx1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
    for (const inst of instancias) {
      const c = porId.get(inst.piezaId);
      if (!c) continue;
      for (let k = 0; k < c.ext.length; k += 4) {
        const w = alMundo(inst.pose, c.ext[k]);
        hx0 = Math.min(hx0, w[0]); hx1 = Math.max(hx1, w[0]);
        hz0 = Math.min(hz0, w[2]); hz1 = Math.max(hz1, w[2]);
      }
    }
    const fueraDeHuella = (q: V3) =>
      Math.hypot(Math.max(0, hx0 - q[0], q[0] - hx1), Math.max(0, hz0 - q[2], q[2] - hz1));

    const colocadas = instancias
      .map((i) => ({ pose: i.pose, pieza: porId.get(i.piezaId)! }))
      .filter((x) => x.pieza);

    let mejor: {
      piezaId: string;
      pose: Pose;
      cierra: JuntaLibre[];
      propias: Junta[];
      residuo: number;
      modo: "pasante" | "media";
      largo: number;
      contra: string;
      serie?: number;
      alineada: boolean;
      lejania: number;
      altura: number;
      choque: number;
      paralela: boolean;
    } | null = null;

    // Dos pasadas. La primera le exige evidencia a los peines; solo si
    // no queda nada colocable se admite uno con una sola junta cerrada.
    for (const estricto of [true, false]) {
      if (mejor || agotado) break;
      for (const p of piezas) {
      const usadas = copias.get(p.id) ?? 0;
      if (usadas >= (cupo.get(p.id) ?? 1)) continue;
      const juntas = inv.porPieza[p.id] ?? [];
      if (!juntas.length) continue;

      for (const libre of libres) {
        // Si la junta pertenece a una serie ya repartida, solo admite la
        // pieza que le toca. Sin esto, cualquiera entra en cualquiera.
        const duena = asignado.get(libre.junta);
        if (duena && duena !== p.id) continue;
        // Dos piezas de la misma familia no se cuelgan una de otra: van
        // las dos enfiladas en el peine. Sin esta regla las costillas
        // del banco se encadenaban entre si -sus cajas miden todas lo
        // mismo, asi que encajan- y el banco salia en escalera.
        const fam = familia.get(p.id);
        if (fam != null && familia.get(libre.piezaId) === fam) continue;
        const sid = serieDe.get(libre.junta);
        const yaOrientada = sid != null ? orientSerie.get(sid) : undefined;
        // Poda del reparto en el otro sentido: si la pieza que se
        // intenta poner es el peine y la junta libre es de una pieza que
        // el enfila, ya se sabe QUE caja del peine le toca. Sin esto hay
        // que probar las 29 cajas del larguero contra cada junta libre.
        const suyas = peines.has(p.id)
          ? juntas.filter((j) => {
              const d = asignado.get(j);
              return d === undefined || d === libre.piezaId;
            })
          : juntas;
        for (const jn of suyas) {
          const modo = encajan(libre.junta, jn, espesor);
          if (!modo) continue;
          for (const r of [1, -1]) {
            for (const s of [1, -1]) {
              if (++gasto > PRESUPUESTO) {
                agotado = true;
                break;
              }
              const pose = poseDeJunta(libre.pose, libre.junta, jn, modo, r, s);
              if (!pose) continue;
              const alineada =
                !yaOrientada ||
                (punto3(pose.u, yaOrientada.u) > 0.99 && punto3(pose.v, yaOrientada.v) > 0.99);

              // Cuantas OTRAS juntas de la pieza caen sobre juntas
              // libres ya colocadas. Eso es lo que distingue la pose
              // buena de sus tres reflejos.
              const cierra: JuntaLibre[] = [libre];
              const propias: Junta[] = [jn];
              let residuo = 0;
              for (const otra of juntas) {
                if (otra === jn) continue;
                let mejorL: JuntaLibre | null = null;
                let mejorD = TOL_CIERRE;
                for (const l of libres) {
                  if (cierra.includes(l)) continue;
                  const m = encajan(l.junta, otra, espesor);
                  if (!m) continue;
                  const dest =
                    m === "media" ? alMundo(pose, fondoDe(otra)) : alMundo(pose, otra.centro);
                  const ref =
                    m === "media" ? alMundo(l.pose, fondoDe(l.junta)) : l.mundo;
                  const d = norma(resta3(dest, ref));
                  if (d < mejorD) {
                    mejorD = d;
                    mejorL = l;
                  }
                }
                if (mejorL) {
                  cierra.push(mejorL);
                  propias.push(otra);
                  residuo += mejorD;
                }
              }

              const c = porId.get(p.id)!;
              // Una copia de una pieza ya puesta suele ir en la misma
              // orientacion que la primera: la hoja de corte dibuja el
              // costado una vez y el mueble lleva dos, iguales. Es un
              // desempate debil a proposito -si espejearla cerrara mas
              // juntas, el conteo manda-, pero sin el los dos costados
              // de la silla salian cruzados y el travesano solo
              // alcanzaba a uno.
              const paralela = instancias.some(
                (i) =>
                  i.piezaId === p.id &&
                  i.pose.u[0] * pose.u[0] + i.pose.u[1] * pose.u[1] + i.pose.u[2] * pose.u[2] > 0.99 &&
                  i.pose.v[0] * pose.v[0] + i.pose.v[1] * pose.v[1] + i.pose.v[2] * pose.v[2] > 0.99
              );
              const choque = penetracion(pose, c, colocadas, espesor);
              // Atravesar otra pieza no se negocia: la pose es
              // imposible aunque la junta encaje.
              if (choque > 0.15) continue;
              const centroPieza = alMundo(pose, [
                (c.bbox.x0 + c.bbox.x1) / 2,
                (c.bbox.y0 + c.bbox.y1) / 2,
              ]);
              const cand = {
                piezaId: p.id,
                pose,
                cierra,
                propias,
                residuo,
                modo,
                largo: jn.largo,
                contra: libre.instancia,
                serie: sid,
                alineada,
                // Cuanto se sale la pieza de la huella del mueble.
                // Cuando una junta deja libre el signo -y una pieza
                // colgada de una sola junta siempre lo deja- las dos
                // opciones encajan igual de bien: la espiga entra igual
                // en los dos casos, y lo unico que cambia es hacia
                // donde se extiende el resto. Se mide contra la huella
                // y no contra el centro para no premiar amontonarse:
                // dos faldones en lados opuestos del tablero estan los
                // dos dentro de la huella y quedan empatados, como debe
                // ser.
                lejania: fueraDeHuella(centroPieza),
                altura: centroPieza[1],
                choque,
                paralela,
              };
              // Un peine es el espinazo del mueble y trae decenas de
              // juntas iguales: colgarlo de UNA sola deja su pose sin
              // determinar y arrastra a todo lo que venga despues. En el
              // banco, el segundo larguero se colocaba en tercer lugar
              // con una unica junta cerrada y se llevaba la mitad de las
              // costillas a otra altura. Espera a tener dos.
              if (estricto && peines.has(p.id) && cierra.length < 2) continue;
              if (!mejor) {
                mejor = cand;
                continue;
              }
              // Una junta pasante amarra la pieza contra el cuerpo del
              // mueble; una media madera solo dice que dos tableros se
              // cruzan, y admite cruces que no llevan a ningun lado.
              const mejorQue =
                cierra.length !== mejor.cierra.length
                  ? cierra.length > mejor.cierra.length
                  : alineada !== mejor.alineada
                  ? alineada
                  : Math.abs(choque - mejor.choque) > 0.02
                  ? choque < mejor.choque
                  : paralela !== mejor.paralela
                  ? paralela
                  : modo !== mejor.modo
                  ? modo === "pasante"
                  : Math.abs(cand.lejania - mejor.lejania) > 1
                  ? cand.lejania < mejor.lejania
                  : Math.abs(residuo - mejor.residuo) > 0.5
                  ? residuo < mejor.residuo
                  : cand.altura < mejor.altura;
              if (mejorQue) mejor = cand;
            }
          }
        }
      }
    }

    }
    if (!mejor) break;

    const copia = (copias.get(mejor.piezaId) ?? 0) + 1;
    copias.set(mejor.piezaId, copia);
    sinColocar.delete(mejor.piezaId);
    const id = `${mejor.piezaId}#${copia}`;
    instancias.push({
      id,
      piezaId: mejor.piezaId,
      copia,
      pose: mejor.pose,
      via: `${mejor.modo} de ${Math.round(mejor.largo)} mm con ${mejor.contra}`,
    });
    for (const l of mejor.cierra) {
      uniones.push({ a: l.instancia, b: id, largo: l.junta.largo, modo: mejor.modo });
    }
    if (mejor.serie != null && !orientSerie.has(mejor.serie)) {
      orientSerie.set(mejor.serie, { u: mejor.pose.u, v: mejor.pose.v });
    }

    // Las juntas usadas dejan de estar libres, y las de la pieza recien
    // puesta entran al juego.
    const gastadas = new Set(mejor.cierra);
    for (let i = libres.length - 1; i >= 0; i--) if (gastadas.has(libres[i])) libres.splice(i, 1);
    const usadasPropias = new Set(mejor.propias);
    for (const j of inv.porPieza[mejor.piezaId] ?? []) {
      if (usadasPropias.has(j)) continue;
      libres.push({
        instancia: id,
        piezaId: mejor.piezaId,
        pose: mejor.pose,
        junta: j,
        mundo: alMundo(mejor.pose, j.centro),
      });
    }
  }

  // Enderezado final. El armado se resuelve con la pieza mayor
  // acostada, que es lo correcto cuando esa pieza es una cubierta o un
  // asiento. Pero si es un larguero -largo y estrecho- el mueble corre a
  // lo largo de el y queda tumbado de lado: el banco de costillas salia
  // bien armado y acostado. Se endereza girando el conjunto YA resuelto,
  // no cambiando la pose de arranque: el arranque tambien mueve los
  // desempates, y al tocarlo se perdian juntas que ya cerraban.
  if (raiz.largo / Math.max(1, raiz.ancho) >= 3) {
    const gira = (v: V3): V3 => [v[0], v[2], -v[1]];
    for (const inst of instancias) {
      inst.pose = {
        o: gira(inst.pose.o),
        u: gira(inst.pose.u),
        v: gira(inst.pose.v),
        w: gira(inst.pose.w),
      };
    }
  }

  if (agotado) {
    notas.push(
      "El archivo tiene demasiadas combinaciones de junta y se corto la busqueda antes de terminar: lo que falta hay que acomodarlo a mano."
    );
  }
  const sueltas = [...sinColocar];
  if (sueltas.length) {
    notas.push(
      `No se pudo colgar ${sueltas.length} pieza(s) de ninguna junta: quedan sueltas y hay que acomodarlas a mano.`
    );
  }
  const repetidas = [...copias.entries()].filter(([, n]) => n > 1);
  if (repetidas.length) {
    notas.push(
      `Las juntas piden mas de una copia de ${repetidas
        .map(([id, n]) => `${id} (x${n})`)
        .join(", ")}: el DXF trae el dibujo una vez y el mueble las lleva varias.`
    );
  }
  notas.push(
    `${uniones.length} union(es) resuelta(s) por geometria y ${libres.length} junta(s) sin pareja.`
  );

  return {
    instancias,
    uniones,
    juntasPorPieza: inv.porPieza,
    sueltas,
    juntasLibres: libres.length,
    notas,
    series: peines.size,
  };
}

/**
 * Arma el mueble. Si el dibujo trae series, prueba los dos ordenes de
 * reparto y se queda con el que cierre mas juntas.
 *
 * Hace falta porque el sentido de la correlacion depende del mueble y no
 * se puede fijar por decreto. En el banco de costillas, donde el
 * larguero se ahonda hacia los extremos igual que crecen las laminas,
 * las dos series suben a la vez; en una media madera de solape
 * constante suben al reves. Emparejar mas hondo con mas hondo acierta en
 * el primer caso y falla en el segundo, asi que se prueban ambos y
 * decide el resultado, que es lo unico que sabe cual era.
 */
export function resolverArmado(piezas: ContornoCnc[], espesor: number): Armadura {
  const directo = resolverUno(piezas, espesor, false);
  if (!directo.series) return directo;
  const inverso = resolverUno(piezas, espesor, true);
  return inverso.uniones.length > directo.uniones.length ? inverso : directo;
}

/** Cota mas baja del armado, para apoyar el piso del visor. */
export function pisoDe(a: Armadura, piezas: ContornoCnc[], espesor: number): number {
  const porId = new Map(piezas.map((p) => [p.id, p]));
  let min = Infinity;
  for (const inst of a.instancias) {
    const c = porId.get(inst.piezaId);
    if (!c) continue;
    for (const [x, y] of c.ext) {
      const p = alMundo(inst.pose, [x, y]);
      min = Math.min(min, p[1] - Math.abs(inst.pose.w[1]) * (espesor / 2));
    }
  }
  return Number.isFinite(min) ? min : 0;
}

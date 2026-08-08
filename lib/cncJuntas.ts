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
  /**
   * Espesor del tablero en el que esta cortada esta junta.
   *
   * No es el de la pieza que entra en ella: en un mueble que mezcla
   * tableros, una ranura de 18 mm cortada en un entrepano de 12 recibe
   * una pieza de 18. Por eso el ancho se compara contra los espesores
   * que hay en el juego, y el propio solo gobierna los umbrales de
   * ruido del contorno.
   */
  propio: number;
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
 * Si una medida puede ser el ancho de alguno de los tableros del juego.
 *
 * Se prueba contra TODOS los espesores presentes y no solo contra el de
 * la pieza: lo que entra en una ranura es otra pieza, y en un flat-pack
 * que mezcla 12 y 18 la ranura de un tablero de 12 mide 18.
 */
const esTablero = (x: number, espesores: number[], tope: number) =>
  espesores.some((t) => x >= t * 0.85 && x <= t * tope);

/**
 * Juntas del canto: escalones rectangulares del contorno.
 *
 * Un escalon son tres rectas donde la primera y la tercera van en
 * sentidos opuestos y la del medio les es perpendicular. Si el contorno
 * gira dos veces hacia afuera es una espiga; si gira dos veces hacia
 * adentro es una caja. El sentido lo da el signo del producto cruz, y
 * por eso el anillo se normaliza a antihorario antes.
 *
 * Las tres rectas NO vienen seguidas vertice a vertice en un archivo de
 * CAM real. Entre flanco y fondo casi siempre hay un chaflan a 45, un
 * hueso de perro o un rebaje que se hunde unos milimetros para que la
 * pieza que entra asiente. Exigir adyacencia estricta es lo que hacia
 * que una estanteria de Opendesk -que lleva alivio en TODAS sus juntas-
 * no diera ni una sola junta de canto.
 *
 * Por eso el recorrido no clasifica las aristas por su largo, sino por
 * el PAPEL que juegan: desde un flanco se camina hacia adelante hasta
 * dar con el flanco opuesto, se admite UN fondo perpendicular por el
 * camino, y todo lo demas es alivio mientras no sume mas que un tablero
 * de ancho. Un chaflan de 5.7 mm y un hombro de 5 mm no se distinguen
 * por su medida -son casi iguales- pero si por donde caen.
 *
 * Cuando el alivio se comio el fondo entero, el fondo se reconstruye
 * entre las puntas de los dos flancos: ahi es donde asienta la pieza
 * que entra, y no en el rebaje que se hunde cuatro milimetros mas.
 */
function escalonesDe(anillo: Pt[], c: ContornoCnc, espesor: number, tableros: number[]): Junta[] {
  const n = anillo.length;
  if (n < 3) return [];

  const ar: Arista[] = [];
  for (let i = 0; i < n; i++) {
    const a = anillo[i];
    const b = anillo[(i + 1) % n];
    const d = resta(b, a);
    const len = largoDe(d);
    if (len > 1e-6) ar.push({ a, b, dir: unit(d), len });
  }
  const N = ar.length;
  if (N < 3) return [];

  /** Por debajo de esto una arista no puede hacer de flanco ni de fondo. */
  const minLado = Math.max(3, espesor * 0.35);
  /** Un alivio de fresa no pasa de un tablero de ancho. */
  const maxRuido = Math.max(6, espesor * 1.6);

  /**
   * Raiz de una espiga: se camina hacia afuera del escalon por encima
   * del alivio hasta topar con un lado de verdad del contorno. Ahi es
   * donde la espiga es mas ancha, y es su seccion mas ancha la que topa
   * contra la mortaja; la punta, mas fina por el chaflan, solo guia la
   * entrada.
   *
   * Solo se cruza geometria OBLICUA al flanco. Es lo unico que separa un
   * chaflan de un hombro: los dos miden cinco milimetros y pico, pero el
   * chaflan va a 45 grados y el hombro sigue el canto. En la silla, que
   * viene toda a escuadra, cruzar el hombro estiraba una espiga de 65 a
   * 90 y la dejaba sin pareja.
   */
  const raizDe = (desde: number, flanco: Pt, haciaAtras: boolean): Pt => {
    let k = desde;
    let andado = 0;
    for (let paso = 0; paso < 4; paso++) {
      const j = haciaAtras ? (k - 1 + N) % N : (k + 1) % N;
      const e = ar[j];
      andado += e.len;
      if (andado > maxRuido) break;
      const cos = Math.abs(punto(flanco, e.dir));
      // Ni paralela al flanco ni perpendicular a el: solo el bisel.
      const oblicua = cos > 0.12 && cos < 0.95;
      if (!oblicua && e.len > 1) break;
      k = j;
    }
    return haciaAtras ? ar[k].a : ar[k].b;
  };

  const dim = Math.min(c.bbox.x1 - c.bbox.x0, c.bbox.y1 - c.bbox.y0);
  const out: Junta[] = [];

  for (let i = 0; i < N; i++) {
    const e1 = ar[i];
    if (e1.len < minLado) continue;

    // Hacia adelante hasta el flanco opuesto, admitiendo un fondo y el
    // alivio que quepa.
    let ruido = 0;
    let iFondo = -1;
    let iOpuesto = -1;
    for (let paso = 1; paso < N; paso++) {
      const j = (i + paso) % N;
      const e = ar[j];
      if (e.len >= minLado && punto(e1.dir, e.dir) < -0.95) {
        iOpuesto = j;
        break;
      }
      if (iFondo < 0 && e.len >= minLado && Math.abs(punto(e1.dir, e.dir)) <= 0.12) {
        iFondo = j;
        continue;
      }
      ruido += e.len;
      if (ruido > maxRuido) break;
    }
    if (iOpuesto < 0) continue;

    const e3 = ar[iOpuesto];
    let p12: Pt | null;
    let p23: Pt | null;
    let fondo: number;
    let g1: number;
    let g2: number;
    let baseFondo: Pt;
    let dirFondo: Pt;

    if (iFondo >= 0) {
      const e2 = ar[iFondo];
      p12 = corte(e1.a, e1.dir, e2.a, e2.dir);
      p23 = corte(e2.a, e2.dir, e3.a, e3.dir);
      if (!p12 || !p23) continue;
      // El fondo se mide desde el arranque de los flancos, que estan
      // sobre el canto principal, hasta la recta del medio.
      fondo = (aRecta(e1.a, e2.a, e2.dir) + aRecta(e3.b, e2.a, e2.dir)) / 2;
      g1 = cruz(e1.dir, e2.dir);
      g2 = cruz(e2.dir, e3.dir);
      baseFondo = e2.a;
      dirFondo = e2.dir;
    } else {
      // Sin fondo dibujado: lo levantan las puntas de los dos flancos.
      p12 = e1.b;
      p23 = e3.a;
      const d = resta(p23, p12);
      if (largoDe(d) < 1e-6) continue;
      dirFondo = unit(d);
      // El fondo tiene que cruzar de un flanco al otro, no correr a lo
      // largo de ellos.
      if (Math.abs(punto(e1.dir, dirFondo)) > 0.35) continue;
      baseFondo = p12;
      fondo =
        (Math.abs(punto(e1.dir, resta(e1.b, e1.a))) +
          Math.abs(punto(e1.dir, resta(e3.a, e3.b)))) / 2;
      g1 = cruz(e1.dir, dirFondo);
      g2 = cruz(dirFondo, e3.dir);
    }

    if (g1 * g2 <= 0) continue; // los dos giros al mismo lado, o no es escalon
    const espiga = g1 > 0;
    let largo = largoDe(resta(p23, p12));

    if (espiga) {
      const r1 = raizDe(i, e1.dir, true);
      const r2 = raizDe(iOpuesto, e3.dir, false);
      const eje = unit(resta(p23, p12));
      const raiz = Math.abs(punto(eje, resta(r2, r1)));
      if (raiz > largo && raiz <= largo + 2 * fondo + 1) {
        largo = raiz;
        fondo = (aRecta(r1, baseFondo, dirFondo) + aRecta(r2, baseFondo, dirFondo)) / 2;
      }
    }

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
    const anchoDeTablero = esTablero(largo, tableros, 1.7);
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
      propio: espesor,
    });
  }
  return out;
}

/**
 * Juntas del canto de una pieza, mirando el contorno de las dos
 * maneras.
 *
 * El contorno simplificado es el que hay que mirar primero: tirar los
 * vertices del teselado endereza los lados y deja las medidas limpias.
 * Pero el mismo filtro que endereza un arco se traga un chaflan de 4 mm,
 * y con el se traga la junta entera.
 *
 * Asi que despues se mira el contorno crudo, y de ahi solo se recogen
 * los escalones que el simplificado no vio. Ni una medida ya conocida se
 * reemplaza: sobre geometria teselada el crudo mide peor -en la mesa
 * movia la pose de la pata lo bastante para perder el cruce de las
 * medias maderas-, y lo que aporta no es precision sino las juntas que
 * el otro no alcanza a ver.
 */
function juntasDeCanto(c: ContornoCnc, espesor: number, tableros: number[]): Junta[] {
  const crudo = anilloLimpio(c.ext);
  const out = escalonesDe(simplificar(crudo, EPS_SIMPLIFICAR), c, espesor, tableros);
  for (const j of escalonesDe(crudo, c, espesor, tableros)) {
    const yaEsta = out.some(
      (q) =>
        q.tipo === j.tipo &&
        largoDe(resta(q.centro, j.centro)) < Math.max(espesor, j.largo * 0.5) &&
        Math.abs(q.largo - j.largo) <= espesor
    );
    if (!yaEsta) out.push(j);
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
function juntasDeCara(c: ContornoCnc, espesor: number, tableros: number[]): Junta[] {
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
        if (!esTablero(sep, tableros, 1.6)) continue;

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

        // Pero la envolvente tampoco es la medida: lo que entra en la
        // mortaja es la raiz de la espiga, y la raiz necesita la
        // seccion ENTERA. Asi que el largo util es el tramo seguido
        // donde el hueco tiene el ancho completo. La distincion importa
        // porque los dos alivios de esquina que existen tiran para
        // lados opuestos: un hueso de perro ensancha la punta -y ahi la
        // envolvente y la seccion entera coinciden, que es el caso del
        // banco-, mientras que un chaflan la estrecha -y ahi la
        // envolvente miente: en Opendesk daba 56 donde la espiga que
        // encaja mide 48-.
        const tramo = tramoDeAnchoEntero(p, u, nrm, tMedio, sep, s0, s1);
        if (!tramo) continue;
        // Recortar la punta solo si el recorte es del tamano de un
        // alivio. Un alivio lo acota el radio de la fresa y nunca llega
        // a medio ancho de ranura; si falta mas que eso, la punta no
        // esta achaflanada sino cortada en diagonal, y entonces la
        // espiga viene sesgada igual y entra por completo. La mortaja de
        // la mesa es un paralelogramo: medida a secciones perpendiculares
        // daba 31 de los 90 que mide.
        const maxRecorte = sep * 0.5;
        const u0 = tramo[0] - s0 <= maxRecorte ? tramo[0] : s0;
        const u1 = s1 - tramo[1] <= maxRecorte ? tramo[1] : s1;
        if (!(u1 - u0 >= espesor)) continue;

        const centro: Pt = [
          u[0] * ((u0 + u1) / 2) + nrm[0] * tMedio,
          u[1] * ((u0 + u1) / 2) + nrm[1] * tMedio,
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
          largo: Math.round((u1 - u0) * 10) / 10,
          fondo: Math.round(sep * 10) / 10,
          centro,
          eje: u,
          normal: [0, 0],
          etiqueta: `ranura ${Math.round(u1 - u0)}`,
          propio: espesor,
        });
      }
    }
  }
  return out;
}

/** Punto dentro de un anillo cerrado, por numero de cruces. */
function dentroDe(anillo: Pt[], q: Pt): boolean {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/**
 * Tramo seguido mas largo donde el hueco cubre la banda entera.
 *
 * Se recorre la ranura a lo largo preguntando, en cada paso, si sus dos
 * paredes siguen ahi. Donde un chaflan corta la esquina la respuesta es
 * que no, y ese tramo no cuenta: por angosto que sea el corte, la raiz
 * de la espiga no pasa. Donde un hueso de perro agranda la esquina la
 * respuesta sigue siendo que si, y el tramo cuenta entero.
 */
function tramoDeAnchoEntero(
  anillo: Pt[],
  u: Pt,
  nrm: Pt,
  tMedio: number,
  sep: number,
  s0: number,
  s1: number
): [number, number] | null {
  const t = sep / 2 - Math.min(0.4, sep * 0.05);
  const paso = Math.max(0.2, sep / 24);
  const en = (s: number) => {
    const a: Pt = [u[0] * s + nrm[0] * (tMedio + t), u[1] * s + nrm[1] * (tMedio + t)];
    const b: Pt = [u[0] * s + nrm[0] * (tMedio - t), u[1] * s + nrm[1] * (tMedio - t)];
    return dentroDe(anillo, a) && dentroDe(anillo, b);
  };

  let mejor: [number, number] | null = null;
  let arranque: number | null = null;
  let previo = s0;
  for (let s = s0; s <= s1 + paso / 2; s += paso) {
    const q = Math.min(s, s1);
    if (en(q)) {
      if (arranque === null) arranque = q;
      previo = q;
    } else if (arranque !== null) {
      if (!mejor || previo - arranque > mejor[1] - mejor[0]) mejor = [arranque, previo];
      arranque = null;
    }
  }
  if (arranque !== null && (!mejor || previo - arranque > mejor[1] - mejor[0])) {
    mejor = [arranque, previo];
  }
  if (!mejor) return null;
  // El muestreo se queda medio paso corto en cada punta.
  return [mejor[0] - paso / 2, mejor[1] + paso / 2];
}

/**
 * Todas las juntas de una pieza.
 *
 * `espesor` es el del tablero de la pieza -manda el suyo si lo trae- y
 * gobierna los umbrales de ruido del contorno. `tableros` son los
 * espesores que hay en el juego entero, contra los que se mide el ancho
 * de lo que ENTRA en cada junta.
 */
export function juntasDe(c: ContornoCnc, espesor: number, tableros?: number[]): Junta[] {
  const propio = c.espesor ?? espesor;
  const cand = tableros?.length ? tableros : [propio];
  return [...juntasDeCanto(c, propio, cand), ...juntasDeCara(c, propio, cand)];
}

/** Espesores distintos presentes en un juego de piezas. */
export function tablerosDe(piezas: ContornoCnc[], porDefecto: number): number[] {
  const v = new Set<number>();
  for (const p of piezas) v.add(p.espesor ?? porDefecto);
  return [...v].sort((a, b) => a - b);
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
    // Cada caja tiene que medir de ancho el tablero de la pieza que
    // recibe, que es la OTRA. Con un solo espesor en el juego da lo
    // mismo; con dos, comparar contra el propio rechaza la mitad de las
    // medias maderas buenas.
    const cabe = (x: Junta, otro: Junta) =>
      esTablero(x.largo, [otro.propio || espesor], 1.7);
    return cabe(a, b) && cabe(b, a) ? "media" : null;
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
  const tableros = tablerosDe(piezas, espesor);
  for (const p of piezas) porPieza[p.id] = juntasDe(p, espesor, tableros);

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

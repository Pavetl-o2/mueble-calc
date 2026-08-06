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

/**
 * Boca y fondo de una junta de canto, en coordenadas de la pieza.
 *
 * En una junta pasante las dos parejas coinciden en su centro, pero en
 * una media madera no: cada tablero entra hasta que su canto topa con
 * el fondo de la caja del otro, y como las dos cajas suelen tener
 * profundidades distintas -en la mesa, 60 y 89 mm, que suman el alto
 * del faldon- sus centros quedan a 15 mm uno del otro. Comparando
 * centros, ningun cruce cerraba.
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
    origenLocal = boca(nueva);
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
export function resolverArmado(piezas: ContornoCnc[], espesor: number): Armadura {
  const notas: string[] = [];
  if (!piezas.length) {
    return {
      instancias: [], uniones: [], juntasPorPieza: {}, sueltas: [],
      juntasLibres: 0, notas: ["Sin piezas."],
    };
  }

  const inv = inventarioJuntas(piezas, espesor);
  notas.push(...inv.notas);

  const porId = new Map(piezas.map((p) => [p.id, p]));
  const cupo = multiplicidad(piezas, inv.porPieza, espesor);
  const raiz = piezas.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));

  // La pieza mayor se acuesta y se centra: es el marco de referencia.
  // Cual sea no cambia el mueble, solo desde donde se mira.
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
    pose: poseRaiz,
    junta: j,
    mundo: alMundo(poseRaiz, j.centro),
  }));

  const sinColocar = new Set(piezas.filter((p) => p !== raiz).map((p) => p.id));

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
      lejania: number;
      altura: number;
      choque: number;
      paralela: boolean;
    } | null = null;

    for (const p of piezas) {
      const usadas = copias.get(p.id) ?? 0;
      if (usadas >= (cupo.get(p.id) ?? 1)) continue;
      const juntas = inv.porPieza[p.id] ?? [];
      if (!juntas.length) continue;

      for (const libre of libres) {
        for (const jn of juntas) {
          const modo = encajan(libre.junta, jn, espesor);
          if (!modo) continue;
          for (const r of [1, -1]) {
            for (const s of [1, -1]) {
              const pose = poseDeJunta(libre.pose, libre.junta, jn, modo, r, s);
              if (!pose) continue;

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
                    m === "media" ? alMundo(pose, boca(otra)) : alMundo(pose, otra.centro);
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

    // Las juntas usadas dejan de estar libres, y las de la pieza recien
    // puesta entran al juego.
    const gastadas = new Set(mejor.cierra);
    for (let i = libres.length - 1; i >= 0; i--) if (gastadas.has(libres[i])) libres.splice(i, 1);
    const usadasPropias = new Set(mejor.propias);
    for (const j of inv.porPieza[mejor.piezaId] ?? []) {
      if (usadasPropias.has(j)) continue;
      libres.push({ instancia: id, pose: mejor.pose, junta: j, mundo: alMundo(mejor.pose, j.centro) });
    }
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
  };
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

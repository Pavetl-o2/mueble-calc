import { analizarCanto, type ContornoCnc, type Pt } from "./cnc";
import { orientarPieza, type Orientacion } from "./cncArmado";

// ---------------------------------------------------------------
// DETECCION DE ENSAMBLES (fase E3, arranque)
//
// Hasta aqui el armado colocaba las piezas por simetria: sabia CUANTAS
// hay y las repartia, pero no donde encaja cada una. Esto empieza a
// resolverlo leyendo los ensambles que estan cortados en la pieza.
//
// El truco es que en una pieza plana el espesor de una espiga no se
// dibuja: sale del tablero. Lo que si se dibuja es su ANCHO. Asi que
// una espiga de ancho A en un tablero de espesor E necesita una mortaja
// de E x A, y basta con cruzar esas dos medidas para emparejarlas.
//
// Cuando la mortaja es mas ancha que el espesor, la pieza entra en
// angulo: acos(espesor / ancho) lo da directo.
//
// Lo que SI resuelve: que espiga va en que mortaja, y por lo tanto
// donde cae cada pieza respecto al panel.
// Lo que NO resuelve todavia: los ensambles entre piezas verticales, que
// se detectan y se reportan pero no se usan para colocar.
// ---------------------------------------------------------------

export interface Lengueta {
  /** Posicion del centro sobre el canto de union, medida desde el borde
   *  izquierdo de la pieza ya orientada, en mm. */
  x: number;
  /** Ancho en el plano de la pieza. Es lo que tiene que medir la mortaja. */
  ancho: number;
  /** Cuanto sobresale del hombro. Deberia rondar el espesor del panel. */
  vuelo: number;
}

export interface Ranura {
  /** Ancho de la ranura. Igual al espesor si la pieza entra a escuadra. */
  ancho: number;
  /** Largo de la ranura. Es el ancho que debe tener la espiga. */
  largo: number;
  /** Angulo de entrada implicito, en grados. 0 = a escuadra. */
  angulo: number;
}

export interface Mortaja {
  /** Indice del hueco dentro del panel. */
  idx: number;
  /** Centro respecto al centro del panel, en mm. */
  cx: number;
  cy: number;
  ranuras: Ranura[];
}

export interface Ensamble {
  piezaId: string;
  /** Indice de la lengueta dentro de la pieza. */
  lengueta: number;
  /** Indice de la mortaja del panel. */
  mortaja: number;
  /** Cuanto sobra entre espiga y ranura, en mm. Negativo = no cabe. */
  holgura: number;
  angulo: number;
}

export interface LecturaEnsambles {
  /** Lenguetas por pieza, sobre su canto de union. */
  lenguetas: Record<string, Lengueta[]>;
  mortajas: Mortaja[];
  ensambles: Ensamble[];
  /** Lenguetas que no encontraron mortaja en el panel. */
  sinPareja: number;
  notas: string[];
}

/** Holgura maxima aceptable entre espiga y ranura para darlas por pareja. */
const TOLERANCIA_MM = 3;

// ---------------------------------------------------------------

/**
 * Encuentra las espigas del canto de union de una pieza.
 *
 * Se apoya en que orientarPieza ya dejo ese canto arriba. Bajando desde
 * el borde superior, el material cubierto da un salto justo al pasar el
 * hombro: arriba solo estan las espigas, debajo esta el cuerpo entero.
 * Ese salto es el hombro, y los tramos que quedan encima son las espigas.
 */
export function detectarLenguetas(c: ContornoCnc, orient?: Orientacion): Lengueta[] {
  const o = orient ?? orientarPieza(c);
  const ca = Math.cos(o.giro);
  const sa = Math.sin(o.giro);
  const s = o.espejo ? -1 : 1;
  const pts: Pt[] = c.ext.map(([x, y]) => [s * (x * ca - y * sa), x * sa + y * ca]);

  const xs = pts.map((p) => p[0]);
  const x0 = Math.min(...xs);

  const canto = analizarCanto(pts);
  if (!canto) return [];

  return canto.salientes.map(([a, b]) => ({
    x: r1((a + b) / 2 - x0),
    ancho: r1(b - a),
    vuelo: r1(canto.vuelo),
  }));
}

/**
 * Descompone una mortaja en las ranuras que la forman. Una cruz son dos
 * ranuras cruzadas, y cada una puede tener su propio ancho porque las
 * piezas entran con angulos distintos.
 */
export function ranurasDeMortaja(hueco: Pt[], espesor: number): Ranura[] {
  const xs = hueco.map((p) => p[0]);
  const ys = hueco.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);

  // Aristas rectas: en una ranura simple el lado corto es el ancho; en
  // una cruz los brazos aparecen como las aristas cortas repetidas.
  const rectas: number[] = [];
  for (let i = 0; i < hueco.length - 1; i++) {
    const d = Math.hypot(hueco[i + 1][0] - hueco[i][0], hueco[i + 1][1] - hueco[i][1]);
    if (d > 1.5) rectas.push(Math.round(d * 2) / 2);
  }
  const cuenta = new Map<number, number>();
  for (const v of rectas) if (v <= Math.max(w, h) * 0.9) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);

  const anchos = [...cuenta.entries()]
    .filter(([v, n]) => n >= 2 && v >= espesor * 0.7 && v <= espesor * 3)
    .map(([v]) => v)
    .sort((a, b) => a - b);

  const largo = r1(Math.max(w, h));
  if (!anchos.length) {
    return [{ ancho: r1(Math.min(w, h)), largo, angulo: anguloDe(espesor, Math.min(w, h)) }];
  }
  return anchos.map((a) => ({ ancho: a, largo, angulo: anguloDe(espesor, a) }));
}

function anguloDe(espesor: number, ancho: number): number {
  if (!(ancho > espesor * 1.02)) return 0;
  const rel = Math.min(1, espesor / ancho);
  return Math.round(Math.acos(rel) * (180 / Math.PI) * 10) / 10;
}

/**
 * Cruza las espigas de cada pieza con las ranuras del panel. El criterio
 * es puramente dimensional: una espiga de ancho A entra en una ranura de
 * largo A, con la holgura de mecanizado.
 */
export function detectarEnsambles(
  piezas: ContornoCnc[],
  panel: ContornoCnc | undefined,
  espesor: number
): LecturaEnsambles {
  const notas: string[] = [];
  const lenguetas: Record<string, Lengueta[]> = {};
  const verticales = piezas.filter((p) => p !== panel);

  for (const p of verticales) lenguetas[p.id] = detectarLenguetas(p);

  const mortajas: Mortaja[] = [];
  if (panel) {
    const pcx = (panel.bbox.x0 + panel.bbox.x1) / 2;
    const pcy = (panel.bbox.y0 + panel.bbox.y1) / 2;
    panel.huecos.forEach((h, idx) => {
      const xs = h.map((q) => q[0]);
      const ys = h.map((q) => q[1]);
      mortajas.push({
        idx,
        cx: r1((Math.min(...xs) + Math.max(...xs)) / 2 - pcx),
        cy: r1((Math.min(...ys) + Math.max(...ys)) / 2 - pcy),
        ranuras: ranurasDeMortaja(h, espesor),
      });
    });
  }

  // Emparejado: cada pieza toma la mortaja libre que mejor le encaje.
  const ensambles: Ensamble[] = [];
  const usadas = new Set<number>();
  let sinPareja = 0;

  for (const p of verticales) {
    const ls = lenguetas[p.id] ?? [];
    if (!ls.length) {
      sinPareja += 0;
      continue;
    }
    // La espiga principal es la mas ancha: es la que ata la pieza al panel.
    let mejorL = 0;
    ls.forEach((lg, i) => {
      if (lg.ancho > ls[mejorL].ancho) mejorL = i;
    });
    const lg = ls[mejorL];

    let elegida = -1;
    let mejorHolgura = Infinity;
    let anguloElegido = 0;
    for (const m of mortajas) {
      if (usadas.has(m.idx)) continue;
      for (const r of m.ranuras) {
        const holgura = r.largo - lg.ancho;
        if (holgura < -TOLERANCIA_MM || holgura > TOLERANCIA_MM * 4) continue;
        if (Math.abs(holgura) < Math.abs(mejorHolgura)) {
          mejorHolgura = holgura;
          elegida = m.idx;
          anguloElegido = r.angulo;
        }
      }
    }

    if (elegida >= 0) {
      usadas.add(elegida);
      ensambles.push({
        piezaId: p.id,
        lengueta: mejorL,
        mortaja: elegida,
        holgura: r1(mejorHolgura),
        angulo: anguloElegido,
      });
    } else {
      sinPareja += 1;
    }
  }

  const totalLeng = Object.values(lenguetas).reduce((a, v) => a + v.length, 0);
  if (totalLeng === 0) {
    notas.push(
      "No se detectaron espigas en las piezas. El armado se reparte por simetria, sin usar los ensambles."
    );
  } else {
    notas.push(
      `${totalLeng} espiga(s) detectada(s) y ${ensambles.length} emparejada(s) con mortajas del panel.`
    );
    const otras = totalLeng - ensambles.length;
    if (otras > 0) {
      notas.push(
        `Quedan ${otras} espiga(s) sin mortaja en el panel: son uniones entre piezas, que todavia no se resuelven.`
      );
    }
  }

  return { lenguetas, mortajas, ensambles, sinPareja, notas };
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

import type { ContornoCnc, LecturaCnc, Pt } from "./cnc";
import { mkPart, resetIds, round } from "./typologies/helpers";
import type { ModelResult, Part } from "./types";

// ---------------------------------------------------------------
// ARMADO DE PIEZAS DE CORTE
//
// Toma los contornos que salieron del DXF y hace dos cosas distintas:
//
//   1. despieceCnc(): la lista de piezas para costear. Esto es exacto,
//      no hay nada que adivinar: el area y el perimetro salen medidos
//      del contorno.
//
//   2. proponerArmado(): una hipotesis de como se arma en 3D. Esto SI
//      es una aproximacion. No resuelve el encaje espiga por espiga;
//      reconoce una familia de armado y coloca las piezas por simetria.
//      Sirve para ver el mueble, no para fabricar.
//
// La familia que reconoce es "panel + perimetrales": un panel grande
// con mortajas, y varias piezas iguales que entran en el. Cubre mesas,
// bancos y taburetes flat-pack, que es de donde salio el modulo.
// ---------------------------------------------------------------

export type Rol = "panel" | "vertical" | "otro";

/**
 * Colocacion en coordenadas de la familia, no en Euler crudo. Los angulos
 * de Euler dependen del orden en que se compongan y son faciles de
 * equivocar; estos cuatro numeros describen el armado como lo describiria
 * un carpintero, y el visor los compone en el orden correcto.
 */
export interface Colocacion {
  piezaId: string;
  rol: Rol;
  /** Giro alrededor del eje vertical, en radianes. */
  giro: number;
  /** Distancia de la pieza al eje vertical, en mm. */
  radio: number;
  /** Altura del centro de la pieza, en mm. */
  z: number;
  /** Inclinacion respecto a la vertical, en radianes. 0 = parada a plomo. */
  inclinacion: number;
  /** Acostada (panel horizontal) o parada (pieza vertical). */
  acostada: boolean;
}

export interface Armado {
  colocaciones: Colocacion[];
  /** Alto total resultante, en mm. */
  alto: number;
  familia: string;
  /** Que tan confiable es. El armado nunca es exacto. */
  confianza: "alta" | "media" | "baja";
  notas: string[];
}

export interface OpcionesArmado {
  /** Alto total del mueble en mm. */
  alto: number;
  /** Inclinacion de las piezas verticales, en grados. 0 = a escuadra. */
  inclinacion: number;
  /** Distancia del centro a cada pieza vertical, en mm. */
  radio: number;
  /** Roles por pieza, si la imagen de referencia los aporto. */
  roles?: Record<string, Rol>;
}

const COLOR_PANEL = "#E3D4B8";
const COLOR_VERT = "#D9C7A7";

// ---------------------------------------------------------------
// 1) Despiece
// ---------------------------------------------------------------

export interface AsignacionCnc {
  /** SKU de material por pieza. */
  material: Record<string, string>;
  /** Piezas que se cantean en todo su contorno. */
  cantear: Record<string, boolean>;
  cantoSku: string;
  espesor: number;
}

/**
 * Contornos -> lista de piezas costeable. Cada contorno es una pieza
 * con su area y perimetro reales; el bbox solo se usa para ubicarla.
 */
export function despieceCnc(
  lectura: LecturaCnc,
  asig: AsignacionCnc,
  catalogo?: { materiales: { sku: string; nombre: string; espesor: number }[] }
): ModelResult {
  resetIds();
  const parts: Part[] = [];
  const warnings: string[] = [];
  const t = asig.espesor;

  lectura.piezas.forEach((c, i) => {
    const p = mkPart({
      nombre: nombrarPieza(c, i, lectura),
      grupo: nombrarPieza(c, i, lectura),
      material: asig.material[c.id] ?? "",
      // La pieza se acuesta: X e Y son la cara, Z el espesor.
      sx: c.bbox.x1 - c.bbox.x0,
      sy: c.bbox.y1 - c.bbox.y0,
      sz: t,
      px: c.bbox.x0,
      py: c.bbox.y0,
      pz: 0,
      ruta: "cnc",
      color: c.huecos.length ? COLOR_PANEL : COLOR_VERT,
      cantoSku: asig.cantear[c.id] ? asig.cantoSku : undefined,
      cantos: asig.cantear[c.id] ? { l1: true } : undefined,
      maquinado: c.huecos.length ? [`${c.huecos.length} mortaja(s)`] : undefined,
    });
    p.areaRealM2 = c.areaMm2 / 1e6;
    p.perimetroRealM = c.perimetroMm / 1000;
    p.contorno = { ext: c.ext, huecos: c.huecos };
    parts.push(p);
  });

  for (const p of parts) {
    if (!p.material) {
      warnings.push("Hay piezas sin material asignado; no entran al costo.");
      break;
    }
  }

  // El espesor sale medido del dibujo, asi que si el material elegido es de
  // otro calibre las mortajas no van a cerrar en el mueble real.
  if (catalogo) {
    const distintos = new Set<string>();
    for (const p of parts) {
      const mat = catalogo.materiales.find((m) => m.sku === p.material);
      if (mat && Math.abs(mat.espesor - t) > 0.5) distintos.add(`${mat.nombre} (${mat.espesor} mm)`);
    }
    if (distintos.size) {
      warnings.push(
        `El corte esta dibujado para ${t} mm, pero hay piezas asignadas a ${[...distintos].join(
          ", "
        )}. Las mortajas no cerrarian.`
      );
    }
  }
  if (lectura.extremosSueltos > 0) {
    warnings.push(
      `${lectura.extremosSueltos} contorno(s) no cerraron. Puede faltar area en el costo.`
    );
  }

  const bbox = {
    w: round(Math.max(...parts.map((p) => p.px + p.sx)) - Math.min(...parts.map((p) => p.px))),
    d: round(Math.max(...parts.map((p) => p.py + p.sy)) - Math.min(...parts.map((p) => p.py))),
    h: t,
  };

  return { parts, hardware: [], bbox, warnings };
}

function nombrarPieza(c: ContornoCnc, i: number, l: LecturaCnc): string {
  const esPanel = c === panelDe(l);
  if (esPanel) return "Panel";
  return `Pieza ${i + 1}`;
}

// ---------------------------------------------------------------
// 2) Armado
// ---------------------------------------------------------------

/** El panel es el contorno de mayor area, y normalmente el que trae mortajas. */
export function panelDe(l: LecturaCnc): ContornoCnc | undefined {
  if (!l.piezas.length) return undefined;
  const conHuecos = l.piezas.filter((p) => p.huecos.length > 0);
  const pool = conHuecos.length ? conHuecos : l.piezas;
  return pool.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));
}

/** Centro de cada mortaja del panel, relativo al centro del panel. */
export function mortajas(panel: ContornoCnc): Pt[] {
  const cx = (panel.bbox.x0 + panel.bbox.x1) / 2;
  const cy = (panel.bbox.y0 + panel.bbox.y1) / 2;
  return panel.huecos.map((h) => {
    const xs = h.map((p) => p[0]);
    const ys = h.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2 - cx, (Math.min(...ys) + Math.max(...ys)) / 2 - cy] as Pt;
  });
}

/**
 * Valores de arranque leidos del propio dibujo: radio desde las
 * mortajas, inclinacion desde el ancho de las ranuras, alto desde la
 * pieza vertical mas larga.
 */
export function opcionesSugeridas(l: LecturaCnc): OpcionesArmado {
  const panel = panelDe(l);
  const verticales = l.piezas.filter((p) => p !== panel);

  // El radio es la separacion PERPENDICULAR del eje a cada pieza, no la
  // distancia en diagonal a la mortaja: con mortajas en las esquinas
  // (±415, ±415) los faldones corren a 415 del centro, no a 587.
  const ms = panel ? mortajas(panel) : [];
  const radio = ms.length
    ? Math.round(ms.reduce((a, m) => a + Math.max(Math.abs(m[0]), Math.abs(m[1])), 0) / ms.length)
    : panel
    ? Math.round(Math.min(panel.largo, panel.ancho) * 0.35)
    : 300;

  // La ranura mas ancha delata el angulo con que entra la pieza.
  const angular = l.ranuras.find((r) => r.anguloGrados != null);
  const inclinacion = angular?.anguloGrados ?? 0;

  // El alto sale del lado CORTO de la caja de la pieza vertical, no del
  // largo: una pata que viene dibujada en diagonal, o unida a su faldon en
  // una sola pieza en L, tiene una caja mucho mas grande que su altura real.
  const alto = verticales.length
    ? Math.round(Math.max(...verticales.map((v) => v.ancho)))
    : 750;

  return { alto, inclinacion, radio };
}

/**
 * Coloca el panel arriba y reparte las piezas verticales alrededor del
 * centro con simetria rotacional. No resuelve el encaje real: usa el
 * radio y la inclinacion como parametros, que el usuario puede corregir.
 */
export function proponerArmado(l: LecturaCnc, op: OpcionesArmado): Armado {
  const notas: string[] = [];
  const colocaciones: Colocacion[] = [];
  const panel = panelDe(l);
  if (!panel) {
    return { colocaciones: [], alto: 0, familia: "desconocida", confianza: "baja", notas: ["Sin piezas."] };
  }

  // El visor centra cada contorno en su propio bbox, asi que la colocacion
  // solo dice donde va ese centro y como queda orientado.
  const t = l.espesor ?? 18;
  const verticales = l.piezas.filter((p) => p !== panel);
  const n = verticales.length;

  // Panel: acostado, centrado, arriba del todo.
  colocaciones.push({
    piezaId: panel.id,
    rol: "panel",
    giro: 0,
    radio: 0,
    z: op.alto - t / 2,
    inclinacion: 0,
    acostada: true,
  });

  // Verticales: paradas, repartidas en n direcciones, inclinadas hacia
  // afuera el angulo que delataron las mortajas.
  const inc = (op.inclinacion * Math.PI) / 180;
  verticales.forEach((v, k) => {
    colocaciones.push({
      piezaId: v.id,
      rol: op.roles?.[v.id] ?? "vertical",
      giro: (k / Math.max(1, n)) * Math.PI * 2,
      radio: op.radio,
      z: op.alto / 2,
      inclinacion: inc,
      acostada: false,
    });
  });

  const iguales = verticales.every(
    (v) => Math.abs(v.areaMm2 - verticales[0].areaMm2) < verticales[0].areaMm2 * 0.05
  );

  let confianza: Armado["confianza"] = "baja";
  if (panel.huecos.length && iguales && n >= 3 && panel.huecos.length % n === 0) confianza = "media";
  if (confianza === "media" && op.inclinacion > 0) confianza = "alta";

  notas.push(
    `Armado propuesto: 1 panel con ${panel.huecos.length} mortaja(s) y ${n} pieza(s) vertical(es) repartidas cada ${Math.round(
      360 / Math.max(1, n)
    )}°.`
  );
  if (!iguales) {
    notas.push("Las piezas verticales no son todas iguales; la simetria rotacional es una suposicion fuerte.");
  }
  notas.push(
    "Esta vista es una hipotesis de armado, no un modelo de fabricacion: no resuelve espiga por espiga."
  );

  return { colocaciones, alto: op.alto + t, familia: "panel + perimetrales", confianza, notas };
}

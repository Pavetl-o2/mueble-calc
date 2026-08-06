import { analizarCanto, type ContornoCnc, type LecturaCnc, type Pt } from "./cnc";
import { detectarEnsambles } from "./cncEnsambles";
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

/**
 * Rol de una pieza dentro del mueble armado.
 *
 * Es el vocabulario con el que la imagen de referencia puede describir el
 * armado. Antes solo habia "panel" y "vertical", que alcanza para una mesa
 * de patas iguales pero no para una silla: no habia forma de decir "esto
 * es un travesano acostado" ni "esto va en el plano del costado", asi que
 * la imagen no podia cambiar nada aunque acertara.
 *
 *   panel      superficie horizontal principal (cubierta, asiento)
 *   horizontal otra pieza acostada (travesano, repisa, refuerzo)
 *   lateral    pieza de pie en el plano de los costados
 *   frontal    pieza de pie en el plano del frente y el respaldo
 *   otro       no se sabe; se trata como lateral
 */
export type Rol = "panel" | "horizontal" | "lateral" | "frontal" | "otro";

/** Roles que van de pie. El resto se acuesta. */
export function esDePie(r: Rol): boolean {
  return r === "lateral" || r === "frontal" || r === "otro";
}

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
  /**
   * Altura en mm. Para el panel es la de su plano medio; para una pieza
   * vertical, la de su CANTO SUPERIOR, que es el que topa con el panel y
   * ademas hace de eje al inclinarla.
   */
  z: number;
  /** Inclinacion respecto a la vertical, en radianes. 0 = parada a plomo. */
  inclinacion: number;
  /** Acostada (panel horizontal) o parada (pieza vertical). */
  acostada: boolean;
  /** Giro dentro de su propio plano para dejarla en posicion de armado. */
  giroLocal: number;
  /** Voltearla de cara, por como venia acomodada en la hoja de corte. */
  espejo: boolean;
  /**
   * Corrimiento a lo largo de su propio eje, en mm. Sale de alinear su
   * espiga con la mortaja: sin esto la pieza queda centrada en el lado,
   * que casi nunca es donde va.
   */
  desliz: number;
  /** De donde salio la colocacion, para poder decirlo en pantalla. */
  fuente: "ensamble" | "imagen" | "simetria";
}

/** Correccion manual sobre lo que propuso el armador. Todo son deltas. */
export interface AjustePieza {
  giro?: number;
  radio?: number;
  desliz?: number;
  z?: number;
  inclinacion?: number;
  giroLocal?: number;
  /** Invierte el volteo que decidio la orientacion automatica. */
  voltear?: boolean;
}

export const AJUSTE_VACIO: AjustePieza = {};

/** Aplica los deltas del usuario sobre una colocacion propuesta. */
export function aplicarAjuste(c: Colocacion, a?: AjustePieza): Colocacion {
  if (!a) return c;
  const g = (v: number | undefined) => ((v ?? 0) * Math.PI) / 180;
  return {
    ...c,
    giro: c.giro + g(a.giro),
    radio: c.radio + (a.radio ?? 0),
    desliz: c.desliz + (a.desliz ?? 0),
    z: c.z + (a.z ?? 0),
    inclinacion: c.inclinacion + g(a.inclinacion),
    giroLocal: c.giroLocal + g(a.giroLocal),
    espejo: a.voltear ? !c.espejo : c.espejo,
  };
}

export interface Orientacion {
  /** Radianes a girar el contorno para dejarlo en posicion de armado. */
  giro: number;
  /** Si hay que reflejarlo en X despues de girarlo. */
  espejo: boolean;
  ancho: number;
  alto: number;
}

const rot = (pts: Pt[], a: number): Pt[] =>
  pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as Pt);

/**
 * Giros a probar: los que dejan HORIZONTAL a alguna arista de la pieza,
 * por arriba y por abajo.
 *
 * Se sacan de la propia geometria en vez de barrer el circulo porque asi
 * el juego de candidatos no depende de como venga girada la pieza en la
 * hoja de corte: dos copias de la misma pata, nesteadas en angulos
 * distintos, generan el mismo conjunto y acaban en la misma pose. Un
 * barrido ciego a paso fijo no da esa garantia, y ademas cuesta cien
 * veces mas.
 */
function girosCandidatos(pts: Pt[]): number[] {
  const dosPi = Math.PI * 2;
  const out: number[] = [];
  const agregar = (g: number) => {
    const n = ((g % dosPi) + dosPi) % dosPi;
    if (!out.some((v) => Math.abs(v - n) < 1e-4 || dosPi - Math.abs(v - n) < 1e-4)) out.push(n);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    if (Math.hypot(dx, dy) < 2) continue;
    const a = Math.atan2(dy, dx);
    agregar(-a);
    agregar(-a + Math.PI);
  }
  return out.length ? out : [0];
}

/**
 * Que tan bien se para la pieza en esta pose: cuanto abarca su apoyo en
 * el piso y cuanto canto plano ofrece por arriba.
 *
 * Es el criterio de reserva para las piezas que no declaran espigas. Un
 * costado en A no tiene un canto de union reconocible, pero si tiene dos
 * pies que caen en la misma linea, y esa linea solo queda horizontal en
 * la pose de armado.
 */
function estabilidad(pts: Pt[]): number {
  const ys = pts.map((p) => p[1]);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const banda = Math.max(1, (yMax - yMin) * 0.02);
  let x0 = Infinity;
  let x1 = -Infinity;
  let tope = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (Math.abs(ay - by) > banda) continue;
    if (ay - yMin < banda && by - yMin < banda) {
      x0 = Math.min(x0, ax, bx);
      x1 = Math.max(x1, ax, bx);
    } else if (yMax - ay < banda && yMax - by < banda) {
      tope += Math.abs(bx - ax);
    }
  }
  return (x1 > x0 ? x1 - x0 : 0) + tope;
}

/**
 * Deja una pieza en su posicion de armado dentro de su propio plano.
 *
 * Hace falta porque en la hoja de corte las piezas vienen giradas y
 * espejeadas para aprovechar el tablero: cuatro patas identicas pueden
 * venir en cuatro orientaciones distintas. Si se levantan tal como
 * vienen, cada una acaba con un canto distinto contra la cubierta y el
 * mueble no cierra.
 *
 * Hay dos criterios, y cual aplica lo decide la pieza:
 *
 *   1. Si trae ESPIGAS, ellas mandan: una espiga es la pieza diciendo
 *      por donde se une, y ese canto va arriba. Se mide la linea de
 *      hombro para no confundir la union con un recorte cualquiera; la
 *      de un faldon de mesa mide 970 de sus 1122 mm, la de una esquina
 *      recortada unos pocos.
 *   2. Si no, se para donde mejor se sostiene: el apoyo mas ancho abajo
 *      y el canto mas plano arriba. Un costado en A no tiene espigas
 *      pero si dos pies, y solo hay una pose en que ambos tocan el piso.
 *
 * Antes se buscaba el giro que pusiera mas perimetro a escuadra. Eso
 * funciona en una pieza rectilinea y se cae en cuanto la arista mas
 * larga es diagonal: el costado en A de una silla salia tumbado 60°,
 * porque lo que quedaba horizontal era una de sus patas.
 *
 * Al final se refleja si hace falta, para que el pie caiga siempre del
 * mismo lado. Reflejar una pieza plana es voltearla de cara, que en un
 * tablero es legitimo.
 */
export function orientarPieza(c: ContornoCnc, espesor?: number): Orientacion {
  const giros = girosCandidatos(c.ext);
  const dimMax = Math.max(c.bbox.x1 - c.bbox.x0, c.bbox.y1 - c.bbox.y0) || 1;

  let giro = giros[0];
  let hombro = 0;
  for (const g of giros) {
    const canto = analizarCanto(rot(c.ext, g), espesor);
    if (canto && canto.anchoHombro > hombro) {
      hombro = canto.anchoHombro;
      giro = g;
    }
  }

  // La linea de hombro tiene que abarcar buena parte de la pieza para
  // creerle. Si no, lo que se encontro es ruido del contorno y no la
  // union, y se decide por como se para.
  if (hombro < dimMax * 0.5) {
    let mejor = -1;
    for (const g of giros) {
      const s = estabilidad(rot(c.ext, g));
      if (s > mejor) {
        mejor = s;
        giro = g;
      }
    }
  }

  let pts = rot(c.ext, giro);
  const ys2 = pts.map((p) => p[1]);
  const h = Math.max(...ys2) - Math.min(...ys2) || 1;
  const yMin = Math.min(...ys2);
  const xs = pts.map((p) => p[0]);
  const cxb = (Math.min(...xs) + Math.max(...xs)) / 2;
  const pie = pts.filter((p) => p[1] < yMin + h * 0.05);
  const pieX = pie.length ? pie.reduce((a, p) => a + p[0], 0) / pie.length : cxb;
  const espejo = pieX < cxb;
  if (espejo) pts = pts.map(([x, y]) => [-x, y] as Pt);

  const fx = pts.map((p) => p[0]);
  const fy = pts.map((p) => p[1]);
  return {
    giro,
    espejo,
    ancho: Math.max(...fx) - Math.min(...fx),
    alto: Math.max(...fy) - Math.min(...fy),
  };
}

export interface Armado {
  colocaciones: Colocacion[];
  /** Alto total resultante, en mm. */
  alto: number;
  /**
   * Cota del punto mas bajo del mueble. El visor apoya el piso ahi, en vez
   * de en una altura fija: si no, al mover el alto el mueble se hunde o
   * flota y parece que el suelo se mueve.
   */
  alturaPiso: number;
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
export function panelDe(l: LecturaCnc, roles?: Record<string, Rol>): ContornoCnc | undefined {
  if (!l.piezas.length) return undefined;

  // Si la imagen dijo cual es el panel, manda ella: reconocer la
  // superficie principal es justo lo que una foto hace bien y la
  // geometria no.
  const dicho = l.piezas.find((p) => roles?.[p.id] === "panel");
  if (dicho) return dicho;

  // Si no, la de MAYOR AREA. Los huecos son un desempate, no un filtro:
  // antes se exigia tenerlos y en una silla eso elige el costado (que
  // recibe el travesano) en vez del asiento, que es la pieza principal.
  const mayor = l.piezas.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));
  const conHuecos = l.piezas.filter((p) => p.huecos.length > 0);
  if (!conHuecos.length) return mayor;
  const mayorConHuecos = conHuecos.reduce((a, b) => (b.areaMm2 > a.areaMm2 ? b : a));
  // El desempate solo aplica si son comparables en tamano.
  return mayorConHuecos.areaMm2 >= mayor.areaMm2 * 0.85 ? mayorConHuecos : mayor;
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

  // La apertura arranca en cero a proposito. Una ranura mas ancha que el
  // espesor dice que la ESPIGA entra en angulo, y eso se consigue casi
  // siempre cortando el hombro en diagonal, con el tablero a plomo: en
  // flat-pack de CNC los paneles son verticales u horizontales salvo
  // excepcion. Inclinar la pieza entera por ese dato desarma el mueble.
  // El angulo se reporta y el usuario lo aplica si de verdad va inclinada.
  const inclinacion = 0;

  // El alto se mide sobre la pieza YA ORIENTADA, no sobre su caja en la
  // hoja de corte. Una pata dibujada en diagonal, o unida a su faldon en
  // una sola pieza en L, tiene una caja que no se parece a su altura: hay
  // que pararla primero y despues medirla.
  const alto = verticales.length
    ? Math.round(Math.max(...verticales.map((v) => orientarPieza(v, l.espesor).alto)))
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
  const panel = panelDe(l, op.roles);
  if (!panel) {
    return {
      colocaciones: [], alto: 0, alturaPiso: 0,
      familia: "desconocida", confianza: "baja", notas: ["Sin piezas."],
    };
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
    giroLocal: 0,
    espejo: false,
    desliz: 0,
    fuente: "ensamble",
  });

  // Verticales: colgadas del panel por su canto superior. Si se pudo
  // emparejar su espiga con una mortaja, la posicion sale de ahi; si no,
  // se reparten por simetria como antes.
  const ens = detectarEnsambles(l.piezas, panel, t);
  const porPieza = new Map(ens.ensambles.map((e) => [e.piezaId, e]));
  const inc = (op.inclinacion * Math.PI) / 180;

  // Dos familias, y elegir mal es lo que descuadraba todo lo que no fuera
  // una mesa. El molinete (repartir en angulos iguales alrededor del eje)
  // solo tiene sentido si las piezas son INTERCAMBIABLES: cuatro patas
  // iguales. Con piezas distintas -un asiento, un costado, un travesano-
  // rotarlas 120 grados cada una no describe ningun mueble.
  const areas = verticales.map((v) => v.areaMm2);
  const congruentes =
    verticales.length >= 3 && areas.every((a) => Math.abs(a - areas[0]) < areas[0] * 0.08);
  const radial = congruentes && ens.ensambles.length >= 2;

  // Caja del panel: da los planos donde se apoyan las piezas de pie.
  const semiAncho = panel ? Math.max(panel.largo, panel.ancho) / 2 : op.radio;
  const semiProf = panel ? Math.min(panel.largo, panel.ancho) / 2 : op.radio;

  // Las orientaciones se resuelven antes que los roles porque el rol
  // depende de que tan alta queda la pieza YA PARADA, y eso no se sabe
  // mirando su caja en la hoja de corte.
  const orient = new Map(verticales.map((v) => [v.id, orientarPieza(v, t)] as const));

  /**
   * Rol de una pieza. Si la imagen lo dijo, manda la imagen; si no, se
   * deduce de la geometria.
   *
   * La deduccion es una sola regla, pero cambia mucho: una pieza que
   * parada no llega ni a media altura del mueble no puede ser una pata
   * ni un costado, es un travesano y va acostado. Antes todo lo que no
   * era el panel se paraba, y por eso el travesano de una silla salia
   * clavado de pie junto al asiento.
   */
  const rolDe = (v: ContornoCnc): Rol => {
    const dicho = op.roles?.[v.id];
    if (dicho) return dicho;
    if (radial) return "lateral";
    const alt = orient.get(v.id)?.alto ?? 0;
    return alt < op.alto * 0.6 ? "horizontal" : "otro";
  };
  let iLat = 0;
  let iFro = 0;

  verticales.forEach((v, k) => {
    const o = orient.get(v.id)!;
    const rol = rolDe(v);

    // Piezas acostadas: travesanos y repisas. Van planas a media altura,
    // no de pie. Antes todo lo que no fuera el panel se paraba.
    if (!esDePie(rol)) {
      colocaciones.push({
        piezaId: v.id,
        rol,
        giro: 0,
        radio: 0,
        desliz: 0,
        z: Math.round(op.alto * 0.38),
        inclinacion: 0,
        acostada: true,
        giroLocal: o.giro,
        espejo: o.espejo,
        fuente: op.roles?.[v.id] ? "imagen" : "simetria",
      });
      return;
    }

    const e = porPieza.get(v.id);
    const m = e ? ens.mortajas.find((x) => x.idx === e.mortaja) : undefined;
    const lg = e ? ens.lenguetas[v.id]?.[e.lengueta] : undefined;

    let giro: number;
    let radio: number;
    let desliz = 0;
    let fuente: Colocacion["fuente"];

    if (radial) {
      giro = (k / Math.max(1, n)) * Math.PI * 2;
      radio = op.radio;
      fuente = "simetria";
    } else if (rol === "frontal") {
      // Frente y respaldo: se alternan las dos caras opuestas.
      giro = iFro++ % 2 === 0 ? Math.PI / 2 : -Math.PI / 2;
      radio = Math.max(20, semiProf - t / 2);
      fuente = op.roles?.[v.id] ? "imagen" : "simetria";
    } else {
      // Costados: idem sobre el otro par de caras.
      giro = iLat++ % 2 === 0 ? 0 : Math.PI;
      radio = Math.max(20, semiAncho - t / 2);
      fuente = op.roles?.[v.id] ? "imagen" : "simetria";
    }

    if (m && lg) {
      // La mortaja esta en una esquina y sirve a dos lados; se toma el
      // que sigue en sentido antihorario, que es lo que arma el molinete.
      const angEsq = Math.atan2(m.cy, m.cx);
      const lado = Math.round((angEsq + Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2);
      // Coordenadas de la mortaja en el marco del lado: normal y tangente.
      const nx = Math.cos(lado);
      const ny = Math.sin(lado);
      radio = m.cx * nx + m.cy * ny;
      const tang = -m.cx * ny + m.cy * nx;
      // La espiga cae en x local; el origen de la pieza es su centro.
      desliz = tang - (lg.x - o.ancho / 2);
      giro = lado;
      fuente = "ensamble";
    }

    colocaciones.push({
      piezaId: v.id,
      rol,
      giro,
      radio,
      z: op.alto - t,
      inclinacion: inc,
      acostada: false,
      giroLocal: o.giro,
      espejo: o.espejo,
      desliz: Math.round(desliz),
      fuente,
    });
  });

  notas.push(...ens.notas);
  notas.push(
    radial
      ? `Las ${n} piezas verticales son intercambiables, asi que se reparten en molinete cada ${Math.round(360 / Math.max(1, n))}°.`
      : `Las piezas no son intercambiables, asi que se colocan sobre las caras de la caja en vez de repartirse en circulo.`
  );
  if (!op.roles) {
    const acostadas = colocaciones.filter((c) => c.acostada && c.rol !== "panel").length;
    notas.push(
      `Sin imagen de referencia el rol de cada pieza se deduce de su tamano: se acuestan las que paradas no llegarian ni a media altura (${acostadas}) y se paran las demas. Una foto del mueble armado lo corrige.`
    );
  }

  // El piso queda donde apoya la pieza mas baja.
  let piso = op.alto - t;
  for (const c of colocaciones) {
    if (c.acostada) {
      piso = Math.min(piso, c.z - t / 2);
      continue;
    }
    const v = verticales.find((x) => x.id === c.piezaId);
    if (!v) continue;
    piso = Math.min(piso, c.z - orientarPieza(v, t).alto * Math.cos(c.inclinacion));
  }

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

  return {
    colocaciones,
    alto: op.alto + t,
    alturaPiso: Math.round(piso),
    familia: "panel + perimetrales",
    confianza,
    notas,
  };
}

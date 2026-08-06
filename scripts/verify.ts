import { presets, getPreset, specVacio, celda, columna, cloneSpec } from "../lib/spec";
import { buildFurniture } from "../lib/build";
import { costModel, cutList, money } from "../lib/costing";
import { defaultCatalog } from "../lib/catalog";
import { partsDxf } from "../lib/exporters";
import { leerDxf, proponerEnvolvente } from "../lib/dxf";
import { leerCorteDxf, tramosEn } from "../lib/cnc";
import { aplicarAjuste, despieceCnc, opcionesSugeridas, orientarPieza, panelDe, proponerArmado } from "../lib/cncArmado";
import { detectarEnsambles } from "../lib/cncEnsambles";
import { inventarioJuntas } from "../lib/cncJuntas";
import { alMundo, resolverArmado } from "../lib/cncSolver";
import { extraerJson, imagenDemasiadoGrande, IMAGEN_MAX_BYTES, proveedorActivo } from "../lib/llm";
import { readFileSync, existsSync } from "fs";

let fallas = 0;
const chk = (ok: boolean, msg: string) => { if (!ok) { console.log("  FALLA: " + msg); fallas++; } };

console.log("=== PRESETS ===");
for (const p of presets) {
  const s = p.make();
  const m = buildFurniture(s);
  const c = costModel(m, defaultCatalog, 1);
  const rows = cutList(m, 1);
  console.log(`\n${p.nombre}: ${m.bbox.w}x${m.bbox.d}x${m.bbox.h} mm | ${m.parts.length} piezas | ${money(c.total)}`);
  if (m.warnings.length) console.log("   avisos: " + m.warnings.join(" | "));

  chk(m.parts.length > 0, `${p.id}: sin piezas`);
  chk(c.total > 0, `${p.id}: costo cero`);
  chk(!c.advertencias.some(a => a.includes("catalogo")), `${p.id}: SKU sin precio -> ${c.advertencias.join(";")}`);
  // La envolvente construida debe coincidir con la declarada
  chk(Math.abs(m.bbox.w - s.ancho) <= 1, `${p.id}: ancho ${m.bbox.w} != ${s.ancho}`);
  chk(Math.abs(m.bbox.h - s.alto) <= 1, `${p.id}: alto ${m.bbox.h} != ${s.alto}`);
  chk(Math.abs(m.bbox.d - s.prof) <= 1, `${p.id}: prof ${m.bbox.d} != ${s.prof}`);
  for (const part of m.parts) {
    chk(part.sx > 0 && part.sy > 0 && part.sz > 0, `${p.id}/${part.nombre}: dimension <= 0`);
    chk(Number.isFinite(part.px + part.py + part.pz), `${p.id}/${part.nombre}: posicion NaN`);
  }
  chk(rows.reduce((a, r) => a + r.qty, 0) === m.parts.length, `${p.id}: cut list no cuadra`);
}

console.log("\n=== ESTRUCTURAS COMPLEJAS ===");
const casos: [string, () => ReturnType<typeof specVacio>][] = [
  ["3 columnas mixtas", () => {
    const s = specVacio(); s.ancho = 2400; s.alto = 900;
    s.columnas = [
      columna(1, [celda(1, "cajon"), celda(1, "cajon")]),
      columna(2, [celda(1, "puerta_doble", 2)]),
      columna(1, [celda(1, "abierto", 3)]),
    ];
    return s;
  }],
  ["torre 5 celdas", () => {
    const s = specVacio(); s.alto = 2200;
    s.columnas = [columna(1, [celda(1,"cajon"),celda(1,"cajon"),celda(1,"cajon"),celda(1,"cajon"),celda(3,"puerta_doble",2)])];
    return s;
  }],
  ["sin frentes", () => {
    const s = specVacio();
    s.columnas = [columna(1, [celda(1, "abierto", 4)])];
    return s;
  }],
  ["cubierta con voladizo", () => {
    const s = specVacio(); s.cubierta.tipo = "sobrepuesta"; s.cubierta.voladizo = 25;
    s.cubierta.entrecalleAlto = 15;
    return s;
  }],
];
for (const [nombre, mk] of casos) {
  const s = mk();
  const m = buildFurniture(s);
  const c = costModel(m, defaultCatalog, 1);
  console.log(`\n${nombre}: ${m.bbox.w}x${m.bbox.d}x${m.bbox.h} | ${m.parts.length} piezas | ${money(c.total)}`);
  if (m.warnings.length) console.log("   avisos: " + m.warnings.join(" | "));
  chk(m.parts.length > 0, `${nombre}: sin piezas`);
  chk(Number.isFinite(c.total) && c.total > 0, `${nombre}: costo invalido`);
  for (const part of m.parts) chk(part.sx > 0 && part.sy > 0 && part.sz > 0, `${nombre}/${part.nombre}: pieza degenerada`);
  // Una cubierta sobrepuesta con voladizo sobresale del cuerpo a proposito
  const vol = s.cubierta.tipo === "sobrepuesta" ? s.cubierta.voladizo : 0;
  chk(Math.abs(m.bbox.w - (s.ancho + 2 * vol)) <= 1, `${nombre}: ancho no coincide`);
  chk(Math.abs(m.bbox.h - s.alto) <= 1, `${nombre}: alto no coincide`);
}

console.log("\n=== ESCALADO ===");
const s0 = getPreset("base").make();
const m0 = buildFurniture(s0);
const c1 = costModel(m0, defaultCatalog, 1);
const c10 = costModel(m0, defaultCatalog, 10);
console.log(`1 modulo ${money(c1.total)} | 10 modulos ${money(c10.total)} | por modulo ${money(c10.total/10)}`);
chk(Math.abs(c10.costoDirecto - c1.costoDirecto * 10) < 1, "el costo no escala lineal");

console.log("\n=== DXF ===");
const dxf = partsDxf(m0, 1);
const poly = (dxf.match(/LWPOLYLINE/g) || []).length;
const cnc = m0.parts.filter(p => p.ruta === "cnc").length;
console.log(`export: ${poly} polilineas para ${cnc} piezas CNC`);
chk(poly === cnc, "el DXF no trae una polilinea por pieza CNC");

if (existsSync("/tmp/buro-test.dxf")) {
  const l = leerDxf(readFileSync("/tmp/buro-test.dxf", "utf8"));
  const prop = proponerEnvolvente(l);
  console.log(`lectura: ${l.cotas.length} cotas, ${l.vistas.length} vistas -> ${prop.ancho}x${prop.prof}x${prop.alto}`);
  chk(l.ok, "no se pudo leer el DXF de prueba");
  chk(prop.ancho === 500 && prop.prof === 450 && prop.alto === 600, `propuesta incorrecta: ${prop.ancho}x${prop.prof}x${prop.alto}`);
}
// DXF invalido no debe tronar
const malo = leerDxf("esto no es un dxf");
chk(!malo.ok || malo.candidatos.length === 0, "un archivo invalido deberia reportar error");
console.log(`archivo invalido: ${malo.ok ? "sin error" : "error reportado correctamente"}`);

console.log("\n=== RANGOS EXTREMOS ===");
const rangos: [string, (s: ReturnType<typeof specVacio>) => void][] = [
  ["ancho minimo", s => { s.ancho = 250; }],
  ["ancho maximo", s => { s.ancho = 3000; }],
  ["alto minimo", s => { s.alto = 300; }],
  ["alto grande", s => { s.alto = 2400; }],
  ["prof minima", s => { s.prof = 200; }],
  ["espesor grueso", s => { s.esp = 25; }],
  ["sin base", s => { s.base.tipo = "ninguna"; s.base.alto = 0; }],
  ["8 columnas", s => { s.ancho = 3000; s.columnas = Array.from({length:8},()=>columna(1,[celda(1,"puerta_izq",1)])); }],
  ["8 celdas", s => { s.alto = 2400; s.columnas = [columna(1, Array.from({length:8},()=>celda(1,"cajon")))]; }],
];
for (const [nombre, mut] of rangos) {
  const s = cloneSpec(specVacio());
  mut(s);
  try {
    const m = buildFurniture(s);
    const c = costModel(m, defaultCatalog, 1);
    const degeneradas = m.parts.filter(p => p.sx <= 0 || p.sy <= 0 || p.sz <= 0);
    chk(degeneradas.length === 0, `${nombre}: ${degeneradas.length} piezas degeneradas`);
    chk(Number.isFinite(c.total), `${nombre}: total invalido`);
    console.log(`${nombre}: ${m.parts.length} piezas, ${money(c.total)}${m.warnings.length ? " (avisa)" : ""}`);
  } catch (e) {
    chk(false, `${nombre}: excepcion ${e}`);
  }
}

// ---------------------------------------------------------------
console.log("\n=== MODULO CNC ===");

/** DXF minimo con las aristas sueltas y desordenadas, como las saca un CAM. */
function dxfDeSegmentos(segs: [number, number, number, number][]): string {
  const ent = segs
    .map(([x1, y1, x2, y2]) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}`)
    .join("\n");
  return `0\nSECTION\n2\nENTITIES\n${ent}\n0\nENDSEC\n0\nEOF\n`;
}

function rect(x0: number, y0: number, w: number, h: number): [number, number, number, number][] {
  return [
    [x0, y0, x0 + w, y0],
    [x0 + w, y0, x0 + w, y0 + h],
    [x0 + w, y0 + h, x0, y0 + h],
    [x0, y0 + h, x0, y0],
  ];
}

{
  // Panel 1000x600 con una mortaja de 24x100, mas una pieza suelta 400x300.
  const segs = [
    ...rect(0, 0, 1000, 600),
    ...rect(200, 250, 24, 100), // mortaja: el lado corto define el espesor
    ...rect(1200, 0, 400, 300),
  ];
  // Se barajan para probar que el encadenado no depende del orden.
  const mezcla = segs.map((s, i) => ({ s, k: (i * 7919) % 101 })).sort((a, b) => a.k - b.k).map((o) => o.s);
  const l = leerCorteDxf(dxfDeSegmentos(mezcla));

  chk(l.ok, `cnc: no se pudo leer (${l.error})`);
  chk(l.extremosSueltos === 0, `cnc: ${l.extremosSueltos} extremos sueltos`);
  chk(l.piezas.length === 2, `cnc: ${l.piezas.length} piezas, se esperaban 2`);
  chk(l.espesor === 24, `cnc: espesor ${l.espesor}, se esperaba 24`);

  const panel = panelDe(l)!;
  chk(panel.huecos.length === 1, `cnc: el panel deberia tener 1 mortaja, tiene ${panel.huecos.length}`);
  // 1000x600 menos la mortaja de 24x100
  const esperada = (1000 * 600 - 24 * 100) / 1e6;
  chk(
    Math.abs(panel.areaMm2 / 1e6 - esperada) < 1e-6,
    `cnc: area del panel ${(panel.areaMm2 / 1e6).toFixed(4)} != ${esperada.toFixed(4)}`
  );
  chk(Math.abs(panel.perimetroMm - 3200) < 0.5, `cnc: perimetro ${panel.perimetroMm} != 3200`);
  console.log(`lectura: ${l.piezas.length} piezas | espesor ${l.espesor} mm | panel ${(panel.areaMm2 / 1e6).toFixed(4)} m2`);

  // El despiece debe costear por area REAL, no por la caja envolvente.
  const asig = {
    material: Object.fromEntries(l.piezas.map((p) => [p.id, defaultCatalog.materiales[0].sku])),
    cantear: Object.fromEntries(l.piezas.map((p) => [p.id, false])),
    cantoSku: defaultCatalog.cantos[0].sku,
    espesor: l.espesor ?? 18,
  };
  const m = despieceCnc(l, asig, defaultCatalog);
  chk(m.parts.length === 2, `cnc: despiece con ${m.parts.length} piezas`);
  // El corte mide 24mm y el material del catalogo es de 18: debe avisar.
  chk(
    m.warnings.some((w) => w.includes("24 mm")),
    "cnc: no aviso del desajuste de espesor contra el catalogo"
  );
  const areaTotal = m.parts.reduce((a, p) => a + (p.areaRealM2 ?? 0), 0);
  chk(Math.abs(areaTotal - (esperada + 0.12)) < 1e-6, `cnc: area total ${areaTotal.toFixed(4)}`);
  const c = costModel(m, defaultCatalog, 1);
  chk(Number.isFinite(c.total) && c.total > 0, "cnc: costo invalido");
  // El bbox de la pieza suelta es 400x300 = 0.12 m2; si el costeo usara el
  // bbox del panel en vez del contorno, el area subiria. Se verifica que no.
  chk(
    Math.abs(c.materialUso[0].m2Neto - (esperada + 0.12)) < 1e-6,
    `cnc: el costeo no uso el area real (${c.materialUso[0].m2Neto.toFixed(4)})`
  );
  console.log(`despiece: ${m.parts.length} piezas | ${areaTotal.toFixed(4)} m2 | ${money(c.total)}`);

  // Armado: debe colocar todas las piezas y no producir NaN.
  const op = opcionesSugeridas(l);
  const arm = proponerArmado(l, { ...op, alto: 750, inclinacion: 10, radio: 300 });
  chk(arm.colocaciones.length === l.piezas.length, `cnc: armado incompleto (${arm.colocaciones.length})`);
  chk(
    arm.colocaciones.every((c) => [c.giro, c.radio, c.z, c.inclinacion].every(Number.isFinite)),
    "cnc: el armado produjo posiciones NaN"
  );
  chk(
    arm.colocaciones.filter((c) => !c.acostada).every((c) => c.z > 0),
    "cnc: hay piezas verticales bajo el piso"
  );
  chk(arm.colocaciones.filter((c) => c.rol === "panel").length === 1, "cnc: deberia haber un solo panel");
  console.log(`armado: ${arm.colocaciones.length} colocaciones | ${arm.familia} | confianza ${arm.confianza}`);

  // La apertura arranca en cero: una ranura ancha describe la espiga, no
  // la inclinacion del tablero, y en flat-pack las piezas van a plomo.
  chk(opcionesSugeridas(l).inclinacion === 0, "cnc: la apertura deberia arrancar en 0");

  // El piso va donde apoya la pieza mas baja, y debe seguirla al cambiar
  // el alto. Si se quedara fijo, el mueble se hundiria o flotaria.
  const bajo = (a: ReturnType<typeof proponerArmado>) =>
    Math.min(...a.colocaciones.map((c) => c.z)) ;
  for (const alto of [500, 750, 1400]) {
    const a = proponerArmado(l, { ...op, alto, inclinacion: 0 });
    chk(Number.isFinite(a.alturaPiso), `cnc: alturaPiso invalida con alto ${alto}`);
    chk(
      a.alturaPiso <= bajo(a) + 1,
      `cnc: el piso (${a.alturaPiso}) queda por encima de la pieza mas baja con alto ${alto}`
    );
  }
  const bajoA = proponerArmado(l, { ...op, alto: 500, inclinacion: 0 }).alturaPiso;
  const altoA = proponerArmado(l, { ...op, alto: 1400, inclinacion: 0 }).alturaPiso;
  chk(altoA !== bajoA, "cnc: el piso no siguio al mueble al cambiar el alto");
  console.log(`piso: sigue al mueble (alto 500 -> ${bajoA} mm, alto 1400 -> ${altoA} mm)`);
}

{
  // Cuatro copias de la MISMA pieza, giradas y espejeadas como las
  // acomoda un nesting real. orientarPieza debe dejarlas todas iguales:
  // si no, cada pata acaba con un canto distinto contra la cubierta.
  const pieza: [number, number][] = [
    // Barra horizontal con una pata colgando a la derecha, y dos
    // lenguetas arriba que le dan mas detalle a ese canto.
    [0, 0], [100, 0], [100, -200], [160, -200], [160, 0], [400, 0],
    [400, 60], [300, 60], [300, 80], [260, 80], [260, 60],
    [140, 60], [140, 80], [100, 80], [100, 60], [0, 60],
  ];
  const aristas = (pts: [number, number][]): [number, number, number, number][] =>
    pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return [p[0], p[1], q[0], q[1]] as [number, number, number, number];
    });
  const mover = (
    pts: [number, number][],
    deg: number,
    espejo: boolean,
    dx: number,
    dy: number
  ): [number, number][] => {
    const a = (deg * Math.PI) / 180;
    return pts.map(([x, y]) => {
      const sx = espejo ? -x : x;
      return [sx * Math.cos(a) - y * Math.sin(a) + dx, sx * Math.sin(a) + y * Math.cos(a) + dy] as [number, number];
    });
  };

  const variantes: [number, boolean][] = [[0, false], [90, false], [180, false], [37, true]];
  const segs = variantes.flatMap(([deg, esp], i) =>
    aristas(mover(pieza, deg, esp, 2000 * i, 0))
  );
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  chk(l.piezas.length === 4, `orientacion: se esperaban 4 piezas, hay ${l.piezas.length}`);

  // Silueta normalizada: rejilla de 16x16 sobre la caja de la pieza, ya
  // orientada. Se mide en el CENTRO de cada celda, no en sus bordes ni en
  // los vertices del contorno: los vertices caen justo en los limites de
  // la rejilla y una milesima de diferencia numerica los manda a la celda
  // de al lado, que es ruido del medidor y no desalineacion real.
  const N = 16;
  const silueta = (c: (typeof l.piezas)[number]) => {
    const o = orientarPieza(c);
    const ca = Math.cos(o.giro);
    const sa = Math.sin(o.giro);
    const s = o.espejo ? -1 : 1;
    const pts = c.ext.map(([x, y]) => [s * (x * ca - y * sa), x * sa + y * ca] as [number, number]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 || 1;
    const h = Math.max(...ys) - y0 || 1;
    const celdas: boolean[] = [];
    for (let j = 0; j < N; j++) {
      const y = y0 + ((j + 0.5) * h) / N;
      const tramos = tramosEn(pts, y);
      for (let i = 0; i < N; i++) {
        const x = x0 + ((i + 0.5) * w) / N;
        celdas.push(tramos.some(([a, b]) => x >= a && x <= b));
      }
    }
    return celdas;
  };

  const base = silueta(l.piezas[0]);
  let peor = 0;
  for (const c of l.piezas) {
    const f = silueta(c);
    const distintas = f.reduce((a, v, i) => a + (v === base[i] ? 0 : 1), 0);
    peor = Math.max(peor, distintas / (N * N));
  }
  chk(peor < 0.02, `orientacion: las piezas no quedaron alineadas (${(peor * 100).toFixed(1)}% de silueta distinta)`);
  console.log(`orientacion: 4 variantes giradas/espejeadas normalizadas (${(peor * 100).toFixed(1)}% de diferencia)`);
}

{
  // Espigas y mortajas: un panel con dos mortajas de 24x90 y dos piezas
  // con una espiga de 90mm cada una. Deben emparejarse con holgura cero.
  const espiga = (x0: number): [number, number][] => [
    // Barra de 600x120 con una espiga de 90x30 sobresaliendo arriba.
    [x0, 0], [x0 + 600, 0], [x0 + 600, 120],
    [x0 + 345, 120], [x0 + 345, 150], [x0 + 255, 150], [x0 + 255, 120],
    [x0, 120],
  ];
  const cerrar = (pts: [number, number][]): [number, number, number, number][] =>
    pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return [p[0], p[1], q[0], q[1]] as [number, number, number, number];
    });

  const segs = [
    ...rect(0, 400, 1000, 1000),           // panel
    ...rect(200, 700, 24, 90),             // mortaja a escuadra
    ...rect(600, 700, 30, 90),             // mortaja mas ancha -> en angulo
    ...cerrar(espiga(1400)),
    ...cerrar(espiga(2200)),
  ];
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  const panel = panelDe(l);
  chk(panel != null && panel.huecos.length === 2, `e3: el panel deberia tener 2 mortajas`);

  const e = detectarEnsambles(l.piezas, panel, 24);
  const lens = Object.values(e.lenguetas).flat();
  chk(lens.length === 2, `e3: se esperaban 2 espigas, hay ${lens.length}`);
  chk(
    lens.every((x) => Math.abs(x.ancho - 90) < 2),
    `e3: ancho de espiga incorrecto (${lens.map((x) => x.ancho).join(",")})`
  );
  chk(
    lens.every((x) => Math.abs(x.vuelo - 30) < 2),
    `e3: vuelo de espiga incorrecto (${lens.map((x) => x.vuelo).join(",")})`
  );
  chk(e.ensambles.length === 2, `e3: se esperaban 2 ensambles, hay ${e.ensambles.length}`);
  chk(
    e.ensambles.every((x) => Math.abs(x.holgura) <= 1),
    `e3: holguras fuera de rango (${e.ensambles.map((x) => x.holgura).join(",")})`
  );
  // La mortaja de 30 sobre tablero de 24 implica entrada en angulo.
  const angulos = e.mortajas.flatMap((m) => m.ranuras.map((r) => r.angulo));
  chk(
    angulos.some((a) => a > 30 && a < 45),
    `e3: no se dedujo el angulo de la ranura ancha (${angulos.join(",")})`
  );
  // Una mortaja por pieza: no se puede asignar la misma dos veces.
  chk(
    new Set(e.ensambles.map((x) => x.mortaja)).size === e.ensambles.length,
    "e3: se asigno la misma mortaja a dos piezas"
  );
  console.log(
    `ensambles: ${lens.length} espigas de ${lens[0]?.ancho}mm -> ${e.ensambles.length} pareja(s), angulos ${[...new Set(angulos)].join("/")}°`
  );
}

{
  // Piezas distintas entre si: un panel grande SIN huecos, un costado con
  // huecos y un travesano. Es la forma de una silla, y el caso donde el
  // armado de mesa fallaba.
  const segs = [
    ...rect(0, 0, 900, 800),               // panel: el de mayor area, sin huecos
    ...rect(1100, 0, 700, 500),            // costado, mas chico
    ...rect(1200, 100, 18, 90),            //   con una mortaja
    ...rect(2000, 0, 600, 120),            // travesano
  ];
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  chk(l.piezas.length === 3, `roles: se esperaban 3 piezas, hay ${l.piezas.length}`);

  // El panel es el de MAYOR AREA aunque no tenga huecos. Antes se exigian
  // huecos y eso elegia el costado.
  const sinRoles = panelDe(l);
  const areaMax = Math.max(...l.piezas.map((p) => p.areaMm2));
  chk(
    sinRoles?.areaMm2 === areaMax,
    `roles: el panel deberia ser el de mayor area (${sinRoles?.areaMm2} vs ${areaMax})`
  );

  // La imagen puede corregirlo: si dice que otro es el panel, manda ella.
  const otro = l.piezas.find((p) => p !== sinRoles)!;
  chk(panelDe(l, { [otro.id]: "panel" })?.id === otro.id, "roles: la imagen deberia poder elegir el panel");

  // Sin imagen, el rol sale de la geometria: un travesano de 120 mm no
  // llega ni a media altura del mueble, asi que va acostado. El costado,
  // que si llega, va de pie.
  const op = opcionesSugeridas(l);
  const trav = l.piezas.reduce((a, b) => (b.areaMm2 < a.areaMm2 ? b : a));
  const costado = l.piezas.find((p) => p !== sinRoles && p !== trav)!;
  const sin = proponerArmado(l, op);
  const cSin = sin.colocaciones.find((c) => c.piezaId === trav.id)!;
  chk(cSin.acostada, "roles: sin imagen el travesano bajo deberia acostarse por geometria");
  chk(
    !sin.colocaciones.find((c) => c.piezaId === costado.id)!.acostada,
    "roles: sin imagen el costado alto deberia quedar de pie"
  );

  // Y la imagen tiene que poder CONTRADECIR a la geometria en ambos
  // sentidos: es lo unico que justifica pedirla.
  const dePie = proponerArmado(l, { ...op, roles: { [trav.id]: "lateral" } });
  const cDePie = dePie.colocaciones.find((c) => c.piezaId === trav.id)!;
  chk(!cDePie.acostada, "roles: con rol lateral el travesano deberia pararse");
  chk(cDePie.fuente === "imagen", `roles: la fuente deberia ser "imagen", es "${cDePie.fuente}"`);
  const acostado = proponerArmado(l, { ...op, roles: { [costado.id]: "horizontal" } });
  chk(
    acostado.colocaciones.find((c) => c.piezaId === costado.id)!.acostada,
    "roles: con rol horizontal el costado deberia acostarse"
  );
  console.log("roles: la geometria acuesta el travesano y la imagen puede contradecirla en ambos sentidos");

  // Piezas distintas => nada de molinete. Repartir en circulo tres piezas
  // que no son intercambiables no describe ningun mueble.
  const giros = new Set(sin.colocaciones.filter((c) => !c.acostada).map((c) => Math.round((c.giro * 180) / Math.PI)));
  chk(!giros.has(120) && !giros.has(240), "roles: no deberia repartir en molinete piezas distintas");
}

{
  // El ajuste manual son deltas sobre la propuesta, y debe poder anularla.
  const base = {
    piezaId: "x", rol: "lateral" as const, giro: 0, radio: 100, z: 700,
    inclinacion: 0, acostada: false, giroLocal: 0, espejo: false,
    desliz: 0, fuente: "simetria" as const,
  };
  const sin = aplicarAjuste(base, undefined);
  chk(sin === base, "ajuste: sin deltas deberia devolver la misma colocacion");

  const con = aplicarAjuste(base, { giro: 90, radio: -30, desliz: 25, z: 10, inclinacion: 15, voltear: true });
  chk(Math.abs(con.giro - Math.PI / 2) < 1e-9, `ajuste: giro ${con.giro}`);
  chk(con.radio === 70, `ajuste: radio ${con.radio}`);
  chk(con.desliz === 25, `ajuste: desliz ${con.desliz}`);
  chk(con.z === 710, `ajuste: z ${con.z}`);
  chk(Math.abs(con.inclinacion - Math.PI / 12) < 1e-9, `ajuste: inclinacion ${con.inclinacion}`);
  chk(con.espejo === true, "ajuste: voltear no invirtio el espejo");
  // No debe tocar lo que no se pidio.
  chk(con.piezaId === base.piezaId && con.acostada === base.acostada, "ajuste: modifico campos ajenos");
  console.log("ajuste manual: deltas aplicados correctamente");
}

{
  // MOTOR DE ENSAMBLES. Una caja de cuatro piezas armada solo con
  // juntas: un fondo con cuatro ranuras pasantes y dos costados con dos
  // espigas cada uno. El solver tiene que colocarlas sin ningun
  // parametro -ni alto, ni radio, ni inclinacion- y sin imagen.
  const t = 18;
  const espigaEn = (x0: number, y0: number, w: number, h: number): [number, number, number, number][] => {
    // Placa w x h con dos espigas de 60 x 18 saliendo del canto de abajo.
    const p: [number, number][] = [
      [x0, y0 + h], [x0, y0],
      [x0 + 80, y0], [x0 + 80, y0 - t], [x0 + 140, y0 - t], [x0 + 140, y0],
      [x0 + w - 140, y0], [x0 + w - 140, y0 - t], [x0 + w - 80, y0 - t], [x0 + w - 80, y0],
      [x0 + w, y0], [x0 + w, y0 + h],
    ];
    return p.map((q, i) => {
      const r = p[(i + 1) % p.length];
      return [q[0], q[1], r[0], r[1]] as [number, number, number, number];
    });
  };
  const ranura = (cx: number, cy: number): [number, number, number, number][] =>
    rect(cx - 30, cy - t / 2, 60, t);

  const segs = [
    ...rect(0, 0, 900, 600), // fondo
    ...ranura(80 + 30, 150), ...ranura(900 - 80 - 30, 150),
    ...ranura(80 + 30, 450), ...ranura(900 - 80 - 30, 450),
    ...espigaEn(1200, 100, 900, 400), // costado 1
  ];
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  chk(l.piezas.length === 2, `e4: se esperaban 2 piezas, hay ${l.piezas.length}`);

  const inv = inventarioJuntas(l.piezas, t);
  const juntas = Object.values(inv.porPieza).flat();
  const espigas = juntas.filter((j) => j.tipo === "espiga");
  const ranuras = juntas.filter((j) => j.tipo === "ranura");
  chk(espigas.length === 2, `e4: se esperaban 2 espigas, hay ${espigas.length}`);
  chk(ranuras.length === 4, `e4: se esperaban 4 ranuras, hay ${ranuras.length}`);
  chk(
    espigas.every((j) => Math.abs(j.largo - 60) <= 2),
    `e4: largo de espiga incorrecto (${espigas.map((j) => j.largo).join(",")})`
  );

  // Cuatro ranuras y dos espigas por costado: el mueble lleva DOS
  // costados aunque el DXF dibuje uno.
  const arm = resolverArmado(l.piezas, t);
  const costados = arm.instancias.filter((i) => i.piezaId !== arm.instancias[0].piezaId);
  chk(arm.instancias.length === 3, `e4: se esperaban 3 instancias, hay ${arm.instancias.length}`);
  chk(costados.length === 2, `e4: el balance de juntas deberia pedir 2 costados, pide ${costados.length}`);
  chk(arm.uniones.length === 4, `e4: se esperaban 4 uniones, hay ${arm.uniones.length}`);
  chk(!arm.sueltas.length, `e4: quedaron piezas sueltas (${arm.sueltas.join(",")})`);

  // Los costados quedan de pie y en planos distintos: si el solver
  // hubiera puesto los dos en el mismo sitio, encajarian igual de bien
  // pero el mueble seria imposible.
  const alturas = costados.map((i) =>
    Math.min(...l.piezas.find((p) => p.id === i.piezaId)!.ext.map((q) => alMundo(i.pose, q)[1]))
  );
  chk(alturas.every((y) => y < -100), `e4: los costados no bajan del fondo (${alturas.join(",")})`);
  const sep = Math.hypot(
    costados[0].pose.o[0] - costados[1].pose.o[0],
    costados[0].pose.o[1] - costados[1].pose.o[1],
    costados[0].pose.o[2] - costados[1].pose.o[2]
  );
  chk(sep > 100, `e4: los dos costados quedaron en el mismo sitio (${Math.round(sep)} mm)`);
  console.log(
    `e4: ${arm.instancias.length} piezas colocadas por ${arm.uniones.length} juntas, sin parametros ni imagen`
  );
}

{
  // MEDIA MADERA. Dos tableros de 600x200 que se cruzan a escuadra, cada
  // uno con una caja del ancho del tablero y de medio alto. No hay
  // espigas: si el solver los arma, es solo por el cruce.
  const t = 18;
  const anillo = (p: [number, number][]): [number, number, number, number][] =>
    p.map((q, i) => {
      const r = p[(i + 1) % p.length];
      return [q[0], q[1], r[0], r[1]] as [number, number, number, number];
    });
  const segs = [
    // Caja abierta hacia abajo.
    ...anillo([[0, 0], [291, 0], [291, 100], [309, 100], [309, 0], [600, 0], [600, 200], [0, 200]]),
    // Caja abierta hacia arriba.
    ...anillo([
      [800, 0], [1400, 0], [1400, 200], [1109, 200], [1109, 100], [1091, 100], [1091, 200], [800, 200],
    ]),
  ];
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  chk(l.piezas.length === 2, `media: se esperaban 2 piezas, hay ${l.piezas.length}`);

  const cajas = Object.values(inventarioJuntas(l.piezas, t).porPieza)
    .flat()
    .filter((j) => j.tipo === "caja");
  chk(cajas.length === 2, `media: se esperaban 2 cajas, hay ${cajas.length}`);
  chk(
    cajas.every((j) => Math.abs(j.largo - t) <= 2 && Math.abs(j.fondo - 100) <= 3),
    `media: medidas de caja incorrectas (${cajas.map((j) => `${j.largo}x${j.fondo}`).join(", ")})`
  );

  const arm = resolverArmado(l.piezas, t);
  chk(arm.instancias.length === 2, `media: se esperaban 2 instancias, hay ${arm.instancias.length}`);
  chk(arm.uniones.length === 1, `media: se esperaba 1 cruce, hay ${arm.uniones.length}`);
  if (arm.instancias.length === 2) {
    // Al cruzarse, las caras quedan perpendiculares.
    const [a, b] = arm.instancias;
    const cos = Math.abs(a.pose.w[0] * b.pose.w[0] + a.pose.w[1] * b.pose.w[1] + a.pose.w[2] * b.pose.w[2]);
    const na = Math.hypot(...a.pose.w) * Math.hypot(...b.pose.w) || 1;
    chk(cos / na < 0.2, `media: los tableros no quedaron a escuadra (cos ${(cos / na).toFixed(2)})`);
  }
  console.log(`media madera: ${arm.instancias.length} tableros cruzados por ${arm.uniones.length} caja(s)`);
}

{
  // Un dibujo SIN juntas no debe inventar un armado: se reporta que no
  // hay con que, y el visor cae a la propuesta por parametros.
  const segs = [...rect(0, 0, 800, 500), ...rect(1000, 0, 400, 300)];
  const l = leerCorteDxf(dxfDeSegmentos(segs));
  const arm = resolverArmado(l.piezas, 18);
  chk(!arm.uniones.length, `e4: no deberia resolver uniones sin juntas (${arm.uniones.length})`);
  chk(arm.sueltas.length === 1, `e4: la pieza sin junta deberia quedar suelta (${arm.sueltas.length})`);
  chk(
    arm.notas.some((n) => /ninguna junta/i.test(n)),
    `e4: falta el aviso de que no hay juntas (${arm.notas.join(" | ")})`
  );
  console.log("e4: un dibujo sin juntas no inventa armado, lo reporta");
}

{
  // Archivo sin contornos cerrados: debe fallar limpio, no reventar.
  const abierto = leerCorteDxf(dxfDeSegmentos([[0, 0, 100, 0], [100, 0, 100, 100]]));
  chk(!abierto.ok, "cnc: un contorno abierto no deberia dar ok");
  chk(!!abierto.error, "cnc: falta el mensaje de error");
  console.log(`contorno abierto: rechazado correctamente`);

  // Basura: no debe lanzar excepcion.
  try {
    const basura = leerCorteDxf("esto no es un dxf");
    chk(!basura.ok, "cnc: la basura no deberia dar ok");
    console.log("archivo invalido: rechazado correctamente");
  } catch (e) {
    chk(false, `cnc: excepcion con archivo invalido: ${e}`);
  }
}

// ---------------------------------------------------------------
console.log("\n=== PROVEEDOR DE MODELO ===");
{
  const guardar = {
    or: process.env.OPENROUTER_API_KEY,
    orm: process.env.OPENROUTER_MODEL,
    an: process.env.ANTHROPIC_API_KEY,
  };
  const limpiar = () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
  };

  limpiar();
  chk(proveedorActivo() === null, "llm: sin llaves deberia no haber proveedor");

  limpiar();
  process.env.ANTHROPIC_API_KEY = "sk-ant-x";
  chk(proveedorActivo()?.proveedor === "anthropic", "llm: con llave de Anthropic deberia elegir anthropic");

  // Con las dos llaves puestas, OpenRouter gana.
  process.env.OPENROUTER_API_KEY = "sk-or-x";
  const dos = proveedorActivo();
  chk(dos?.proveedor === "openrouter", `llm: con ambas llaves gana openrouter, dio ${dos?.proveedor}`);
  chk(dos?.modelo === "moonshotai/kimi-k3", `llm: modelo por defecto inesperado (${dos?.modelo})`);

  process.env.OPENROUTER_MODEL = "otro/modelo-vision";
  chk(proveedorActivo()?.modelo === "otro/modelo-vision", "llm: OPENROUTER_MODEL deberia mandar");
  console.log("seleccion de proveedor: ok");

  limpiar();
  if (guardar.or) process.env.OPENROUTER_API_KEY = guardar.or;
  if (guardar.orm) process.env.OPENROUTER_MODEL = guardar.orm;
  if (guardar.an) process.env.ANTHROPIC_API_KEY = guardar.an;

  // El JSON llega envuelto en cercas de markdown mas de lo que uno quisiera.
  const conCercas = extraerJson('```json\n{"alto":740,"roles":{"c2":"panel"}}\n```') as { alto: number } | null;
  chk(conCercas?.alto === 740, "llm: no se pudo extraer JSON entre cercas");
  const conRuido = extraerJson('Claro, aqui tienes:\n{"alto":700}\nEspero que sirva.') as { alto: number } | null;
  chk(conRuido?.alto === 700, "llm: no se pudo extraer JSON rodeado de texto");
  chk(extraerJson("no hay json aqui") === null, "llm: deberia devolver null sin JSON");
  chk(extraerJson("{roto: sin comillas") === null, "llm: deberia devolver null con JSON invalido");
  console.log("extraccion de JSON: ok");

  // Limite de imagen: base64 pesa ~4/3 del binario, y pasado el tope la
  // plataforma corta la peticion antes de que la funcion pueda contestar.
  const b64De = (bytes: number) => "A".repeat(Math.ceil((bytes * 4) / 3));
  chk(!imagenDemasiadoGrande(b64De(500_000)), "llm: 500 KB no deberia rechazarse");
  chk(!imagenDemasiadoGrande(b64De(IMAGEN_MAX_BYTES - 10_000)), "llm: justo bajo el tope no deberia rechazarse");
  chk(imagenDemasiadoGrande(b64De(IMAGEN_MAX_BYTES + 100_000)), "llm: pasado el tope deberia rechazarse");
  chk(IMAGEN_MAX_BYTES < 4_500_000, "llm: el tope debe quedar bajo el limite de cuerpo de Vercel");
  console.log(`limite de imagen: ok (tope ${Math.round(IMAGEN_MAX_BYTES / 1e6)} MB)`);
}

console.log(fallas === 0 ? "\n>>> TODAS LAS PRUEBAS PASARON" : `\n>>> ${fallas} FALLAS`);

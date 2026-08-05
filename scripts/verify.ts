import { presets, getPreset, specVacio, celda, columna, cloneSpec } from "../lib/spec";
import { buildFurniture } from "../lib/build";
import { costModel, cutList, money } from "../lib/costing";
import { defaultCatalog } from "../lib/catalog";
import { partsDxf } from "../lib/exporters";
import { leerDxf, proponerEnvolvente } from "../lib/dxf";
import { leerCorteDxf } from "../lib/cnc";
import { despieceCnc, opcionesSugeridas, panelDe, proponerArmado } from "../lib/cncArmado";
import { extraerJson, proveedorActivo } from "../lib/llm";
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
}

console.log(fallas === 0 ? "\n>>> TODAS LAS PRUEBAS PASARON" : `\n>>> ${fallas} FALLAS`);

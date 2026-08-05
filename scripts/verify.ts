import { presets, getPreset, specVacio, celda, columna, cloneSpec } from "../lib/spec";
import { buildFurniture } from "../lib/build";
import { costModel, cutList, money } from "../lib/costing";
import { defaultCatalog } from "../lib/catalog";
import { partsDxf } from "../lib/exporters";
import { leerDxf, proponerEnvolvente } from "../lib/dxf";
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

console.log(fallas === 0 ? "\n>>> TODAS LAS PRUEBAS PASARON" : `\n>>> ${fallas} FALLAS`);

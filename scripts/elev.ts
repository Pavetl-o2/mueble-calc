import { presets, specVacio, celda, columna } from "../lib/spec";
import { buildFurniture } from "../lib/build";
import { writeFileSync } from "fs";

const casos: [string, ReturnType<typeof specVacio>][] = [
  ...presets.map(p => [p.nombre, p.make()] as [string, ReturnType<typeof specVacio>]),
  ["3 columnas mixtas", (() => { const s = specVacio(); s.ancho=2400; s.alto=900;
    s.columnas=[columna(1,[celda(1,"cajon"),celda(1,"cajon")]),columna(2,[celda(1,"puerta_doble",2)]),columna(1,[celda(1,"abierto",3)])]; return s; })()],
];
const COL = 240, ROW = 300;
const cols = Math.min(4, casos.length), rows = Math.ceil(casos.length/cols);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols*COL+20}" height="${rows*ROW+20}" viewBox="0 0 ${cols*COL+20} ${rows*ROW+20}"><rect width="100%" height="100%" fill="#E7EAE5"/>`;
casos.forEach(([nombre, s], i) => {
  const m = buildFurniture(s);
  const sc = Math.min(190/Math.max(m.bbox.w,1), 210/Math.max(m.bbox.h,1));
  const ox = 15 + (i%cols)*COL, oy = 15 + Math.floor(i/cols)*ROW;
  for (const p of m.parts) {
    const x = ox + p.px*sc, y = oy + (m.bbox.h - p.pz - p.sz)*sc;
    svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(p.sx*sc).toFixed(1)}" height="${(p.sz*sc).toFixed(1)}" fill="${p.color}" fill-opacity="0.9" stroke="#3a3f38" stroke-width="0.5"/>`;
  }
  svg += `<text x="${ox}" y="${oy+240}" font-size="11" font-family="sans-serif" fill="#171A17">${nombre}</text>`;
  svg += `<text x="${ox}" y="${oy+254}" font-size="10" font-family="monospace" fill="#5E655C">${m.bbox.w}x${m.bbox.d}x${m.bbox.h} · ${m.parts.length} pz</text>`;
});
svg += "</svg>";
writeFileSync("/tmp/e2.svg", svg);
console.log("ok");

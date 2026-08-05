import { readFileSync } from "fs";
import { leerCorteDxf } from "@/lib/cnc";
const l = leerCorteDxf(readFileSync("/root/.claude/uploads/a62ddc5c-ebf3-5e2a-90f4-242003cf4042/5a3b8b72-square_table.dxf","utf8"));
const panel = l.piezas.find(p=>p.huecos.length>0)!;
const pata = l.piezas.filter(p=>p!==panel)[0];
console.log("pata", pata.id, "bbox", (pata.bbox.x1-pata.bbox.x0).toFixed(0), "x", (pata.bbox.y1-pata.bbox.y0).toFixed(0));

// Aristas de ~24mm (espesor) = lados de lengueta. ¿Donde caen?
const t = l.espesor ?? 24;
console.log(`\naristas de ~${t}mm y su posicion relativa dentro del bbox:`);
const w = pata.bbox.x1-pata.bbox.x0, h = pata.bbox.y1-pata.bbox.y0;
let n=0;
for(let i=0;i<pata.ext.length-1;i++){
  const [x1,y1]=pata.ext[i], [x2,y2]=pata.ext[i+1];
  const len=Math.hypot(x2-x1,y2-y1);
  if(Math.abs(len-t)<2.5){
    const mx=(x1+x2)/2, my=(y1+y2)/2;
    const rx=(mx-pata.bbox.x0)/w, ry=(my-pata.bbox.y0)/h;
    console.log(`  ${len.toFixed(1)}mm  en (${(rx*100).toFixed(0)}%, ${(ry*100).toFixed(0)}%) del bbox`);
    if(++n>=10) break;
  }
}
// ¿Que fraccion del contorno esta arriba vs abajo del canto de 740?
const arriba = pata.ext.filter(p=>p[1] > pata.bbox.y1-30).length;
const abajo  = pata.ext.filter(p=>p[1] < pata.bbox.y0+30).length;
console.log(`\nvertices cerca del borde superior del bbox: ${arriba} | inferior: ${abajo}`);

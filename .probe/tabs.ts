import { readFileSync } from "fs";
import { leerCorteDxf } from "@/lib/cnc";
const l = leerCorteDxf(readFileSync("/root/.claude/uploads/a62ddc5c-ebf3-5e2a-90f4-242003cf4042/5a3b8b72-square_table.dxf","utf8"));
const panel = l.piezas.find(p=>p.huecos.length>0)!;
const patas = l.piezas.filter(p=>p!==panel);

console.log("=== MORTAJAS DEL PANEL (centro relativo) ===");
const cx=(panel.bbox.x0+panel.bbox.x1)/2, cy=(panel.bbox.y0+panel.bbox.y1)/2;
for (const h of panel.huecos){
  const xs=h.map(p=>p[0]), ys=h.map(p=>p[1]);
  const hx=(Math.min(...xs)+Math.max(...xs))/2-cx, hy=(Math.min(...ys)+Math.max(...ys))/2-cy;
  console.log(`  (${hx.toFixed(0)}, ${hy.toFixed(0)})  caja ${(Math.max(...xs)-Math.min(...xs)).toFixed(0)}x${(Math.max(...ys)-Math.min(...ys)).toFixed(0)}`);
}

console.log("\n=== ORIENTACION DE CADA PATA ===");
for (const p of patas){
  // Eje principal por PCA sobre los vertices
  const n=p.ext.length;
  const mx=p.ext.reduce((a,v)=>a+v[0],0)/n, my=p.ext.reduce((a,v)=>a+v[1],0)/n;
  let sxx=0,syy=0,sxy=0;
  for(const [x,y] of p.ext){const dx=x-mx,dy=y-my;sxx+=dx*dx;syy+=dy*dy;sxy+=dx*dy;}
  const ang = 0.5*Math.atan2(2*sxy, sxx-syy) * 180/Math.PI;
  // Aristas rectas largas: la mas larga suele ser el canto que topa con el panel
  const largas:{len:number;dir:number}[]=[];
  for(let i=0;i<p.ext.length-1;i++){
    const dx=p.ext[i+1][0]-p.ext[i][0], dy=p.ext[i+1][1]-p.ext[i][1];
    const len=Math.hypot(dx,dy);
    if(len>150) largas.push({len, dir: Math.atan2(dy,dx)*180/Math.PI});
  }
  largas.sort((a,b)=>b.len-a.len);
  console.log(`  ${p.id}: centroide(${mx.toFixed(0)},${my.toFixed(0)}) ejePCA=${ang.toFixed(1)}°  aristas>150mm: ${largas.slice(0,4).map(e=>`${e.len.toFixed(0)}mm@${e.dir.toFixed(0)}°`).join(", ")}`);
}

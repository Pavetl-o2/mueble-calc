import { readFileSync } from "fs";
import { leerCorteDxf, type ContornoCnc, type Pt } from "@/lib/cnc";
const l = leerCorteDxf(readFileSync("/root/.claude/uploads/a62ddc5c-ebf3-5e2a-90f4-242003cf4042/5a3b8b72-square_table.dxf","utf8"));
const panel = l.piezas.find(p=>p.huecos.length>0)!;
const patas = l.piezas.filter(p=>p!==panel);

function orientar(c: ContornoCnc){
  // 1) arista recta mas larga -> horizontal
  let mejor=0, ang=0;
  for(let i=0;i<c.ext.length-1;i++){
    const dx=c.ext[i+1][0]-c.ext[i][0], dy=c.ext[i+1][1]-c.ext[i][1];
    const d=Math.hypot(dx,dy);
    if(d>mejor){mejor=d;ang=Math.atan2(dy,dx);}
  }
  const rot=(pts:Pt[],a:number):Pt[]=>pts.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)] as Pt);
  let pts = rot(c.ext, -ang);
  // 2) el lado con mas detalle es el que topa con el panel: va arriba
  const ys=pts.map(p=>p[1]); const y0=Math.min(...ys), y1=Math.max(...ys); const h=y1-y0;
  const cerca=(lim:number)=>pts.filter(p=>Math.abs(p[1]-lim)<h*0.06).length;
  if (cerca(y0) > cerca(y1)) pts = rot(pts, Math.PI);
  // 3) el pie (punto mas bajo) siempre del mismo lado: si no, se voltea la pieza
  const ys2=pts.map(p=>p[1]); const yMin=Math.min(...ys2);
  const xs=pts.map(p=>p[0]); const cxb=(Math.min(...xs)+Math.max(...xs))/2;
  const pie = pts.filter(p=>p[1] < yMin + h*0.05);
  const pieX = pie.reduce((a,p)=>a+p[0],0)/Math.max(1,pie.length);
  const espejo = pieX < cxb;
  if (espejo) pts = pts.map(([x,y])=>[-x,y] as Pt);
  const fx=pts.map(p=>p[0]), fy=pts.map(p=>p[1]);
  return { pts, espejo, ancho: Math.max(...fx)-Math.min(...fx), alto: Math.max(...fy)-Math.min(...fy),
           angDeg: (-ang*180/Math.PI) };
}

const outs = patas.map(p=>({id:p.id, ...orientar(p)}));
for(const o of outs) console.log(`  ${o.id}: giro ${o.angDeg.toFixed(1)}° espejo=${o.espejo?"si":"no"} -> ${o.ancho.toFixed(0)} x ${o.alto.toFixed(0)} mm`);

// ¿Quedaron todas iguales? Se comparan las siluetas normalizadas.
function firma(pts:Pt[]){
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0;
  // Perfil: altura minima del contorno en 24 columnas
  const cols=new Array(24).fill(1);
  for(const [x,y] of pts){ const c=Math.min(23,Math.floor((x-x0)/w*24)); cols[c]=Math.min(cols[c],(y-y0)/h); }
  return cols;
}
const base=firma(outs[0].pts);
console.log("\ncoincidencia con la primera pata (0 = identica):");
for(const o of outs){
  const f=firma(o.pts);
  const err=Math.max(...f.map((v,i)=>Math.abs(v-base[i])));
  console.log(`  ${o.id}: desviacion maxima ${err.toFixed(3)}`);
}

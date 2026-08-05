import type { Cantos, Part, Ruta } from "../types";

export const COLORS = {
  carcasa: "#D9C7A7",
  horizontal: "#E3D4B8",
  fondo: "#C4B291",
  frente: "#CBB68E",
  cajon: "#EADDC0",
  piedra: "#ECEAE4",
  pintura: "#4F5A52",
  herraje: "#8C6B3F",
  pata: "#B08A5C",
};

let counter = 0;
export function resetIds() {
  counter = 0;
}

export interface PartInput {
  nombre: string;
  grupo: string;
  material: string;
  sx: number;
  sy: number;
  sz: number;
  px: number;
  py: number;
  pz: number;
  ruta?: Ruta;
  acabado?: string;
  cantos?: Cantos;
  cantoSku?: string;
  veta?: "largo" | "ancho" | "libre";
  color?: string;
  maquinado?: string[];
  notas?: string;
}

export function mkPart(i: PartInput): Part {
  counter += 1;
  return {
    id: `p${counter}`,
    nombre: i.nombre,
    grupo: i.grupo,
    material: i.material,
    sx: round(i.sx),
    sy: round(i.sy),
    sz: round(i.sz),
    px: round(i.px),
    py: round(i.py),
    pz: round(i.pz),
    ruta: i.ruta ?? "cnc",
    acabado: i.acabado,
    cantos: i.cantos,
    cantoSku: i.cantoSku,
    veta: i.veta ?? "libre",
    color: i.color ?? COLORS.carcasa,
    maquinado: i.maquinado,
    notas: i.notas,
  };
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cara de la pieza: las dos dimensiones mayores. La menor es el espesor. */
export function faceDims(p: { sx: number; sy: number; sz: number }): [number, number, number] {
  const d = [p.sx, p.sy, p.sz].sort((a, b) => b - a);
  return [d[0], d[1], d[2]];
}

export function areaM2(p: { sx: number; sy: number; sz: number }): number {
  const [a, b] = faceDims(p);
  return (a * b) / 1e6;
}

/** Metros lineales de canto segun las banderas marcadas. */
export function cantoMl(p: Part): number {
  if (!p.cantos) return 0;
  const [largo, corto] = faceDims(p);
  let ml = 0;
  if (p.cantos.l1) ml += largo;
  if (p.cantos.l2) ml += largo;
  if (p.cantos.w1) ml += corto;
  if (p.cantos.w2) ml += corto;
  return ml / 1000;
}

export function bboxOf(parts: Part[]): { w: number; d: number; h: number } {
  if (!parts.length) return { w: 0, d: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.px); y0 = Math.min(y0, p.py); z0 = Math.min(z0, p.pz);
    x1 = Math.max(x1, p.px + p.sx); y1 = Math.max(y1, p.py + p.sy); z1 = Math.max(z1, p.pz + p.sz);
  }
  return { w: round(x1 - x0), d: round(y1 - y0), h: round(z1 - z0) };
}

/**
 * Bisagras por puerta segun altura. Regla estandar de taller:
 * hasta 900mm = 2, hasta 1600mm = 3, hasta 2000mm = 4, arriba = 5.
 */
export function bisagrasPorPuerta(alturaPuerta: number): number {
  if (alturaPuerta <= 900) return 2;
  if (alturaPuerta <= 1600) return 3;
  if (alturaPuerta <= 2000) return 4;
  return 5;
}

/** Corredera comercial mas cercana por debajo de la profundidad util. */
export function correderaParaProfundidad(prof: number): number {
  const medidas = [250, 300, 350, 400, 450, 500, 550, 600];
  let elegida = medidas[0];
  for (const m of medidas) if (m <= prof - 20) elegida = m;
  return elegida;
}

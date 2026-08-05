import type { Catalog, CostResult, ModelResult, Params } from "./types";
import { CutRow, partMaterialName } from "./costing";
import { faceDims } from "./typologies/helpers";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function cutListCsv(rows: CutRow[], cat: Catalog): string {
  const head = [
    "Pieza", "Cantidad", "Largo (mm)", "Ancho (mm)", "Espesor (mm)",
    "Material", "Acabado", "Ruta", "m2", "Canto (ml)",
  ];
  const body = rows.map((r) => [
    r.grupo, r.qty, r.largo, r.ancho, r.espesor,
    partMaterialName(r.material, cat), r.acabado ?? "", r.ruta,
    r.m2.toFixed(4), r.ml.toFixed(3),
  ]);
  return toCsv([head, ...body]);
}

export function costCsv(cost: CostResult, cat: Catalog): string {
  const head = ["Concepto", "Detalle", "Categoria", "Cantidad", "Unidad", "Precio unitario", "Importe"];
  const body = cost.lineas.map((l) => [
    l.concepto, l.detalle, l.categoria,
    l.cantidad.toFixed(3), l.unidad,
    l.precioUnit.toFixed(2), l.importe.toFixed(2),
  ]);
  const tail: (string | number)[][] = [
    [], ["Costo directo", "", "", "", "", "", cost.costoDirecto.toFixed(2)],
    [`Overhead ${cat.overheadPct}%`, "", "", "", "", "", cost.overhead.toFixed(2)],
    [`Margen ${cat.margenPct}%`, "", "", "", "", "", cost.margen.toFixed(2)],
    ["TOTAL", "", "", "", "", "", cost.total.toFixed(2)],
  ];
  return toCsv([head, ...body, ...tail]);
}

export function manifestJson(
  tipologia: string,
  params: Params,
  model: ModelResult,
  cost: CostResult,
  modulos: number
): string {
  return JSON.stringify(
    {
      version: "0.1",
      generado: new Date().toISOString(),
      tipologia,
      modulos,
      params,
      bbox: model.bbox,
      piezas: model.parts.map((p) => {
        const [largo, ancho, espesor] = faceDims(p);
        return {
          id: p.id,
          nombre: p.nombre,
          grupo: p.grupo,
          material: p.material,
          largo,
          ancho,
          espesor,
          pos: { x: p.px, y: p.py, z: p.pz },
          ruta: p.ruta,
          acabado: p.acabado ?? null,
          cantos: p.cantos ?? null,
          cantoSku: p.cantoSku ?? null,
          veta: p.veta,
          maquinado: p.maquinado ?? [],
          notas: p.notas ?? null,
        };
      }),
      herrajes: model.hardware,
      costo: {
        directo: cost.costoDirecto,
        overhead: cost.overhead,
        margen: cost.margen,
        total: cost.total,
        porCategoria: cost.porCategoria,
      },
    },
    null,
    2
  );
}

// ---------------------------------------------------------------
// DXF R12 con una polilinea cerrada por pieza rectangular.
// Puente v0 hacia software de nesting. Cada pieza en su propia capa.
// ---------------------------------------------------------------
export function partsDxf(model: ModelResult, modulos = 1): string {
  const piezas = model.parts.filter((p) => p.ruta === "cnc");
  const out: string[] = [];
  const w = (code: number | string, value: string | number) => {
    out.push(String(code));
    out.push(String(value));
  };

  const layers = [...new Set(piezas.map((p) => sanitizeLayer(p.grupo)))];

  w(0, "SECTION"); w(2, "HEADER");
  w(9, "$INSUNITS"); w(70, 4); // milimetros
  w(0, "ENDSEC");

  w(0, "SECTION"); w(2, "TABLES");
  w(0, "TABLE"); w(2, "LAYER"); w(70, layers.length + 1);
  w(0, "LAYER"); w(2, "0"); w(70, 0); w(62, 7); w(6, "CONTINUOUS");
  for (const l of layers) {
    w(0, "LAYER"); w(2, l); w(70, 0); w(62, 7); w(6, "CONTINUOUS");
  }
  w(0, "ENDTAB"); w(0, "ENDSEC");

  w(0, "SECTION"); w(2, "ENTITIES");

  // Acomodo simple en filas para que no se encimen al abrirlo
  let cx = 0;
  let cy = 0;
  let filaAlto = 0;
  const gap = 30;
  const anchoFila = 2400;

  for (const p of piezas) {
    const [largo, ancho] = faceDims(p);
    for (let m = 0; m < modulos; m++) {
      if (cx + largo > anchoFila) {
        cx = 0;
        cy += filaAlto + gap;
        filaAlto = 0;
      }
      const layer = sanitizeLayer(p.grupo);
      const pts: [number, number][] = [
        [cx, cy],
        [cx + largo, cy],
        [cx + largo, cy + ancho],
        [cx, cy + ancho],
      ];
      w(0, "LWPOLYLINE"); w(8, layer); w(100, "AcDbEntity");
      w(90, 4); w(70, 1);
      for (const [x, y] of pts) { w(10, x.toFixed(3)); w(20, y.toFixed(3)); }

      // Etiqueta con el nombre de la pieza
      w(0, "TEXT"); w(8, "ETIQUETAS");
      w(10, (cx + 8).toFixed(3)); w(20, (cy + 8).toFixed(3)); w(30, "0.0");
      w(40, "12"); w(1, `${p.nombre} ${largo}x${ancho}`);

      cx += largo + gap;
      filaAlto = Math.max(filaAlto, ancho);
    }
  }

  w(0, "ENDSEC");
  w(0, "EOF");
  return out.join("\n");
}

function sanitizeLayer(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .toUpperCase()
    .slice(0, 31);
}

export function download(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

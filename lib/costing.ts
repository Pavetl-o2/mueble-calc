import type { Catalog, CostLine, CostResult, ModelResult, Part } from "./types";
import { areaM2, cantoMl, faceDims } from "./typologies/helpers";

// ---------------------------------------------------------------
// MOTOR DE COSTEO
// Entra: despiece + catalogo.  Sale: costo por linea y total.
// ---------------------------------------------------------------

export function costModel(model: ModelResult, cat: Catalog, modulos = 1): CostResult {
  const lineas: CostLine[] = [];
  const advertencias: string[] = [];

  const matBySku = new Map(cat.materiales.map((m) => [m.sku, m]));
  const cantoBySku = new Map(cat.cantos.map((c) => [c.sku, c]));
  const herrBySku = new Map(cat.herrajes.map((h) => [h.sku, h]));
  const acabBySku = new Map(cat.acabados.map((a) => [a.sku, a]));

  // ---- 1) Tablero y piedra, agrupado por material ----
  const usoMaterial = new Map<string, { m2: number; piezas: number }>();
  for (const p of model.parts) {
    if (p.ruta === "compra") continue;
    const cur = usoMaterial.get(p.material) ?? { m2: 0, piezas: 0 };
    cur.m2 += areaM2(p);
    cur.piezas += 1;
    usoMaterial.set(p.material, cur);
  }

  const materialUso: CostResult["materialUso"] = [];
  for (const [sku, uso] of usoMaterial) {
    const mat = matBySku.get(sku);
    if (!mat) {
      advertencias.push(`Material sin precio en el catalogo: ${sku}`);
      continue;
    }
    const m2Neto = uso.m2 * modulos;
    // El aprovechamiento convierte area neta en area de hoja realmente consumida
    const m2Bruto = m2Neto / Math.max(0.1, mat.aprovechamiento);

    let precioUnit: number;
    let cantidad: number;
    let unidad: string;
    let hojas = 0;

    if (mat.precioPor === "hoja" && mat.hojaAncho && mat.hojaLargo) {
      const m2Hoja = (mat.hojaAncho * mat.hojaLargo) / 1e6;
      hojas = m2Bruto / m2Hoja;
      precioUnit = mat.precio;
      cantidad = hojas;
      unidad = "hoja";
    } else {
      precioUnit = mat.precio;
      cantidad = m2Bruto;
      unidad = "m2";
    }

    lineas.push({
      concepto: mat.nombre,
      detalle: `${uso.piezas * modulos} pz · ${m2Neto.toFixed(3)} m² netos · aprov. ${Math.round(
        mat.aprovechamiento * 100
      )}%`,
      categoria: mat.tipo === "piedra" ? "subcontrato" : "tablero",
      cantidad,
      unidad,
      precioUnit,
      importe: cantidad * precioUnit,
    });

    materialUso.push({
      sku,
      nombre: mat.nombre,
      m2Neto,
      m2Bruto,
      hojas,
    });
  }

  // ---- 2) Canto ----
  const usoCanto = new Map<string, number>();
  for (const p of model.parts) {
    const ml = cantoMl(p);
    if (ml <= 0 || !p.cantoSku) continue;
    usoCanto.set(p.cantoSku, (usoCanto.get(p.cantoSku) ?? 0) + ml);
  }
  for (const [sku, ml] of usoCanto) {
    const canto = cantoBySku.get(sku);
    if (!canto) {
      advertencias.push(`Canto sin precio en el catalogo: ${sku}`);
      continue;
    }
    const total = ml * modulos;
    lineas.push({
      concepto: canto.nombre,
      detalle: `${total.toFixed(2)} ml de canto aplicado`,
      categoria: "canto",
      cantidad: total,
      unidad: "ml",
      precioUnit: canto.precioMl,
      importe: total * canto.precioMl,
    });
  }

  // ---- 3) Acabados por superficie ----
  const usoAcabado = new Map<string, number>();
  for (const p of model.parts) {
    if (!p.acabado) continue;
    usoAcabado.set(p.acabado, (usoAcabado.get(p.acabado) ?? 0) + areaM2(p));
  }
  for (const [sku, m2] of usoAcabado) {
    const ac = acabBySku.get(sku);
    if (!ac) {
      advertencias.push(`Acabado sin precio en el catalogo: ${sku}`);
      continue;
    }
    const total = m2 * modulos;
    lineas.push({
      concepto: ac.nombre,
      detalle: `${total.toFixed(3)} m² de superficie tratada`,
      categoria: "acabado",
      cantidad: total,
      unidad: "m2",
      precioUnit: ac.precioM2,
      importe: total * ac.precioM2,
    });
  }

  // ---- 4) Herrajes ----
  // Herrajes explicitos del modelo
  const herrajeQty = new Map<string, { qty: number; origen: string }>();
  for (const h of model.hardware) {
    const cur = herrajeQty.get(h.sku) ?? { qty: 0, origen: h.origen ?? "" };
    cur.qty += h.qty;
    herrajeQty.set(h.sku, cur);
  }
  // Piezas con ruta compra que existen como herraje (patas torneadas, etc.)
  for (const p of model.parts) {
    if (p.ruta !== "compra") continue;
    if (!herrBySku.has(p.material)) continue;
    // Ya viene contabilizado en model.hardware; se evita duplicar
  }

  let totalHerrajePz = 0;
  for (const [sku, info] of herrajeQty) {
    const h = herrBySku.get(sku);
    if (!h) {
      advertencias.push(`Herraje sin precio en el catalogo: ${sku}`);
      continue;
    }
    const qty = info.qty * modulos;
    totalHerrajePz += qty;
    lineas.push({
      concepto: h.nombre,
      detalle: info.origen || h.proveedor || "",
      categoria: "herraje",
      cantidad: qty,
      unidad: "pz",
      precioUnit: h.precio,
      importe: qty * h.precio,
    });
  }

  // ---- 5) Mano de obra ----
  const piezasCnc = model.parts.filter((p) => p.ruta === "cnc").length * modulos;
  const mlCanto = [...usoCanto.values()].reduce((a, b) => a + b, 0) * modulos;
  const mo = cat.manoObra;

  if (piezasCnc > 0) {
    lineas.push({
      concepto: "Corte y maquinado CNC",
      detalle: `${piezasCnc} piezas`,
      categoria: "mano_obra",
      cantidad: piezasCnc,
      unidad: "pz",
      precioUnit: mo.cortePorPieza,
      importe: piezasCnc * mo.cortePorPieza,
    });
  }
  if (mlCanto > 0) {
    lineas.push({
      concepto: "Aplicacion de canto",
      detalle: `${mlCanto.toFixed(2)} ml`,
      categoria: "mano_obra",
      cantidad: mlCanto,
      unidad: "ml",
      precioUnit: mo.cantoPorMl,
      importe: mlCanto * mo.cantoPorMl,
    });
  }
  lineas.push({
    concepto: "Armado de modulo",
    detalle: `${modulos} modulo(s)`,
    categoria: "mano_obra",
    cantidad: modulos,
    unidad: "mod",
    precioUnit: mo.armadoPorModulo,
    importe: modulos * mo.armadoPorModulo,
  });
  if (totalHerrajePz > 0) {
    lineas.push({
      concepto: "Instalacion de herraje",
      detalle: `${totalHerrajePz} pz`,
      categoria: "mano_obra",
      cantidad: totalHerrajePz,
      unidad: "pz",
      precioUnit: mo.herrajePorPieza,
      importe: totalHerrajePz * mo.herrajePorPieza,
    });
  }

  // ---- 6) Totales ----
  const porCategoria: Record<string, number> = {};
  let costoDirecto = 0;
  for (const l of lineas) {
    porCategoria[l.categoria] = (porCategoria[l.categoria] ?? 0) + l.importe;
    costoDirecto += l.importe;
  }
  const overhead = costoDirecto * (cat.overheadPct / 100);
  const base = costoDirecto + overhead;
  const margen = base * (cat.margenPct / 100);
  const total = base + margen;

  for (const w of model.warnings) advertencias.push(w);

  return {
    lineas,
    porCategoria,
    costoDirecto,
    overhead,
    margen,
    total,
    materialUso,
    advertencias,
  };
}

/** Lista de corte agrupada: piezas identicas juntas. */
export interface CutRow {
  grupo: string;
  material: string;
  largo: number;
  ancho: number;
  espesor: number;
  qty: number;
  m2: number;
  ml: number;
  ruta: string;
  acabado?: string;
}

export function cutList(model: ModelResult, modulos = 1): CutRow[] {
  const map = new Map<string, CutRow>();
  for (const p of model.parts) {
    const [largo, ancho, espesor] = faceDims(p);
    const key = `${p.grupo}|${p.material}|${largo}x${ancho}x${espesor}|${p.acabado ?? ""}`;
    const cur = map.get(key);
    if (cur) {
      cur.qty += modulos;
      cur.m2 += areaM2(p) * modulos;
      cur.ml += cantoMl(p) * modulos;
    } else {
      map.set(key, {
        grupo: p.grupo,
        material: p.material,
        largo,
        ancho,
        espesor,
        qty: modulos,
        m2: areaM2(p) * modulos,
        ml: cantoMl(p) * modulos,
        ruta: p.ruta,
        acabado: p.acabado,
      });
    }
  }
  const orden = { cnc: 0, subcontrato: 1, compra: 2 } as Record<string, number>;
  return [...map.values()].sort(
    (a, b) => (orden[a.ruta] - orden[b.ruta]) || a.grupo.localeCompare(b.grupo)
  );
}

export function money(v: number, moneda = "MXN"): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(v);
}

export function partMaterialName(sku: string, cat: Catalog): string {
  return (
    cat.materiales.find((m) => m.sku === sku)?.nombre ??
    cat.herrajes.find((h) => h.sku === sku)?.nombre ??
    sku
  );
}

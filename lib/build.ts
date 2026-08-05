import type { HardwareLine, ModelResult, Part } from "./types";
import type { Celda, Columna, FurnitureSpec } from "./spec";
import {
  COLORS,
  bboxOf,
  bisagrasPorPuerta,
  correderaParaProfundidad,
  mkPart,
  resetIds,
} from "./typologies/helpers";

// ---------------------------------------------------------------
// CONSTRUCTOR GENERAL
// Entra: un FurnitureSpec.  Sale: despiece + herrajes + geometria.
//
// Convencion de ejes (mm):
//   X = ancho, Y = profundidad, Z = alto
//   px, py, pz = esquina MINIMA de la pieza
//   y = 0 es el FRENTE del mueble
//   Los frentes ocupan y = 0 .. esp; el cuerpo arranca detras de ellos
//
// Aqui vive el METODO CONSTRUCTIVO. Cambiar estas reglas cambia el
// despiece de todos los muebles.
// ---------------------------------------------------------------

export function buildFurniture(s: FurnitureSpec): ModelResult {
  resetIds();
  const parts: Part[] = [];
  const hardware: HardwareLine[] = [];
  const warnings: string[] = [];

  const M = s.materiales;
  const H = s.herrajes;

  // ---- Reparto vertical de la envolvente ----
  const altoBase = s.base.tipo === "ninguna" ? 0 : Math.max(0, s.base.alto);
  const altoCubierta =
    s.cubierta.tipo === "ninguna" ? 0 : s.cubierta.esp + s.cubierta.entrecalleAlto;
  const altoCuerpo = s.alto - altoBase - altoCubierta;

  if (altoCuerpo < 100) {
    warnings.push(
      "El cuerpo quedo por debajo de 100 mm. Sube el alto total o baja la base y la cubierta."
    );
  }

  // Hay frentes si alguna celda no esta abierta
  const hayFrentes = s.columnas.some((c) => c.celdas.some((z) => z.frente !== "abierto"));
  const espFrente = hayFrentes ? s.esp : 0;
  const profCuerpo = s.prof - espFrente - (s.cubierta.tipo === "sobrepuesta" ? s.cubierta.voladizo : 0);
  const y0 = espFrente;
  const z0 = altoBase;

  if (profCuerpo < 100) {
    warnings.push("La profundidad del cuerpo quedo muy corta. Revisa profundidad y voladizo.");
  }

  const anchoInt = s.ancho - 2 * s.esp;
  const altoInt = altoCuerpo - 2 * s.esp;

  // ---- BASE ----
  if (s.base.tipo === "zoclo") {
    parts.push(
      mkPart({
        nombre: "Zoclo frontal",
        grupo: "Zoclo",
        material: M.carcasa,
        sx: s.ancho,
        sy: s.esp,
        sz: altoBase,
        px: 0,
        py: y0 + s.base.retiro,
        pz: 0,
        cantos: { l1: true },
        cantoSku: M.canto,
        color: COLORS.frente,
      })
    );
    hardware.push({ sku: "PATA_NIVEL", qty: 4, origen: "modulo sobre zoclo" });
  } else if (s.base.tipo === "patas") {
    const sec = s.base.seccion;
    const inset = s.base.retiro;
    const yA = y0 + inset;
    const yB = s.prof - sec - inset;
    for (const [dx, dy] of [
      [inset, yA],
      [s.ancho - sec - inset, yA],
      [inset, yB],
      [s.ancho - sec - inset, yB],
    ]) {
      parts.push(
        mkPart({
          nombre: "Pata",
          grupo: "Pata",
          material: s.base.herrajeSku,
          sx: sec,
          sy: sec,
          sz: altoBase,
          px: dx,
          py: dy,
          pz: 0,
          ruta: "compra",
          color: COLORS.pata,
        })
      );
    }
    hardware.push({ sku: s.base.herrajeSku, qty: 4, origen: "4 patas" });
  }

  // ---- CARCASA ----
  // Costados exteriores
  for (const [nombre, x] of [
    ["Costado izquierdo", 0],
    ["Costado derecho", s.ancho - s.esp],
  ] as [string, number][]) {
    parts.push(
      mkPart({
        nombre,
        grupo: "Costado",
        material: M.carcasa,
        sx: s.esp,
        sy: profCuerpo,
        sz: altoCuerpo,
        px: x,
        py: y0,
        pz: z0,
        cantos: { w1: true },
        cantoSku: M.canto,
        veta: "largo",
        color: COLORS.carcasa,
        maquinado: ["sistema32", "ranura_fondo"],
      })
    );
  }

  // Piso y techo entre costados
  for (const [nombre, z] of [
    ["Piso", z0],
    ["Techo", z0 + altoCuerpo - s.esp],
  ] as [string, number][]) {
    parts.push(
      mkPart({
        nombre,
        grupo: nombre,
        material: M.carcasa,
        sx: anchoInt,
        sy: profCuerpo,
        sz: s.esp,
        px: s.esp,
        py: y0,
        pz: z,
        cantos: { w1: true },
        cantoSku: M.canto,
        veta: "largo",
        color: COLORS.horizontal,
        maquinado: ["ranura_fondo"],
      })
    );
  }

  // Fondo
  const profFondo = s.fondoRanurado ? profCuerpo - 10 : profCuerpo;
  parts.push(
    mkPart({
      nombre: "Fondo",
      grupo: "Fondo",
      material: M.fondo,
      sx: s.fondoRanurado ? anchoInt + 12 : s.ancho,
      sy: s.espFondo,
      sz: s.fondoRanurado ? altoInt + 12 : altoCuerpo,
      px: s.fondoRanurado ? s.esp - 6 : 0,
      py: y0 + profFondo - s.espFondo,
      pz: s.fondoRanurado ? z0 + s.esp - 6 : z0,
      color: COLORS.fondo,
    })
  );

  // ---- REPARTO HORIZONTAL EN COLUMNAS ----
  const cols = s.columnas.length ? s.columnas : [];
  const sumaAncho = cols.reduce((a, c) => a + Math.max(0.01, c.anchoRel), 0);
  const nDivisores = Math.max(0, cols.length - 1);
  const anchoUtil = anchoInt - nDivisores * s.esp;

  let xCursor = s.esp;
  const colGeom: { x: number; ancho: number; col: Columna }[] = [];
  for (let i = 0; i < cols.length; i++) {
    const w = (anchoUtil * Math.max(0.01, cols[i].anchoRel)) / sumaAncho;
    colGeom.push({ x: xCursor, ancho: w, col: cols[i] });
    xCursor += w;
    if (i < cols.length - 1) {
      // Divisor vertical
      parts.push(
        mkPart({
          nombre: `Divisor vertical ${i + 1}`,
          grupo: "Divisor vertical",
          material: M.carcasa,
          sx: s.esp,
          sy: profFondo,
          sz: altoInt,
          px: xCursor,
          py: y0,
          pz: z0 + s.esp,
          cantos: { w1: true },
          cantoSku: M.canto,
          veta: "largo",
          color: COLORS.carcasa,
          maquinado: ["sistema32"],
        })
      );
      xCursor += s.esp;
    }
  }

  if (anchoUtil < cols.length * 80) {
    warnings.push("Las columnas quedaron muy angostas. Reduce columnas o sube el ancho.");
  }

  // ---- CELDAS ----
  const nlCorredera = correderaParaProfundidad(profCuerpo);

  for (let ci = 0; ci < colGeom.length; ci++) {
    const { x, ancho, col } = colGeom[ci];
    const celdas = col.celdas.length ? col.celdas : [];
    const sumaAlto = celdas.reduce((a, c) => a + Math.max(0.01, c.altoRel), 0);
    const nDivH = Math.max(0, celdas.length - 1);
    const altoUtil = altoInt - nDivH * s.esp;

    let zCursor = z0 + s.esp;
    for (let ri = 0; ri < celdas.length; ri++) {
      const cel = celdas[ri];
      const h = (altoUtil * Math.max(0.01, cel.altoRel)) / sumaAlto;

      buildCelda({
        s, cel, parts, hardware,
        x, ancho, z: zCursor, alto: h,
        y0, profCuerpo, profFondo, nlCorredera,
        etiqueta: colGeom.length > 1 ? `C${ci + 1}-${ri + 1}` : `${ri + 1}`,
        varias: celdas.length > 1 || colGeom.length > 1,
      });

      zCursor += h;

      if (ri < celdas.length - 1) {
        // Divisor horizontal entre celdas
        parts.push(
          mkPart({
            nombre: `Divisor horizontal ${colGeom.length > 1 ? `C${ci + 1}-` : ""}${ri + 1}`,
            grupo: "Divisor horizontal",
            material: M.carcasa,
            sx: ancho,
            sy: profFondo,
            sz: s.esp,
            px: x,
            py: y0,
            pz: zCursor,
            cantos: { w1: true },
            cantoSku: M.canto,
            veta: "largo",
            color: COLORS.horizontal,
          })
        );
        zCursor += s.esp;
      }
    }
  }

  // ---- CUBIERTA Y ENTRECALLE ----
  if (s.cubierta.tipo !== "ninguna") {
    const zTopCuerpo = z0 + altoCuerpo;

    if (s.cubierta.entrecalleAlto > 0) {
      const r = s.cubierta.entrecalleReceso;
      parts.push(
        mkPart({
          nombre: "Entrecalle",
          grupo: "Entrecalle",
          material: s.cubierta.entrecalleMaterial,
          sx: s.ancho - 2 * r,
          sy: s.prof - 2 * r,
          sz: s.cubierta.entrecalleAlto,
          px: r,
          py: r,
          pz: zTopCuerpo,
          acabado: s.cubierta.entrecalleAcabado || undefined,
          color: COLORS.pintura,
        })
      );
    }

    const vol = s.cubierta.tipo === "sobrepuesta" ? s.cubierta.voladizo : 0;
    parts.push(
      mkPart({
        nombre: "Cubierta",
        grupo: "Cubierta",
        material: s.cubierta.material,
        sx: s.ancho + 2 * vol,
        sy: s.prof + vol,
        sz: s.cubierta.esp,
        px: -vol,
        py: 0,
        pz: zTopCuerpo + s.cubierta.entrecalleAlto,
        ruta: s.cubierta.subcontrato ? "subcontrato" : "cnc",
        cantos: s.cubierta.subcontrato ? undefined : { l1: true, w1: true, w2: true },
        cantoSku: s.cubierta.subcontrato ? undefined : M.canto,
        color: COLORS.piedra,
        notas: s.cubierta.subcontrato ? "Cotizar con el proveedor. Canto pulido." : undefined,
      })
    );
  }

  hardware.push({ sku: "TORNILLERIA", qty: 1, origen: "1 modulo" });

  // Agrupa herrajes repetidos
  const map = new Map<string, HardwareLine>();
  for (const hh of hardware) {
    const cur = map.get(hh.sku);
    if (cur) {
      cur.qty += hh.qty;
      if (hh.origen && !cur.origen?.includes(hh.origen)) {
        cur.origen = cur.origen ? `${cur.origen}; ${hh.origen}` : hh.origen;
      }
    } else {
      map.set(hh.sku, { ...hh });
    }
  }

  return { parts, hardware: [...map.values()], bbox: bboxOf(parts), warnings };
}

// ---------------------------------------------------------------
// Una celda: repisas, puertas o cajones
// ---------------------------------------------------------------

function buildCelda(a: {
  s: FurnitureSpec;
  cel: Celda;
  parts: Part[];
  hardware: HardwareLine[];
  x: number;
  ancho: number;
  z: number;
  alto: number;
  y0: number;
  profCuerpo: number;
  profFondo: number;
  nlCorredera: number;
  etiqueta: string;
  varias: boolean;
}) {
  const { s, cel, parts, hardware, x, ancho, z, alto, y0, profFondo, nlCorredera } = a;
  const M = s.materiales;
  const H = s.herrajes;
  const suf = a.varias ? ` ${a.etiqueta}` : "";

  // ---- Repisas ----
  if (cel.repisas > 0 && cel.frente !== "cajon") {
    const paso = alto / (cel.repisas + 1);
    for (let i = 1; i <= cel.repisas; i++) {
      parts.push(
        mkPart({
          nombre: `Repisa${suf}${cel.repisas > 1 ? ` ${i}` : ""}`,
          grupo: "Repisa",
          material: M.carcasa,
          sx: ancho - 2,
          sy: profFondo - 20,
          sz: s.esp,
          px: x + 1,
          py: y0,
          pz: z + paso * i,
          cantos: { w1: true },
          cantoSku: M.canto,
          veta: "largo",
          color: COLORS.horizontal,
        })
      );
    }
    hardware.push({
      sku: H.pernoRepisa,
      qty: cel.repisas * 4,
      origen: "4 pernos por repisa",
    });
  }

  // ---- Frentes ----
  if (cel.frente === "abierto") return;

  const g = s.holgura;

  if (cel.frente === "cajon") {
    const altoFrente = alto - g;
    const anchoFrente = ancho - g;
    const anchoCaja = ancho - s.holguraCorrederas;
    const altoCaja = Math.max(70, Math.min(180, altoFrente - 60));

    parts.push(
      mkPart({
        nombre: `Frente cajon${suf}`,
        grupo: "Frente cajon",
        material: M.frente,
        sx: anchoFrente,
        sy: s.esp,
        sz: altoFrente,
        px: x + g / 2,
        py: 0,
        pz: z + g / 2,
        cantos: { l1: true, l2: true, w1: true, w2: true },
        cantoSku: M.canto,
        acabado: M.acabadoFrente || undefined,
        veta: "largo",
        color: COLORS.frente,
      })
    );

    const xCaja = x + s.holguraCorrederas / 2;
    const yCaja = s.esp + 5;
    const zCaja = z + g / 2 + 20;

    for (let k = 0; k < 2; k++) {
      parts.push(
        mkPart({
          nombre: `Lateral caja${suf} ${k === 0 ? "izq" : "der"}`,
          grupo: "Lateral caja",
          material: M.cajon,
          sx: s.espCajon,
          sy: nlCorredera,
          sz: altoCaja,
          px: xCaja + k * (anchoCaja - s.espCajon),
          py: yCaja,
          pz: zCaja,
          cantos: { w1: true },
          cantoSku: M.canto,
          color: COLORS.cajon,
        })
      );
    }
    for (const [nombre, y] of [
      ["Frente caja", yCaja],
      ["Trasera caja", yCaja + nlCorredera - s.espCajon],
    ] as [string, number][]) {
      parts.push(
        mkPart({
          nombre: `${nombre}${suf}`,
          grupo: nombre,
          material: M.cajon,
          sx: anchoCaja - 2 * s.espCajon,
          sy: s.espCajon,
          sz: altoCaja,
          px: xCaja + s.espCajon,
          py: y,
          pz: zCaja,
          cantos: { w1: true },
          cantoSku: M.canto,
          color: COLORS.cajon,
        })
      );
    }
    parts.push(
      mkPart({
        nombre: `Fondo caja${suf}`,
        grupo: "Fondo caja",
        material: M.fondoCajon,
        sx: anchoCaja,
        sy: nlCorredera,
        sz: s.espFondo,
        px: xCaja,
        py: yCaja,
        pz: zCaja - s.espFondo,
        color: COLORS.fondo,
      })
    );

    hardware.push({
      sku: H.corredera,
      qty: 1,
      origen: `corredera NL ${nlCorredera} mm por cajon`,
    });
    hardware.push({ sku: H.jaladera, qty: 1, origen: "1 por frente" });
    return;
  }

  // Puertas
  const doble = cel.frente === "puerta_doble";
  const n = doble ? 2 : 1;
  const anchoTotal = ancho - g;
  const anchoPuerta = doble ? (anchoTotal - g) / 2 : anchoTotal;
  const altoPuerta = alto - g;

  for (let i = 0; i < n; i++) {
    parts.push(
      mkPart({
        nombre: `Puerta${suf}${doble ? ` ${i + 1}` : ""}`,
        grupo: "Puerta",
        material: M.frente,
        sx: anchoPuerta,
        sy: s.esp,
        sz: altoPuerta,
        px: x + g / 2 + i * (anchoPuerta + g),
        py: 0,
        pz: z + g / 2,
        cantos: { l1: true, l2: true, w1: true, w2: true },
        cantoSku: M.canto,
        acabado: M.acabadoFrente || undefined,
        veta: "largo",
        color: COLORS.frente,
        maquinado: ["cazoleta_35mm"],
      })
    );
  }

  hardware.push({
    sku: H.bisagra,
    qty: bisagrasPorPuerta(altoPuerta) * n,
    origen: `puerta de ${Math.round(altoPuerta)} mm`,
  });
  hardware.push({ sku: H.jaladera, qty: n, origen: "1 por frente" });
}

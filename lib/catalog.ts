import type { Catalog } from "./types";

// ---------------------------------------------------------------
// CATALOGO POR DEFECTO
// Los precios son EJEMPLOS en MXN. Editalos en la pestana Catalogo
// (se guardan en tu navegador) o cambialos aqui para tu instalacion.
// ---------------------------------------------------------------

export const defaultCatalog: Catalog = {
  moneda: "MXN",
  overheadPct: 18,
  margenPct: 30,

  materiales: [
    {
      sku: "MEL_BLANCO_18",
      nombre: "Melamina blanca 18mm",
      tipo: "tablero",
      espesor: 18,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 980,
      precioPor: "hoja",
      aprovechamiento: 0.75,
    },
    {
      sku: "ENCINO_CH_18",
      nombre: "Triplay chapa encino 18mm",
      tipo: "tablero",
      espesor: 18,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 1950,
      precioPor: "hoja",
      aprovechamiento: 0.72,
    },
    {
      sku: "MDF_18",
      nombre: "MDF 18mm",
      tipo: "tablero",
      espesor: 18,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 760,
      precioPor: "hoja",
      aprovechamiento: 0.78,
    },
    {
      sku: "MDF_20",
      nombre: "MDF 20mm",
      tipo: "tablero",
      espesor: 20,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 840,
      precioPor: "hoja",
      aprovechamiento: 0.78,
    },
    {
      sku: "TABLERO_15",
      nombre: "Tablero cajon 15mm",
      tipo: "tablero",
      espesor: 15,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 720,
      precioPor: "hoja",
      aprovechamiento: 0.8,
    },
    {
      sku: "MDF_6",
      nombre: "MDF 6mm (fondos)",
      tipo: "tablero",
      espesor: 6,
      hojaAncho: 1220,
      hojaLargo: 2440,
      precio: 340,
      precioPor: "hoja",
      aprovechamiento: 0.85,
    },
    {
      sku: "MARMOL_CALACATTA_20",
      nombre: "Marmol Calacatta pulido 20mm",
      tipo: "piedra",
      espesor: 20,
      precio: 4500,
      precioPor: "m2",
      aprovechamiento: 0.85,
    },
  ],

  cantos: [
    { sku: "ABS_BLANCO_1", nombre: "Canto ABS blanco 1mm", precioMl: 12 },
    { sku: "ABS_ENCINO_1", nombre: "Canto ABS encino 1mm", precioMl: 18 },
    { sku: "CHAPA_ENCINO", nombre: "Chapa encino natural", precioMl: 45 },
  ],

  herrajes: [
    { sku: "BISAGRA_CLIP_110", nombre: "Bisagra cazoleta 110 grados", precio: 78, proveedor: "Blum" },
    { sku: "CORREDERA_450", nombre: "Corredera oculta 450mm (par)", precio: 420, proveedor: "Blum" },
    { sku: "JALADERA_BRONCE", nombre: "Jaladera bronce + cuerda esmeralda", precio: 950 },
    { sku: "JALADERA_STD", nombre: "Jaladera aluminio 128mm", precio: 95 },
    { sku: "PERNO_REPISA", nombre: "Perno soporte de repisa", precio: 4 },
    { sku: "PATA_NIVEL", nombre: "Pata niveladora 100mm", precio: 32 },
    { sku: "PATA_ENCINO", nombre: "Pata encino torneada 300mm", precio: 420 },
    { sku: "TORNILLERIA", nombre: "Tornilleria y conectores (juego)", precio: 65 },
  ],

  acabados: [
    { sku: "PINTURA_SMA", nombre: "Pintura SMA (entrecalle)", precioM2: 350 },
    { sku: "TEJIDO_RATTA", nombre: "Tejido sintetico Ratta", precioM2: 800 },
    { sku: "LACA_PU", nombre: "Laca poliuretano mate", precioM2: 420 },
  ],

  manoObra: {
    cortePorPieza: 22,
    cantoPorMl: 18,
    armadoPorModulo: 480,
    herrajePorPieza: 35,
  },
};

export function cloneCatalog(c: Catalog): Catalog {
  return JSON.parse(JSON.stringify(c));
}

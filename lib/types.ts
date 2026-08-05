// ---------------------------------------------------------------
// Modelo de datos central.
// REGLA DE ORO: la lista de piezas es la fuente de verdad.
// La geometria 3D se DERIVA de ella, nunca al reves.
// ---------------------------------------------------------------

/** Como se produce la pieza. Determina el costeo y si genera DXF. */
export type Ruta = "cnc" | "compra" | "subcontrato";

/** Cantos a enchapar. l = lado largo, w = lado corto. */
export interface Cantos {
  l1?: boolean;
  l2?: boolean;
  w1?: boolean;
  w2?: boolean;
}

export interface Part {
  id: string;
  nombre: string;
  grupo: string;
  /** SKU del material en el catalogo */
  material: string;
  /** Tamanos en mm. sx = eje X (ancho), sy = eje Y (profundidad), sz = eje Z (alto) */
  sx: number;
  sy: number;
  sz: number;
  /** Posicion de la esquina minima en mm */
  px: number;
  py: number;
  pz: number;
  ruta: Ruta;
  /** SKU de acabado (pintura, tapizado) si aplica */
  acabado?: string;
  cantos?: Cantos;
  /** SKU del canto en el catalogo */
  cantoSku?: string;
  veta?: "largo" | "ancho" | "libre";
  color: string;
  /** Operaciones de maquinado, para el CAM. Informativo en v1. */
  maquinado?: string[];
  notas?: string;
  /**
   * Area real de la cara en m2, ya sin los huecos. Solo la traen las
   * piezas de forma libre que vienen de un DXF de corte: para ellas la
   * caja envolvente miente feo (una pata diagonal ocupa 0.82 m2 de caja
   * y 0.18 m2 de tablero). Cuando falta se usa la cara del bbox.
   */
  areaRealM2?: number;
  /** Perimetro real del contorno en metros, para cantear de forma libre. */
  perimetroRealM?: number;
  /** Contorno 2D en mm (exterior + huecos) para el visor y el DXF. */
  contorno?: { ext: [number, number][]; huecos: [number, number][][] };
}

export interface HardwareLine {
  sku: string;
  qty: number;
  /** De donde salio: "2 puertas x 2 bisagras" */
  origen?: string;
}

export interface ModelResult {
  parts: Part[];
  hardware: HardwareLine[];
  bbox: { w: number; d: number; h: number };
  warnings: string[];
}

// ---------------------------------------------------------------
// Tipologias
// ---------------------------------------------------------------

export interface ParamDef {
  key: string;
  label: string;
  def: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Agrupa los controles en la UI */
  seccion?: string;
  /** Muestra el control solo si esta funcion lo permite */
  visible?: (p: Params) => boolean;
}

export type Params = Record<string, number>;

export interface Typology {
  id: string;
  nombre: string;
  descripcion: string;
  params: ParamDef[];
  build: (p: Params) => ModelResult;
}

// ---------------------------------------------------------------
// Catalogo de precios
// ---------------------------------------------------------------

export interface Material {
  sku: string;
  nombre: string;
  /** tablero se cotiza por m2 de hoja; piedra por m2; solido por m3 aprox */
  tipo: "tablero" | "piedra" | "otro";
  espesor: number;
  /** Medidas de la hoja en mm (para tableros) */
  hojaAncho?: number;
  hojaLargo?: number;
  /** Precio de la hoja completa (tableros) o por m2 (piedra) */
  precio: number;
  precioPor: "hoja" | "m2";
  /** 0.75 = se aprovecha 75% de la hoja. Calibra esto con tu nesting real. */
  aprovechamiento: number;
}

export interface Canto {
  sku: string;
  nombre: string;
  precioMl: number;
}

export interface Herraje {
  sku: string;
  nombre: string;
  precio: number;
  proveedor?: string;
}

export interface Acabado {
  sku: string;
  nombre: string;
  precioM2: number;
}

export interface ManoObra {
  /** Costo por pieza cortada en CNC */
  cortePorPieza: number;
  /** Costo por metro lineal de canto aplicado */
  cantoPorMl: number;
  /** Costo de armado por modulo */
  armadoPorModulo: number;
  /** Costo de instalacion de herraje, por pieza de herraje */
  herrajePorPieza: number;
}

export interface Catalog {
  materiales: Material[];
  cantos: Canto[];
  herrajes: Herraje[];
  acabados: Acabado[];
  manoObra: ManoObra;
  /** % sobre costo directo */
  overheadPct: number;
  /** % de margen sobre el subtotal con overhead */
  margenPct: number;
  moneda: string;
}

// ---------------------------------------------------------------
// Costeo
// ---------------------------------------------------------------

export interface CostLine {
  concepto: string;
  detalle: string;
  categoria: "tablero" | "canto" | "herraje" | "acabado" | "subcontrato" | "mano_obra";
  cantidad: number;
  unidad: string;
  precioUnit: number;
  importe: number;
}

export interface CostResult {
  lineas: CostLine[];
  porCategoria: Record<string, number>;
  costoDirecto: number;
  overhead: number;
  margen: number;
  total: number;
  /** m2 netos y con desperdicio, por material */
  materialUso: {
    sku: string;
    nombre: string;
    m2Neto: number;
    m2Bruto: number;
    hojas: number;
  }[];
  advertencias: string[];
}

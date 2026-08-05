// ---------------------------------------------------------------
// SPEC DE MUEBLE
// Un solo modelo de datos capaz de describir la mayoria del mobiliario
// de tablero: gabinetes, alacenas, torres, cajoneras, buros, credenzas.
//
// La idea: el cuerpo es una rejilla de columnas, y cada columna se
// divide en celdas. Cada celda decide su frente (puerta, cajon, abierto).
// Cualquier shop drawing se mapea a esta estructura.
// ---------------------------------------------------------------

export type FrenteTipo =
  | "puerta_izq"
  | "puerta_der"
  | "puerta_doble"
  | "cajon"
  | "abierto";

export interface Celda {
  /** Proporcion de alto dentro de la columna. 1 = una parte. */
  altoRel: number;
  frente: FrenteTipo;
  /** Repisas interiores, solo si tiene sentido para el frente */
  repisas: number;
}

export interface Columna {
  /** Proporcion de ancho dentro del cuerpo. 1 = una parte. */
  anchoRel: number;
  celdas: Celda[];
}

export type BaseTipo = "zoclo" | "patas" | "ninguna";
export type CubiertaTipo = "ninguna" | "integrada" | "sobrepuesta";

export interface FurnitureSpec {
  nombre: string;

  /** Envolvente TOTAL en mm, incluyendo base y cubierta. */
  ancho: number;
  alto: number;
  prof: number;

  /** Construccion */
  esp: number;
  espFondo: number;
  espCajon: number;
  holgura: number;
  fondoRanurado: boolean;
  /** Descuento de ancho por el par de correderas */
  holguraCorrederas: number;

  base: {
    tipo: BaseTipo;
    alto: number;
    /** Solo para patas: seccion cuadrada */
    seccion: number;
    /** Retiro del zoclo o de las patas respecto al frente */
    retiro: number;
    /** SKU de herraje cuando son patas compradas */
    herrajeSku: string;
  };

  cubierta: {
    tipo: CubiertaTipo;
    esp: number;
    material: string;
    /** Vuelo al frente y a los lados */
    voladizo: number;
    /** Franja entre el cuerpo y la cubierta (entrecalle). 0 = sin franja */
    entrecalleAlto: number;
    entrecalleMaterial: string;
    entrecalleAcabado: string;
    entrecalleReceso: number;
    /** La cubierta se compra o subcontrata en vez de cortarse */
    subcontrato: boolean;
  };

  columnas: Columna[];

  materiales: {
    carcasa: string;
    fondo: string;
    frente: string;
    cajon: string;
    fondoCajon: string;
    canto: string;
    acabadoFrente: string;
  };

  herrajes: {
    bisagra: string;
    corredera: string;
    jaladera: string;
    pernoRepisa: string;
  };
}

export function celda(
  altoRel = 1,
  frente: FrenteTipo = "puerta_doble",
  repisas = 0
): Celda {
  return { altoRel, frente, repisas };
}

export function columna(anchoRel = 1, celdas: Celda[] = [celda()]): Columna {
  return { anchoRel, celdas };
}

/** Spec base: de aqui parten todos los presets y la lectura de planos. */
export function specVacio(): FurnitureSpec {
  return {
    nombre: "Mueble",
    ancho: 600,
    alto: 820,
    prof: 560,
    esp: 18,
    espFondo: 6,
    espCajon: 15,
    holgura: 3,
    fondoRanurado: true,
    holguraCorrederas: 26,
    base: {
      tipo: "zoclo",
      alto: 100,
      seccion: 40,
      retiro: 50,
      herrajeSku: "PATA_NIVEL",
    },
    cubierta: {
      tipo: "ninguna",
      esp: 20,
      material: "MARMOL_CALACATTA_20",
      voladizo: 0,
      entrecalleAlto: 0,
      entrecalleMaterial: "MDF_20",
      entrecalleAcabado: "PINTURA_SMA",
      entrecalleReceso: 10,
      subcontrato: true,
    },
    columnas: [columna(1, [celda(1, "puerta_doble", 1)])],
    materiales: {
      carcasa: "MEL_BLANCO_18",
      fondo: "MDF_6",
      frente: "MEL_BLANCO_18",
      cajon: "TABLERO_15",
      fondoCajon: "MDF_6",
      canto: "ABS_BLANCO_1",
      acabadoFrente: "",
    },
    herrajes: {
      bisagra: "BISAGRA_CLIP_110",
      corredera: "CORREDERA_450",
      jaladera: "JALADERA_STD",
      pernoRepisa: "PERNO_REPISA",
    },
  };
}

// ---------------------------------------------------------------
// Presets: puntos de partida, no camisas de fuerza.
// ---------------------------------------------------------------

export interface Preset {
  id: string;
  nombre: string;
  descripcion: string;
  make: () => FurnitureSpec;
}

export const presets: Preset[] = [
  {
    id: "base",
    nombre: "Gabinete base",
    descripcion: "Modulo bajo con zoclo y puertas.",
    make: () => {
      const s = specVacio();
      s.nombre = "Gabinete base";
      s.columnas = [columna(1, [celda(1, "puerta_doble", 1)])];
      return s;
    },
  },
  {
    id: "alacena",
    nombre: "Alacena",
    descripcion: "Modulo alto de pared, sin base.",
    make: () => {
      const s = specVacio();
      s.nombre = "Alacena";
      s.alto = 700;
      s.prof = 350;
      s.base.tipo = "ninguna";
      s.base.alto = 0;
      s.columnas = [columna(1, [celda(1, "puerta_doble", 2)])];
      return s;
    },
  },
  {
    id: "torre",
    nombre: "Torre",
    descripcion: "Piso a techo: puertas arriba, cajones abajo.",
    make: () => {
      const s = specVacio();
      s.nombre = "Torre";
      s.alto = 1900;
      s.columnas = [
        columna(1, [
          celda(3, "cajon", 0),
          celda(1, "cajon", 0),
          celda(1, "cajon", 0),
          celda(1, "cajon", 0),
        ]),
      ];
      // De abajo hacia arriba: 3 cajones y una zona alta con puertas
      s.columnas[0].celdas = [
        celda(1, "cajon", 0),
        celda(1, "cajon", 0),
        celda(1, "cajon", 0),
        celda(3.4, "puerta_doble", 2),
      ];
      return s;
    },
  },
  {
    id: "cajonera",
    nombre: "Cajonera",
    descripcion: "Modulo bajo con frentes de cajon parejos.",
    make: () => {
      const s = specVacio();
      s.nombre = "Cajonera";
      s.columnas = [
        columna(1, [celda(1, "cajon"), celda(1, "cajon"), celda(1, "cajon")]),
      ];
      return s;
    },
  },
  {
    id: "buro",
    nombre: "Buro con cubierta",
    descripcion: "Sobre patas, con entrecalle y cubierta de piedra.",
    make: () => {
      const s = specVacio();
      s.nombre = "Buro";
      s.ancho = 500;
      s.alto = 600;
      s.prof = 450;
      s.base = { tipo: "patas", alto: 300, seccion: 40, retiro: 10, herrajeSku: "PATA_ENCINO" };
      s.cubierta = {
        tipo: "sobrepuesta",
        esp: 20,
        material: "MARMOL_CALACATTA_20",
        voladizo: 0,
        entrecalleAlto: 20,
        entrecalleMaterial: "MDF_20",
        entrecalleAcabado: "PINTURA_SMA",
        entrecalleReceso: 10,
        subcontrato: true,
      };
      s.materiales.carcasa = "ENCINO_CH_18";
      s.materiales.fondo = "ENCINO_CH_18";
      s.materiales.frente = "MDF_18";
      s.materiales.canto = "CHAPA_ENCINO";
      s.materiales.acabadoFrente = "TEJIDO_RATTA";
      s.herrajes.jaladera = "JALADERA_BRONCE";
      s.espFondo = 18;
      s.fondoRanurado = false;
      s.columnas = [columna(1, [celda(1, "cajon")])];
      return s;
    },
  },
  {
    id: "credenza",
    nombre: "Credenza mixta",
    descripcion: "Dos columnas: cajones de un lado, puertas del otro.",
    make: () => {
      const s = specVacio();
      s.nombre = "Credenza";
      s.ancho = 1600;
      s.alto = 780;
      s.prof = 480;
      s.columnas = [
        columna(1, [celda(1, "cajon"), celda(1, "cajon"), celda(1, "cajon")]),
        columna(1.4, [celda(1, "puerta_doble", 1)]),
      ];
      return s;
    },
  },
];

export function getPreset(id: string): Preset {
  return presets.find((p) => p.id === id) ?? presets[0];
}

export function cloneSpec(s: FurnitureSpec): FurnitureSpec {
  return JSON.parse(JSON.stringify(s));
}

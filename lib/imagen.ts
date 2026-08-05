// ---------------------------------------------------------------
// Preparacion de imagenes para las rutas que usan modelo. Solo corre en
// el navegador.
//
// Por que reducir antes de mandar: el archivo viaja en base64 dentro de
// un JSON, y base64 infla ~33%. Una foto de 4 MB se convierte en un
// cuerpo de 5.5 MB y revienta el limite de 4.5 MB por peticion que tiene
// una funcion serverless en Vercel. Cuando eso pasa, la plataforma
// responde con una pagina de error en texto plano y el cliente ni
// siquiera llega a ver un JSON.
//
// Ademas no hace falta resolucion: de una referencia se leen topologia y
// proporciones, no medidas. 1400 px de lado mayor sobra, y de paso baja
// el costo en tokens.
// ---------------------------------------------------------------

export interface ImagenLista {
  dataUrl: string;
  mediaType: string;
  /** Tamano aproximado del base64 en bytes, que es lo que se manda. */
  bytes: number;
  ancho: number;
  alto: number;
  /** true si hubo que reescalar. */
  reducida: boolean;
}

const LADO_MAX = 1400;
const CALIDAD = 0.85;

export async function prepararImagen(file: File, ladoMax = LADO_MAX): Promise<ImagenLista> {
  const original = await leerComoDataUrl(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Formatos que el navegador no sabe decodificar (SVG en algunos
    // casos): se manda tal cual y que decida el servidor.
    return {
      dataUrl: original,
      mediaType: file.type || "image/png",
      bytes: tamanoBase64(original),
      ancho: 0,
      alto: 0,
      reducida: false,
    };
  }

  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return {
      dataUrl: original,
      mediaType: file.type || "image/png",
      bytes: tamanoBase64(original),
      ancho: bitmap.width,
      alto: bitmap.height,
      reducida: false,
    };
  }

  // Fondo blanco: si el original tiene transparencia, JPEG la rellenaria
  // de negro y arruinaria una referencia con fondo claro.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", CALIDAD);
  return {
    dataUrl,
    mediaType: "image/jpeg",
    bytes: tamanoBase64(dataUrl),
    ancho: w,
    alto: h,
    reducida: escala < 1,
  };
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("No se pudo leer el archivo."));
    r.readAsDataURL(file);
  });
}

function tamanoBase64(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.round((b64.length * 3) / 4);
}

/**
 * POST a una ruta propia tolerando que la respuesta NO sea JSON.
 *
 * Cuando una funcion serverless se cae o se pasa de tiempo, la
 * plataforma contesta con texto plano o HTML. Hacer res.json() a ciegas
 * lanza un SyntaxError cuyo mensaje ("Unexpected token 'A'...") no dice
 * nada del problema real.
 */
export async function postJson<T>(
  url: string,
  cuerpo: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    return { ok: false, error: `No se pudo contactar al servidor: ${String(e).slice(0, 160)}` };
  }

  const texto = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(texto);
  } catch {
    /* la respuesta no era JSON */
  }

  if (data && typeof data === "object") {
    const d = data as { error?: string; detail?: string };
    if (!res.ok) {
      return { ok: false, error: d.error ?? `El servidor respondio ${res.status}.` };
    }
    return { ok: true, data: data as T };
  }

  // Respuesta no-JSON: casi siempre es la pagina de error de la plataforma.
  const pista = texto.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  if (res.status === 413) {
    return { ok: false, error: "La imagen pesa demasiado para enviarla. Usa una mas chica." };
  }
  if (res.status === 504 || /timed? ?out/i.test(pista)) {
    return {
      ok: false,
      error: "El servidor tardo demasiado y corto la peticion. Prueba con una imagen mas chica o un modelo mas rapido.",
    };
  }
  return {
    ok: false,
    error: `El servidor respondio ${res.status} sin JSON${pista ? `: ${pista}` : "."}`,
  };
}

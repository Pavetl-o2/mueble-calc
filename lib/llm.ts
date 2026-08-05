// ---------------------------------------------------------------
// CLIENTE DE MODELO (solo servidor)
//
// Las dos rutas que leen imagenes necesitan lo mismo: mandar una imagen
// mas un prompt y recibir JSON. Cambia el proveedor, no la tarea, asi
// que el proveedor se elige por variable de entorno y las rutas no se
// enteran.
//
// Proveedores:
//   - OpenRouter (OPENROUTER_API_KEY): API compatible con OpenAI, da
//     acceso a muchos modelos con una sola llave. Tiene prioridad.
//   - Anthropic  (ANTHROPIC_API_KEY):  API nativa de Claude.
//
// NUNCA importar esto desde un componente de cliente: lee las llaves.
// ---------------------------------------------------------------

export type Proveedor = "openrouter" | "anthropic";

export interface PeticionVision {
  prompt: string;
  /** Imagen en base64, sin el prefijo data:. */
  imagenB64: string;
  mediaType: string;
  maxTokens?: number;
}

export type RespuestaLlm =
  | { ok: true; texto: string; proveedor: Proveedor; modelo: string }
  | { ok: false; status: number; error: string; detalle?: string };

const MODELO_OPENROUTER = "moonshotai/kimi-k3";
const MODELO_ANTHROPIC = "claude-sonnet-5";

/**
 * Holgado a proposito. Las respuestas que se piden son JSON corto, pero
 * un modelo de razonamiento gasta tokens pensando ANTES de escribirlas,
 * y si se queda corto devuelve la respuesta vacia con finish_reason
 * "length" en vez de un error claro.
 */
const MAX_TOKENS_DEFECTO = 4000;

function maxTokens(pedido?: number): number {
  const env = Number(process.env.OPENROUTER_MAX_TOKENS);
  if (Number.isFinite(env) && env > 0) return Math.round(env);
  return pedido ?? MAX_TOKENS_DEFECTO;
}

/**
 * Tope de imagen en bytes de base64. Una funcion serverless en Vercel
 * corta el cuerpo de la peticion en 4.5 MB, y ahi la respuesta ya no es
 * JSON sino una pagina de error de la plataforma. Se rechaza antes, con
 * un mensaje que se pueda leer. El cliente ademas reduce la imagen, asi
 * que llegar a este limite ya deberia ser raro.
 */
export const IMAGEN_MAX_BYTES = 3_500_000;

export function imagenDemasiadoGrande(b64: string): boolean {
  return Math.round((b64.length * 3) / 4) > IMAGEN_MAX_BYTES;
}

export function proveedorActivo(): { proveedor: Proveedor; modelo: string } | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      proveedor: "openrouter",
      modelo: process.env.OPENROUTER_MODEL || MODELO_OPENROUTER,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      proveedor: "anthropic",
      modelo: process.env.ANTHROPIC_MODEL || MODELO_ANTHROPIC,
    };
  }
  return null;
}

export const FALTA_LLAVE =
  "Falta la llave del modelo. Configura OPENROUTER_API_KEY (y opcionalmente " +
  "OPENROUTER_MODEL) o ANTHROPIC_API_KEY en las variables de entorno. " +
  "Todo lo que se calcula del DXF funciona sin esto.";

/**
 * Presupuesto propio para la llamada al proveedor, en milisegundos.
 *
 * Tiene que quedar POR DEBAJO del limite de duracion de la funcion. Si se
 * agota primero el de la plataforma, esta responde con su propia pagina
 * de error (504) y se pierde todo rastro de que fallo; abortando antes se
 * puede devolver un JSON que diga cuanto tardo y donde se quedo.
 *
 * En Vercel el tope depende del plan: con Fluid Compute son 60 s, pero un
 * proyecto Hobby sin el puede cortar mucho antes. Por eso es ajustable.
 */
const TIMEOUT_DEFECTO_MS = 20_000;

function presupuestoMs(): number {
  const env = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= 1000) return Math.round(env);
  return TIMEOUT_DEFECTO_MS;
}

export async function pedirVision(req: PeticionVision): Promise<RespuestaLlm> {
  const activo = proveedorActivo();
  if (!activo) return { ok: false, status: 501, error: FALTA_LLAVE };

  const ms = presupuestoMs();
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  const seg = () => ((Date.now() - t0) / 1000).toFixed(1);

  try {
    const r =
      activo.proveedor === "openrouter"
        ? await viaOpenRouter(req, activo.modelo, ctrl.signal)
        : await viaAnthropic(req, activo.modelo, ctrl.signal);
    // El tiempo sirve para distinguir un modelo lento de un corte de la
    // plataforma, que es justo lo que no se puede ver desde el navegador.
    return r.ok ? r : { ...r, detalle: `${r.detalle ?? ""} [${seg()}s]`.trim() };
  } catch (e) {
    if (ctrl.signal.aborted) {
      return {
        ok: false,
        status: 504,
        error:
          `${activo.modelo} no respondio en ${Math.round(ms / 1000)}s. ` +
          `Sube LLM_TIMEOUT_MS si tu plan permite funciones mas largas, o usa un modelo mas rapido. ` +
          `El armado por simetria no necesita modelo.`,
        detalle: `abortado por el cliente a los ${seg()}s`,
      };
    }
    return {
      ok: false,
      status: 502,
      error: `No se pudo contactar a ${activo.proveedor}: la conexion fallo antes de recibir respuesta.`,
      detalle: `${String(e).slice(0, 240)} [${seg()}s]`,
    };
  } finally {
    clearTimeout(reloj);
  }
}

// ---------------------------------------------------------------

export interface Diagnostico {
  proveedor: Proveedor | null;
  modelo: string | null;
  llave: { puesta: boolean; largo: number; prefijo: string };
  maxTokens: number;
  timeoutMs: number;
  baseUrl: string;
  /** Resultado de una llamada barata al proveedor, sin gastar modelo. */
  conectividad: { ok: boolean; ms: number; detalle: string };
}

/**
 * Comprueba lo que la app no puede ver desde el navegador: si la funcion
 * alcanza al proveedor y si la llave sirve. Se usa /key de OpenRouter
 * porque valida credencial y salida a internet sin invocar ningun modelo,
 * asi que es gratis y rapido.
 */
export async function diagnosticar(): Promise<Diagnostico> {
  const activo = proveedorActivo();
  const key = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  const salida: Diagnostico = {
    proveedor: activo?.proveedor ?? null,
    modelo: activo?.modelo ?? null,
    llave: { puesta: !!key, largo: key.length, prefijo: key.slice(0, 7) },
    maxTokens: maxTokens(),
    timeoutMs: presupuestoMs(),
    baseUrl: activo?.proveedor === "anthropic" ? "https://api.anthropic.com" : base,
    conectividad: { ok: false, ms: 0, detalle: "no se intento" },
  };

  if (!activo) {
    salida.conectividad.detalle = "sin llave configurada";
    return salida;
  }

  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 10_000);
  const t0 = Date.now();
  try {
    if (activo.proveedor === "openrouter") {
      const res = await fetch(`${base}/key`, {
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      });
      const cuerpo = (await res.text()).slice(0, 200);
      salida.conectividad = {
        ok: res.ok,
        ms: Date.now() - t0,
        detalle: res.ok ? `llave valida (${cuerpo})` : `HTTP ${res.status}: ${cuerpo}`,
      };
    } else {
      // Anthropic no tiene sonda gratuita; se pide 1 token, que es casi nada.
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY as string,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: activo.modelo,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      salida.conectividad = {
        ok: res.ok,
        ms: Date.now() - t0,
        detalle: res.ok ? "llave valida" : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
  } catch (e) {
    salida.conectividad = {
      ok: false,
      ms: Date.now() - t0,
      detalle: ctrl.signal.aborted
        ? "sin respuesta en 10s: la funcion no alcanza al proveedor (egress bloqueado o DNS)"
        : String(e).slice(0, 200),
    };
  } finally {
    clearTimeout(reloj);
  }

  return salida;
}

async function viaOpenRouter(
  req: PeticionVision,
  modelo: string,
  signal: AbortSignal
): Promise<RespuestaLlm> {
  // Configurable para poder apuntar a un gateway compatible con OpenAI, o a
  // un servidor de prueba.
  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      // OpenRouter usa estas dos para atribuir el trafico a la app.
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://mueble-calc.vercel.app",
      "X-Title": "mueble-calc",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: maxTokens(req.maxTokens),
      messages: [
        {
          role: "user",
          content: [
            // Formato OpenAI: la imagen va como data URL, no como bloque
            // base64 aparte como en la API de Anthropic.
            {
              type: "image_url",
              image_url: { url: `data:${req.mediaType};base64,${req.imagenB64}` },
            },
            { type: "text", text: req.prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    return { ok: false, status: 502, error: errorLegible(res.status, detalle, modelo), detalle: detalle.slice(0, 400) };
  }

  const data = await res.json();
  // OpenRouter devuelve 200 con un campo error cuando el modelo falla.
  if (data?.error) {
    const msg = typeof data.error === "string" ? data.error : data.error.message ?? "";
    return { ok: false, status: 502, error: errorLegible(502, msg, modelo), detalle: String(msg).slice(0, 400) };
  }

  const choice = data?.choices?.[0];
  const texto = extraerTexto(choice);
  if (!texto) {
    return {
      ok: false,
      status: 502,
      error: sinTextoPorQue(choice, modelo),
      detalle: JSON.stringify(choice ?? data).slice(0, 400),
    };
  }
  return { ok: true, texto, proveedor: "openrouter", modelo };
}

async function viaAnthropic(
  req: PeticionVision,
  modelo: string,
  signal: AbortSignal
): Promise<RespuestaLlm> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: req.maxTokens ?? MAX_TOKENS_DEFECTO,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: req.mediaType, data: req.imagenB64 },
            },
            { type: "text", text: req.prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    return { ok: false, status: 502, error: errorLegible(res.status, detalle, modelo), detalle: detalle.slice(0, 400) };
  }

  const data = await res.json();
  const texto: string = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
  if (!texto.trim()) return { ok: false, status: 502, error: "El modelo no devolvio texto." };
  return { ok: true, texto, proveedor: "anthropic", modelo };
}

/**
 * Saca el texto de una respuesta estilo OpenAI. No basta con leer
 * message.content: cada proveedor de OpenRouter devuelve una forma
 * distinta y varias son legitimas.
 *   - content string: el caso normal.
 *   - content array de partes: comun cuando el modelo es multimodal.
 *   - content vacio y el texto en reasoning: los modelos de razonamiento
 *     a veces ponen todo ahi, sobre todo si se quedaron sin tokens.
 */
function extraerTexto(choice: unknown): string | null {
  const msg = (choice as { message?: Record<string, unknown> })?.message;
  if (!msg) return null;

  const partes: string[] = [];
  const c = msg.content;
  if (typeof c === "string") {
    partes.push(c);
  } else if (Array.isArray(c)) {
    for (const p of c) {
      if (typeof p === "string") partes.push(p);
      else if (p && typeof p === "object") {
        const t = (p as { text?: unknown }).text;
        if (typeof t === "string") partes.push(t);
      }
    }
  }

  let texto = partes.join("").trim();
  if (texto) return texto;

  // Ultimo recurso: el JSON puede haber quedado dentro del razonamiento.
  for (const k of ["reasoning", "reasoning_content"]) {
    const r = msg[k];
    if (typeof r === "string" && r.trim()) {
      texto = r.trim();
      break;
    }
  }
  return texto || null;
}

/** Explica por que no vino texto, que es lo que hace falta para arreglarlo. */
function sinTextoPorQue(choice: unknown, modelo: string): string {
  const ch = choice as { finish_reason?: string; message?: { refusal?: string } } | undefined;
  const fin = ch?.finish_reason;
  if (ch?.message?.refusal) return `El modelo ${modelo} se nego a responder: ${ch.message.refusal}`;
  if (fin === "length") {
    return `El modelo ${modelo} se quedo sin tokens antes de contestar. Sube OPENROUTER_MAX_TOKENS (por defecto ${MAX_TOKENS_DEFECTO}); los modelos de razonamiento gastan muchos pensando.`;
  }
  if (fin === "content_filter") return `La respuesta de ${modelo} fue bloqueada por su filtro de contenido.`;
  return `El modelo ${modelo} devolvio una respuesta vacia${fin ? ` (finish_reason: ${fin})` : ""}. Puede que no acepte imagenes.`;
}

/**
 * Traduce los fallos mas comunes. El de modalidad importa: varios
 * modelos de texto aceptan la peticion y fallan al ver la imagen, y el
 * mensaje crudo del proveedor no lo deja claro.
 */
function errorLegible(status: number, cuerpo: string, modelo: string): string {
  const b = cuerpo.toLowerCase();
  if (/image|vision|modality|multimodal/.test(b)) {
    return `El modelo ${modelo} no acepta imagenes. Elige uno con vision en OPENROUTER_MODEL, o usa el armado por simetria, que no necesita la referencia.`;
  }
  if (status === 401 || status === 403) return "La llave del modelo fue rechazada. Revisa OPENROUTER_API_KEY.";
  if (status === 402) return "La cuenta de OpenRouter no tiene saldo.";
  if (status === 404 || /not.{0,12}found|no endpoints/.test(b)) {
    return `OpenRouter no reconoce el modelo "${modelo}". Revisa el identificador exacto en openrouter.ai/models.`;
  }
  // OpenRouter tambien devuelve estos fallos con 200 y un campo error, asi
  // que el motivo hay que buscarlo en el cuerpo, no solo en el codigo.
  if (status === 429 || /rate.?limit|too many requests/.test(b)) {
    return "El proveedor esta limitando la tasa de peticiones. Intenta en un momento.";
  }
  if (/timeout|timed out/.test(b)) return "El modelo tardo demasiado en responder.";
  return `El proveedor respondio ${status}.`;
}

/** Extrae el primer objeto JSON del texto, tolerando cercas de markdown. */
export function extraerJson(texto: string): unknown | null {
  const m = texto.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

import { NextResponse } from "next/server";
import { presets } from "@/lib/spec";
import { extraerJson, FALTA_LLAVE, pedirVision, proveedorActivo } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------
// Lee una imagen de plano y propone preset + envolvente.
// No genera geometria: propone medidas y tu confirmas. La geometria
// siempre la produce el constructor de forma determinista.
// Para medidas exactas conviene el DXF, que se lee en el navegador.
// ---------------------------------------------------------------

export async function POST(req: Request) {
  if (!proveedorActivo()) {
    return NextResponse.json({ error: FALTA_LLAVE }, { status: 501 });
  }

  let body: { image?: string; mediaType?: string; nota?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la peticion invalido." }, { status: 400 });
  }
  if (!body.image) {
    return NextResponse.json({ error: "No se recibio ninguna imagen." }, { status: 400 });
  }

  const lista = presets.map((p) => `- ${p.id}: ${p.nombre}. ${p.descripcion}`).join("\n");

  const prompt = `Eres un tecnico de carpinteria leyendo un plano de mobiliario o una fotografia de un mueble.

Tipos disponibles:
${lista}

Extrae la envolvente del mueble. Reglas:
- Todas las medidas en MILIMETROS. Si el plano viene en metros (0.50 m), convierte a mm (500).
- "alto" es la altura TOTAL incluyendo patas o zoclo y cubierta.
- Si un valor no se puede leer, omitelo: NO lo inventes.
- Anota en "materiales" lo que diga la leyenda y en "supuestos" lo que hayas inferido.

Responde SOLO con JSON valido, sin markdown:
{"preset":"id","ancho":numero,"alto":numero,"prof":numero,"confianza":"alta|media|baja","materiales":["texto"],"supuestos":["texto"],"notas":"texto"}${
    body.nota ? `\n\nContexto adicional: ${body.nota}` : ""
  }`;

  const r = await pedirVision({
    prompt,
    imagenB64: body.image,
    mediaType: body.mediaType || "image/png",
    maxTokens: 1200,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.error, detail: r.detalle }, { status: r.status });
  }

  const spec = extraerJson(r.texto) as Record<string, unknown> | null;
  if (!spec) {
    return NextResponse.json(
      {
        error: `El modelo ${r.modelo} no devolvio JSON interpretable.`,
        detail: r.texto.slice(0, 300),
      },
      { status: 502 }
    );
  }

  const preset = presets.find((p) => p.id === spec.preset)?.id ?? "base";
  const lim = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 100 && n <= 4000 ? Math.round(n) : undefined;
  };

  return NextResponse.json({
    preset,
    ancho: lim(spec.ancho),
    alto: lim(spec.alto),
    prof: lim(spec.prof),
    confianza: spec.confianza ?? "media",
    materiales: Array.isArray(spec.materiales) ? spec.materiales.slice(0, 10) : [],
    supuestos: Array.isArray(spec.supuestos) ? spec.supuestos.slice(0, 8) : [],
    notas: typeof spec.notas === "string" ? spec.notas : "",
    modelo: r.modelo,
    proveedor: r.proveedor,
  });
}

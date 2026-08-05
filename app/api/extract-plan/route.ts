import { NextResponse } from "next/server";
import { presets } from "@/lib/spec";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------
// Lee una imagen de plano y propone preset + envolvente.
// No genera geometria: propone medidas y tu confirmas. La geometria
// siempre la produce el constructor de forma determinista.
// Para medidas exactas conviene el DXF, que se lee en el navegador.
// ---------------------------------------------------------------

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY. Agregala en las variables de entorno de Vercel para leer imagenes. La importacion de DXF funciona sin esto.",
      },
      { status: 501 }
    );
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

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: body.mediaType || "image/png",
                  data: body.image,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `La API respondio ${res.status}.`, detail: detail.slice(0, 400) },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text: string = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");

    const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json(
        { error: "No se pudo interpretar la respuesta del modelo." },
        { status: 502 }
      );
    }

    const spec = JSON.parse(match[0]);
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
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Fallo la lectura del plano.", detail: String(e).slice(0, 300) },
      { status: 500 }
    );
  }
}

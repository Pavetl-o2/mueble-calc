import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------
// Lee una imagen de referencia del mueble armado y propone COMO se
// arma, no la geometria.
//
// El reparto es a proposito: el encaje exacto (donde cae cada pieza,
// que espiga entra en que mortaja) es geometria determinista y se
// resuelve en lib/cncArmado. Lo que el modelo aporta es lo que la
// geometria no puede saber sola: cual pieza es la cubierta, cuales son
// patas, hacia donde abren, que alto tiene el mueble terminado.
//
// Por eso aqui NO se piden matrices ni posiciones: se piden roles y
// cuatro numeros que el armador usa como parametros.
// ---------------------------------------------------------------

interface PiezaResumen {
  id: string;
  largo: number;
  ancho: number;
  areaM2: number;
  huecos: number;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY. Agregala en las variables de entorno de Vercel para leer la imagen de referencia. El armado automatico por simetria funciona sin esto.",
      },
      { status: 501 }
    );
  }

  let body: {
    image?: string;
    mediaType?: string;
    piezas?: PiezaResumen[];
    espesor?: number;
    anguloDetectado?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la peticion invalido." }, { status: 400 });
  }
  if (!body.image) {
    return NextResponse.json({ error: "No se recibio ninguna imagen." }, { status: 400 });
  }
  const piezas = Array.isArray(body.piezas) ? body.piezas.slice(0, 40) : [];
  if (!piezas.length) {
    return NextResponse.json({ error: "No se recibio la lista de piezas." }, { status: 400 });
  }

  const tabla = piezas
    .map(
      (p) =>
        `- ${p.id}: caja ${Math.round(p.largo)} x ${Math.round(p.ancho)} mm, area real ${p.areaM2.toFixed(
          3
        )} m2, ${p.huecos} hueco(s) interior(es)`
    )
    .join("\n");

  const prompt = `Eres un tecnico de carpinteria. Te doy dos cosas:

1) La imagen de un mueble ARMADO (referencia visual).
2) La lista de piezas planas que salieron de su archivo de corte CNC:

${tabla}

Datos ya medidos del archivo de corte (son exactos, no los contradigas):
- Espesor del tablero: ${body.espesor ?? "desconocido"} mm
- Angulo de entrada detectado en las mortajas: ${
    body.anguloDetectado != null ? `${body.anguloDetectado}°` : "ninguno (todo a escuadra)"
  }

Tu trabajo es decir COMO SE ARMA, no donde va cada punto. Reglas:
- Asigna un rol a cada pieza: "panel" (superficie horizontal, suele ser la de mayor area y la que trae los huecos), "vertical" (pata, costado o faldon) u "otro".
- Normalmente hay UN solo panel.
- "alto" es la altura TOTAL del mueble armado en mm, leida de las proporciones de la imagen. Una mesa de comedor ronda 750, una de centro 400, un banco 450.
- "inclinacion" en grados es cuanto abren las piezas verticales respecto a la vertical. Si en la imagen las patas se ven abiertas hacia afuera usa el angulo detectado arriba; si se ven rectas, 0.
- "radio" en mm es la distancia del centro del mueble a cada pieza vertical.
- Si algo no se puede leer de la imagen, omitelo: NO lo inventes.

Responde SOLO con JSON valido, sin markdown:
{"roles":{"id":"panel|vertical|otro"},"alto":numero,"inclinacion":numero,"radio":numero,"familia":"texto corto","confianza":"alta|media|baja","observaciones":["texto"]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 1500,
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
    const out = JSON.parse(match[0]);

    // Se filtra contra las piezas reales: el modelo no puede inventar ids.
    const validos = new Set(piezas.map((p) => p.id));
    const roles: Record<string, string> = {};
    for (const [id, rol] of Object.entries(out.roles ?? {})) {
      if (!validos.has(id)) continue;
      if (rol === "panel" || rol === "vertical" || rol === "otro") roles[id] = rol;
    }

    const num = (v: unknown, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
    };

    return NextResponse.json({
      roles,
      alto: num(out.alto, 100, 3000),
      inclinacion: num(out.inclinacion, 0, 60),
      radio: num(out.radio, 20, 3000),
      familia: typeof out.familia === "string" ? out.familia.slice(0, 80) : "",
      confianza: ["alta", "media", "baja"].includes(out.confianza) ? out.confianza : "media",
      observaciones: Array.isArray(out.observaciones) ? out.observaciones.slice(0, 8) : [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Fallo la lectura de la referencia.", detail: String(e).slice(0, 300) },
      { status: 500 }
    );
  }
}

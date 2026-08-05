"use client";

import { useState } from "react";
import { leerDxf, proponerEnvolvente, type DxfLectura } from "@/lib/dxf";
import { cloneSpec, getPreset, presets, type FurnitureSpec } from "@/lib/spec";

type Destino = "ancho" | "alto" | "prof" | "";

export default function ImportPanel({
  spec,
  onApply,
}: {
  spec: FurnitureSpec;
  onApply: (s: FurnitureSpec) => void;
}) {
  const [lectura, setLectura] = useState<DxfLectura | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [mapa, setMapa] = useState<Record<number, Destino>>({});
  const [presetId, setPresetId] = useState("base");
  const [razon, setRazon] = useState("");

  // Ruta de imagen
  const [img, setImg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgSpec, setImgSpec] = useState<{
    preset: string;
    ancho?: number;
    alto?: number;
    prof?: number;
    materiales: string[];
    supuestos: string[];
    confianza: string;
  } | null>(null);

  async function handleDxf(file: File) {
    const texto = await file.text();
    const l = leerDxf(texto);
    setLectura(l);
    setNombreArchivo(file.name);
    if (!l.ok) return;

    const p = proponerEnvolvente(l);
    setRazon(p.razon);
    const m: Record<number, Destino> = {};
    if (p.ancho) m[p.ancho] = "ancho";
    if (p.alto) m[p.alto] = "alto";
    if (p.prof) m[p.prof] = "prof";
    setMapa(m);
  }

  function aplicarDxf() {
    const base = cloneSpec(getPreset(presetId).make());
    let usadas = 0;
    for (const [valorStr, destino] of Object.entries(mapa)) {
      const v = Number(valorStr);
      if (!destino || !Number.isFinite(v)) continue;
      base[destino] = Math.round(v);
      usadas++;
    }
    if (!usadas) return;
    base.nombre = nombreArchivo.replace(/\.dxf$/i, "") || base.nombre;
    onApply(base);
  }

  async function leerImagen() {
    if (!img) return;
    setImgBusy(true);
    setImgError(null);
    try {
      const [meta, b64] = img.split(",");
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? "image/png";
      const res = await fetch("/api/extract-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: b64, mediaType }),
      });
      const data = await res.json();
      if (!res.ok) setImgError(data.error ?? "No se pudo leer el plano.");
      else setImgSpec(data);
    } catch (e) {
      setImgError(String(e));
    } finally {
      setImgBusy(false);
    }
  }

  function aplicarImagen() {
    if (!imgSpec) return;
    const base = cloneSpec(getPreset(imgSpec.preset).make());
    if (imgSpec.ancho) base.ancho = Math.round(imgSpec.ancho);
    if (imgSpec.alto) base.alto = Math.round(imgSpec.alto);
    if (imgSpec.prof) base.prof = Math.round(imgSpec.prof);
    onApply(base);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ---------------- DXF ---------------- */}
      <section className="space-y-3">
        <div>
          <h3 className="text-[15px] font-medium">Importar shop drawing en DXF</h3>
          <p className="text-[13px] text-muted mt-0.5">
            El DXF trae las medidas exactas del dibujo. Se leen las cotas, los textos y las
            vistas; tu decides que medida es el ancho, el alto y la profundidad. El archivo se
            procesa en tu navegador, no se sube a ningun lado.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="btn cursor-pointer">
            Elegir archivo DXF
            <input
              type="file"
              accept=".dxf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleDxf(f);
              }}
            />
          </label>
          {nombreArchivo && (
            <span className="text-[13px] text-muted">{nombreArchivo}</span>
          )}
        </div>

        {lectura && !lectura.ok && (
          <div className="card border-bronze bg-bronzeLight p-3 text-[13px] text-bronze">
            {lectura.error}
          </div>
        )}

        {lectura?.ok && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 cq-cols-4 gap-2 text-[13px]">
              <Dato label="Entidades" valor={String(lectura.totalEntidades)} />
              <Dato label="Cotas" valor={String(lectura.cotas.length)} />
              <Dato label="Vistas" valor={String(lectura.vistas.length)} />
              <Dato label="Unidades" valor={lectura.unidades} />
            </div>

            {lectura.notas.length > 0 && (
              <div className="text-[12px] text-muted">{lectura.notas.join(" ")}</div>
            )}

            <div>
              <div className="lbl mb-2">Medidas encontradas — asigna las principales</div>
              <div className="card overflow-x-auto">
                <table className="w-full text-[13px] min-w-[380px]">
                  <thead>
                    <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                      <th className="lbl px-3 py-2 font-medium">Medida</th>
                      <th className="lbl px-2 py-2 font-medium">Origen</th>
                      <th className="lbl px-3 py-2 font-medium">Asignar a</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lectura.candidatosDetalle.slice(0, 14).map((c) => (
                      <tr key={c.valor} className="border-b border-rule/60 last:border-0">
                        <td className="num px-3 py-1.5">{c.valor} mm</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${
                              c.fuente === "cota"
                                ? "bg-pineLight text-pine"
                                : c.fuente === "texto"
                                ? "bg-bronzeLight text-bronze"
                                : "bg-[#EDEFEA] text-muted"
                            }`}
                          >
                            {c.fuente === "cota"
                              ? "cota medida"
                              : c.fuente === "texto"
                              ? "texto"
                              : "tamano de vista"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            aria-label={`Asignar ${c.valor} mm`}
                            className="px-2 py-1 rounded border border-rule bg-panel text-[12px] focus:outline-none focus:border-pine"
                            value={mapa[c.valor] ?? ""}
                            onChange={(e) =>
                              setMapa((m) => ({ ...m, [c.valor]: e.target.value as Destino }))
                            }
                          >
                            <option value="">—</option>
                            <option value="ancho">Ancho</option>
                            <option value="alto">Alto total</option>
                            <option value="prof">Profundidad</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {razon && <p className="text-[12px] text-muted mt-2">{razon}</p>}
            </div>

            {lectura.textos.length > 0 && (
              <div>
                <div className="lbl mb-1">Textos del dibujo</div>
                <p className="text-[12px] text-muted">
                  {lectura.textos.slice(0, 18).join(" · ")}
                </p>
                <p className="text-[12px] text-muted mt-1">
                  Si aqui aparecen materiales, asignalos despues en la pestana Estructura.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div>
                <label className="lbl block mb-1" htmlFor="preset-dxf">
                  Punto de partida
                </label>
                <select
                  id="preset-dxf"
                  className="px-2 py-1.5 rounded border border-rule bg-panel text-[13px] focus:outline-none focus:border-pine"
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={aplicarDxf}>
                Generar modelo con estas medidas
              </button>
            </div>
            <p className="text-[12px] text-muted">
              El DXF da la envolvente. La division interna (puertas, cajones, repisas) se ajusta
              en la pestana Estructura: es una decision de metodo constructivo que el dibujo casi
              nunca especifica.
            </p>
          </div>
        )}
      </section>

      {/* ---------------- Imagen ---------------- */}
      <section className="space-y-3 border-t border-rule pt-6">
        <div>
          <h3 className="text-[15px] font-medium">Importar desde imagen</h3>
          <p className="text-[13px] text-muted mt-0.5">
            Para cuando solo hay una foto o un PDF exportado a imagen. Es menos preciso que el
            DXF: propone medidas que hay que verificar. Requiere configurar la llave del modelo
            (OPENROUTER_API_KEY o ANTHROPIC_API_KEY).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="btn cursor-pointer">
            Elegir imagen
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setImgSpec(null);
                setImgError(null);
                const url = await new Promise<string>((res, rej) => {
                  const r = new FileReader();
                  r.onload = () => res(String(r.result));
                  r.onerror = () => rej(new Error("No se pudo leer el archivo."));
                  r.readAsDataURL(f);
                });
                setImg(url);
              }}
            />
          </label>
          <button className="btn btn-primary" disabled={!img || imgBusy} onClick={leerImagen}>
            {imgBusy ? "Leyendo…" : "Leer imagen"}
          </button>
        </div>

        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt="Plano cargado"
            className="max-h-56 rounded border border-rule bg-panel object-contain"
          />
        )}

        {imgError && (
          <div className="card border-bronze bg-bronzeLight p-3 text-[13px] text-bronze">
            {imgError}
          </div>
        )}

        {imgSpec && (
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="lbl">Propuesta · confianza {imgSpec.confianza}</div>
              <button className="btn btn-primary" onClick={aplicarImagen}>
                Aplicar
              </button>
            </div>
            <div className="num text-[13px]">
              {imgSpec.ancho ?? "?"} × {imgSpec.prof ?? "?"} × {imgSpec.alto ?? "?"} mm ·{" "}
              {getPreset(imgSpec.preset).nombre}
            </div>
            {imgSpec.materiales?.length > 0 && (
              <div className="text-[12px] text-muted">
                Materiales: {imgSpec.materiales.join(" · ")}
              </div>
            )}
            {imgSpec.supuestos?.length > 0 && (
              <ul className="text-[12px] text-muted list-disc list-inside">
                {imgSpec.supuestos.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="lbl">{label}</div>
      <div className="num text-[15px]">{valor}</div>
    </div>
  );
}

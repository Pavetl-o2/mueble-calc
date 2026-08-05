"use client";

import { useMemo, useState } from "react";
import { leerCorteDxf, type LecturaCnc } from "@/lib/cnc";
import {
  opcionesSugeridas,
  panelDe,
  type AjustePieza,
  type AsignacionCnc,
  type OpcionesArmado,
  type Rol,
} from "@/lib/cncArmado";
import { detectarEnsambles } from "@/lib/cncEnsambles";
import { postJson, prepararImagen, type ImagenLista } from "@/lib/imagen";
import type { Catalog } from "@/lib/types";

interface Respuesta {
  roles?: Record<string, string>;
  alto?: number;
  inclinacion?: number;
  radio?: number;
  familia?: string;
  confianza?: string;
  observaciones?: string[];
  modelo?: string;
  proveedor?: string;
}

export interface EstadoCnc {
  lectura: LecturaCnc;
  asig: AsignacionCnc;
  opciones: OpcionesArmado;
  armar: boolean;
  nombre: string;
  /** Correcciones manuales del usuario, por pieza. */
  ajustes: Record<string, AjustePieza>;
}

export default function CncPanel({
  catalog,
  estado,
  onEstado,
  selected,
  onSelect,
}: {
  catalog: Catalog;
  estado: EstadoCnc | null;
  onEstado: (e: EstadoCnc | null) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");

  // Referencia visual
  const [img, setImg] = useState<ImagenLista | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgNotas, setImgNotas] = useState<string[]>([]);

  const matDefault = catalog.materiales[0]?.sku ?? "";
  const cantoDefault = catalog.cantos[0]?.sku ?? "";

  async function cargarDxf(file: File) {
    setError(null);
    setImgNotas([]);
    const l = leerCorteDxf(await file.text());
    if (!l.ok) {
      setError(l.error ?? "No se pudo leer el archivo.");
      onEstado(null);
      return;
    }
    const material: Record<string, string> = {};
    const cantear: Record<string, boolean> = {};
    for (const p of l.piezas) {
      material[p.id] = matDefault;
      cantear[p.id] = false;
    }
    setArchivo(file.name);
    onEstado({
      lectura: l,
      asig: { material, cantear, cantoSku: cantoDefault, espesor: l.espesor ?? 18 },
      opciones: opcionesSugeridas(l),
      armar: false,
      nombre: file.name.replace(/\.dxf$/i, ""),
      ajustes: {},
    });
  }

  async function leerReferencia() {
    if (!img || !estado) return;
    setImgBusy(true);
    setImgError(null);
    try {
      const r = await postJson<Respuesta>("/api/cnc-armado", {
        image: img.dataUrl.split(",")[1],
        mediaType: img.mediaType,
        espesor: estado.asig.espesor,
        anguloDetectado: estado.lectura.ranuras.find((x) => x.anguloGrados)?.anguloGrados,
        piezas: estado.lectura.piezas.map((p) => ({
          id: p.id,
          largo: p.largo,
          ancho: p.ancho,
          areaM2: p.areaMm2 / 1e6,
          huecos: p.huecos.length,
        })),
      });
      if (!r.ok) {
        setImgError(r.error);
        return;
      }
      const data = r.data;
      // El dibujo manda sobre la imagen. Si las mortajas dieron el radio
      // y el angulo, son medidas exactas y no se dejan sobrescribir por
      // una estimacion hecha a ojo sobre un render. De la imagen solo se
      // toma lo que el DXF no puede saber: el alto y los roles.
      const hayMortajas = estado.lectura.piezas.some((p) => p.huecos.length > 0);
      const hayAngulo = estado.lectura.ranuras.some((x) => x.anguloGrados != null);
      const ignorado: string[] = [];
      if (hayMortajas && data.radio != null && data.radio !== estado.opciones.radio) {
        ignorado.push(`radio ${data.radio} mm (se usa ${estado.opciones.radio} mm de las mortajas)`);
      }
      if (hayAngulo && data.inclinacion != null && data.inclinacion !== estado.opciones.inclinacion) {
        ignorado.push(
          `apertura ${data.inclinacion}° (se usan ${estado.opciones.inclinacion}° del ancho de ranura)`
        );
      }

      onEstado({
        ...estado,
        armar: true,
        opciones: {
          alto: data.alto ?? estado.opciones.alto,
          inclinacion: hayAngulo
            ? estado.opciones.inclinacion
            : data.inclinacion ?? estado.opciones.inclinacion,
          radio: hayMortajas ? estado.opciones.radio : data.radio ?? estado.opciones.radio,
          roles: data.roles as Record<string, Rol> | undefined,
        },
      });
      setImgNotas([
        ...(data.familia ? [`Familia: ${data.familia} (confianza ${data.confianza}).`] : []),
        ...(data.observaciones ?? []),
        ...(ignorado.length ? [`Se ignoro de la imagen, por haber medida en el DXF: ${ignorado.join("; ")}.`] : []),
        ...(data.modelo ? [`Leido con ${data.modelo} via ${data.proveedor}.`] : []),
      ]);
    } finally {
      setImgBusy(false);
    }
  }

  const resumen = useMemo(() => {
    if (!estado) return null;
    const ps = estado.lectura.piezas;
    return {
      n: ps.length,
      m2: ps.reduce((a, p) => a + p.areaMm2, 0) / 1e6,
      mortajas: ps.reduce((a, p) => a + p.huecos.length, 0),
    };
  }, [estado]);

  // ------------------------------------------------------------

  if (!estado) {
    return (
      <div className="space-y-6 max-w-4xl">
        <section className="space-y-3">
          <div>
            <h3 className="text-[15px] font-medium">Importar DXF de corte</h3>
            <p className="text-[13px] text-muted mt-0.5">
              Este modulo es para archivos que ya traen las piezas despiezadas y acomodadas
              para nesting, como los que salen de un CAM o de un diseno flat-pack. Encadena
              los contornos, mide area y perimetro reales, y saca el espesor del ancho de las
              mortajas.
            </p>
          </div>
          <label className="btn btn-primary cursor-pointer w-fit">
            Elegir archivo DXF de corte
            <input
              type="file"
              accept=".dxf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) cargarDxf(f);
              }}
            />
          </label>
          {error && (
            <div className="card border-bronze bg-bronzeLight p-3 text-[13px] text-bronze">
              {error}
            </div>
          )}
          <div className="card p-3 text-[12px] text-muted">
            <div className="lbl mb-1.5">Para que NO sirve</div>
            Un plano de taller con cotas y vistas va en la pestana Importar, no aqui. Y solo se
            pueden recuperar los ensambles que esten cortados en la pieza: si el mueble se arma
            con tornillos o tarugos, esa informacion no existe en el archivo.
          </div>
        </section>
      </div>
    );
  }

  const l = estado.lectura;
  const panel = panelDe(l);
  const ensambles = detectarEnsambles(l.piezas, panel, estado.asig.espesor);
  const piezaSel = l.piezas.find((p) => p.id === selected);
  const esPanelSel = piezaSel != null && piezaSel === panel;
  const ajusteSel: AjustePieza = (selected && estado.ajustes[selected]) || {};

  const setAjuste = (id: string, delta: Partial<AjustePieza>) =>
    onEstado({
      ...estado,
      armar: true,
      ajustes: { ...estado.ajustes, [id]: { ...(estado.ajustes[id] ?? {}), ...delta } },
    });
  const limpiarAjuste = (id: string) => {
    const resto = { ...estado.ajustes };
    delete resto[id];
    onEstado({ ...estado, ajustes: resto });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium truncate">{archivo}</h3>
          <p className="num text-[12px] text-muted">
            {resumen?.n} piezas · {resumen?.m2.toFixed(3)} m² · {resumen?.mortajas} mortajas
          </p>
        </div>
        <button className="btn shrink-0" onClick={() => onEstado(null)}>
          Cargar otro
        </button>
      </div>

      {l.notas.map((n, i) => (
        <p key={i} className="text-[12px] text-muted -mt-3">
          {n}
        </p>
      ))}

      {/* ---- Material y espesor ---- */}
      <section>
        <h3 className="text-[15px] font-medium mb-2">Material</h3>
        <div className="card p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[13px]">Espesor del tablero</label>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                aria-label="Espesor del tablero"
                className="field w-[82px]"
                value={estado.asig.espesor}
                onChange={(e) =>
                  onEstado({
                    ...estado,
                    asig: { ...estado.asig, espesor: Math.max(1, Number(e.target.value) || 18) },
                  })
                }
              />
              <span className="text-[11px] text-muted w-[20px]">mm</span>
            </div>
          </div>
          {l.espesor != null && (
            <p className="text-[11px] text-muted">
              Inferido del archivo: {l.espesor} mm.{" "}
              {l.ranuras
                .map((r) =>
                  r.anguloGrados
                    ? `ranura de ${r.ancho} mm → entra a ${r.anguloGrados}°`
                    : `ranura de ${r.ancho} mm → a escuadra`
                )
                .join(" · ")}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <label className="text-[13px] shrink-0">Canto</label>
            <select
              aria-label="Canto"
              className="px-2 py-1 rounded border border-rule bg-panel text-[12px] max-w-[190px] focus:outline-none focus:border-pine"
              value={estado.asig.cantoSku}
              onChange={(e) =>
                onEstado({ ...estado, asig: { ...estado.asig, cantoSku: e.target.value } })
              }
            >
              {catalog.cantos.map((c) => (
                <option key={c.sku} value={c.sku}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* ---- Piezas ---- */}
      <section>
        <h3 className="text-[15px] font-medium mb-2">Piezas detectadas</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[430px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Pieza</th>
                <th className="lbl px-2 py-2 text-right font-medium">Area</th>
                <th className="lbl px-2 py-2 font-medium">Material</th>
                <th className="lbl px-2 py-2 text-center font-medium">Canto</th>
              </tr>
            </thead>
            <tbody>
              {l.piezas.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onSelect(selected === p.id ? null : p.id)}
                  className={`border-b border-rule/60 last:border-0 align-top cursor-pointer ${
                    selected === p.id ? "bg-pineLight" : ""
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <div>
                      {p === panel ? "Panel" : "Pieza"}
                      {p.huecos.length > 0 && (
                        <span className="ml-1.5 text-[11px] text-bronze">
                          {p.huecos.length} mortajas
                        </span>
                      )}
                    </div>
                    <div className="num text-[11px] text-muted">
                      {Math.round(p.largo)} × {Math.round(p.ancho)} mm · {(p.perimetroMm / 1000).toFixed(2)} m
                    </div>
                  </td>
                  <td className="num px-2 py-1.5 text-right whitespace-nowrap">
                    {(p.areaMm2 / 1e6).toFixed(3)}
                    <span className="ml-1 text-[11px] text-muted">m²</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Material de ${p.id}`}
                      className="px-2 py-1 rounded border border-rule bg-panel text-[12px] max-w-[150px] focus:outline-none focus:border-pine"
                      value={estado.asig.material[p.id] ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onEstado({
                          ...estado,
                          asig: {
                            ...estado.asig,
                            material: { ...estado.asig.material, [p.id]: e.target.value },
                          },
                        })
                      }
                    >
                      {catalog.materiales.map((m) => (
                        <option key={m.sku} value={m.sku}>
                          {m.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`Cantear ${p.id}`}
                      className="w-4 h-4 accent-pine"
                      checked={estado.asig.cantear[p.id] ?? false}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onEstado({
                          ...estado,
                          asig: {
                            ...estado.asig,
                            cantear: { ...estado.asig.cantear, [p.id]: e.target.checked },
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-muted mt-2">
          El area es la del contorno real, ya sin mortajas. El canto se cobra sobre el perimetro
          completo, que es como se cantea una pieza de forma libre.
        </p>
      </section>

      {/* ---- Armado ---- */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[15px] font-medium">Armado</h3>
          <button
            className={`btn ${estado.armar ? "btn-primary" : ""}`}
            onClick={() => onEstado({ ...estado, armar: !estado.armar })}
          >
            {estado.armar ? "Ver piezas planas" : "Armar en 3D"}
          </button>
        </div>

        <div className="card p-3 space-y-3">
          <Rango
            label="Alto total"
            v={estado.opciones.alto}
            min={100}
            max={2000}
            u="mm"
            on={(v) => onEstado({ ...estado, opciones: { ...estado.opciones, alto: v } })}
          />
          <Rango
            label="Apertura"
            v={estado.opciones.inclinacion}
            min={0}
            max={60}
            u="°"
            on={(v) => onEstado({ ...estado, opciones: { ...estado.opciones, inclinacion: v } })}
          />
          <Rango
            label="Radio"
            v={estado.opciones.radio}
            min={20}
            max={2000}
            u="mm"
            on={(v) => onEstado({ ...estado, opciones: { ...estado.opciones, radio: v } })}
          />
        </div>
        <p className="text-[12px] text-muted mt-2">
          Estos tres controles mueven todas las piezas a la vez. Para corregir una sola,
          seleccionala en el visor o en la tabla de arriba. El despiece y el costo NO dependen
          del armado.
        </p>
      </section>

      {/* ---- Ensambles detectados ---- */}
      <section>
        <h3 className="text-[15px] font-medium mb-2">Ensambles detectados</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[380px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Espiga</th>
                <th className="lbl px-2 py-2 font-medium">Mortaja</th>
                <th className="lbl px-2 py-2 text-right font-medium">Holgura</th>
                <th className="lbl px-3 py-2 text-right font-medium">Entra a</th>
              </tr>
            </thead>
            <tbody>
              {ensambles.ensambles.map((e, i) => {
                const lg = ensambles.lenguetas[e.piezaId]?.[e.lengueta];
                return (
                  <tr
                    key={i}
                    onClick={() => onSelect(e.piezaId)}
                    className={`border-b border-rule/60 last:border-0 cursor-pointer ${
                      selected === e.piezaId ? "bg-pineLight" : ""
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      {e.piezaId}
                      {lg && <span className="num text-[11px] text-muted ml-1.5">{lg.ancho} mm</span>}
                    </td>
                    <td className="num px-2 py-1.5 text-[12px] text-muted">#{e.mortaja}</td>
                    <td className="num px-2 py-1.5 text-right">
                      {e.holgura.toFixed(1)}
                      <span className="text-[11px] text-muted ml-0.5">mm</span>
                    </td>
                    <td className="num px-3 py-1.5 text-right">
                      {e.angulo ? `${e.angulo}°` : "escuadra"}
                    </td>
                  </tr>
                );
              })}
              {!ensambles.ensambles.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-[12px] text-muted">
                    No se emparejo ninguna espiga con las mortajas del panel.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {ensambles.notas.map((n, i) => (
          <p key={i} className="text-[12px] text-muted mt-2">
            {n}
          </p>
        ))}
      </section>

      {/* ---- Ajuste de una pieza ---- */}
      {piezaSel && (
        <section>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-[15px] font-medium">Ajustar {piezaSel.id}</h3>
            <div className="flex gap-1.5">
              <button
                className="btn"
                onClick={() => setAjuste(piezaSel.id, { voltear: !ajusteSel.voltear })}
              >
                Voltear
              </button>
              <button className="btn" onClick={() => limpiarAjuste(piezaSel.id)}>
                Restaurar
              </button>
            </div>
          </div>
          <div className="card p-3 space-y-3">
            <Rango label="Girar" v={ajusteSel.giro ?? 0} min={-180} max={180} u="°"
              on={(v) => setAjuste(piezaSel.id, { giro: v })} />
            <Rango label="Correr" v={ajusteSel.desliz ?? 0} min={-600} max={600} u="mm"
              on={(v) => setAjuste(piezaSel.id, { desliz: v })} />
            <Rango label="Acercar" v={ajusteSel.radio ?? 0} min={-400} max={400} u="mm"
              on={(v) => setAjuste(piezaSel.id, { radio: v })} />
            <Rango label="Subir" v={ajusteSel.z ?? 0} min={-600} max={600} u="mm"
              on={(v) => setAjuste(piezaSel.id, { z: v })} />
            <Rango label="Rotar en plano" v={ajusteSel.giroLocal ?? 0} min={-180} max={180} u="°"
              on={(v) => setAjuste(piezaSel.id, { giroLocal: v })} />
            {/* Inclinar solo tiene sentido en una pieza parada. */}
            {!esPanelSel && (
              <Rango label="Abrir" v={ajusteSel.inclinacion ?? 0} min={-45} max={45} u="°"
                on={(v) => setAjuste(piezaSel.id, { inclinacion: v })} />
            )}
          </div>
          <p className="text-[12px] text-muted mt-2">
            Son correcciones sobre lo que propuso el armador, no valores absolutos. Se guardan
            por pieza y no afectan al despiece.
          </p>
        </section>
      )}

      {/* ---- Referencia visual ---- */}
      <section className="space-y-3">
        <div>
          <h3 className="text-[15px] font-medium">Imagen de referencia</h3>
          <p className="text-[13px] text-muted mt-0.5">
            Opcional. Una foto o render del mueble armado ayuda a decidir que pieza es cual y
            que proporciones tiene. No aporta medidas: esas ya salieron del DXF.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn cursor-pointer">
            Elegir imagen
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setImgError(null);
                try {
                  setImg(await prepararImagen(f));
                } catch (err) {
                  setImgError(String(err));
                }
              }}
            />
          </label>
          <button className="btn btn-primary" disabled={!img || imgBusy} onClick={leerReferencia}>
            {imgBusy ? "Leyendo…" : "Proponer armado"}
          </button>
        </div>
        {img && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.dataUrl}
              alt="Referencia"
              className="max-h-[150px] rounded border border-rule"
            />
            <span className="num text-[11px] text-muted">
              {img.ancho > 0 && `${img.ancho}×${img.alto} · `}
              {Math.round(img.bytes / 1024)} KB
              {img.reducida && " (reducida)"}
            </span>
          </div>
        )}
        {imgError && (
          <div className="card border-bronze bg-bronzeLight p-3 text-[13px] text-bronze space-y-1.5">
            <div>{imgError}</div>
            <div className="text-[12px]">
              Para ver donde falla la conexion con el modelo, abre{" "}
              <a href="/api/diagnostico" target="_blank" rel="noreferrer" className="underline">
                /api/diagnostico
              </a>
              .
            </div>
          </div>
        )}
        {imgNotas.length > 0 && (
          <ul className="text-[12px] text-muted space-y-0.5 list-disc list-inside">
            {imgNotas.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Rango({
  label,
  v,
  min,
  max,
  u,
  on,
}: {
  label: string;
  v: number;
  min: number;
  max: number;
  u: string;
  on: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[13px] w-[80px] shrink-0">{label}</label>
      <input
        type="range"
        aria-label={label}
        className="flex-1 h-1 cursor-pointer min-w-0"
        min={min}
        max={max}
        value={v}
        onChange={(e) => on(Number(e.target.value))}
      />
      <span className="num text-[12px] w-[62px] text-right shrink-0">
        {v}
        <span className="text-[11px] text-muted ml-0.5">{u}</span>
      </span>
    </div>
  );
}

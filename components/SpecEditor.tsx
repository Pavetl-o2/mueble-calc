"use client";

import {
  celda as mkCelda,
  columna as mkColumna,
  cloneSpec,
  type FrenteTipo,
  type FurnitureSpec,
} from "@/lib/spec";
import type { Catalog } from "@/lib/types";

const FRENTES: { v: FrenteTipo; t: string }[] = [
  { v: "puerta_doble", t: "2 puertas" },
  { v: "puerta_izq", t: "1 puerta izq" },
  { v: "puerta_der", t: "1 puerta der" },
  { v: "cajon", t: "Cajon" },
  { v: "abierto", t: "Abierto" },
];

export default function SpecEditor({
  spec,
  catalog,
  onChange,
}: {
  spec: FurnitureSpec;
  catalog: Catalog;
  onChange: (s: FurnitureSpec) => void;
}) {
  const set = (fn: (s: FurnitureSpec) => void) => {
    const next = cloneSpec(spec);
    fn(next);
    onChange(next);
  };

  const matOpts = catalog.materiales.map((m) => ({ v: m.sku, t: m.nombre }));
  const cantoOpts = catalog.cantos.map((c) => ({ v: c.sku, t: c.nombre }));
  const herrOpts = catalog.herrajes.map((h) => ({ v: h.sku, t: h.nombre }));
  const acabOpts = [{ v: "", t: "Sin acabado" }, ...catalog.acabados.map((a) => ({ v: a.sku, t: a.nombre }))];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Envolvente */}
      <section>
        <h3 className="text-[15px] font-medium mb-2">Envolvente</h3>
        <div className="card p-3 grid sm:grid-cols-3 gap-3">
          <Num label="Ancho" v={spec.ancho} u="mm" on={(v) => set((s) => { s.ancho = v; })} />
          <Num label="Alto total" v={spec.alto} u="mm" on={(v) => set((s) => { s.alto = v; })} />
          <Num label="Profundidad" v={spec.prof} u="mm" on={(v) => set((s) => { s.prof = v; })} />
        </div>
        <p className="text-[12px] text-muted mt-1.5">
          El alto total incluye base y cubierta. El cuerpo se calcula restandolas.
        </p>
      </section>

      {/* Base y cubierta */}
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h3 className="text-[15px] font-medium mb-2">Base</h3>
          <div className="card p-3 space-y-3">
            <Sel
              label="Tipo"
              v={spec.base.tipo}
              opts={[
                { v: "zoclo", t: "Zoclo" },
                { v: "patas", t: "Patas" },
                { v: "ninguna", t: "Sin base" },
              ]}
              on={(v) => set((s) => { s.base.tipo = v as FurnitureSpec["base"]["tipo"]; })}
            />
            {spec.base.tipo !== "ninguna" && (
              <>
                <Num label="Alto de base" v={spec.base.alto} u="mm" on={(v) => set((s) => { s.base.alto = v; })} />
                <Num label="Retiro del frente" v={spec.base.retiro} u="mm" on={(v) => set((s) => { s.base.retiro = v; })} />
              </>
            )}
            {spec.base.tipo === "patas" && (
              <>
                <Num label="Seccion de pata" v={spec.base.seccion} u="mm" on={(v) => set((s) => { s.base.seccion = v; })} />
                <Sel
                  label="Pata (catalogo)"
                  v={spec.base.herrajeSku}
                  opts={herrOpts}
                  on={(v) => set((s) => { s.base.herrajeSku = v; })}
                />
              </>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-[15px] font-medium mb-2">Cubierta</h3>
          <div className="card p-3 space-y-3">
            <Sel
              label="Tipo"
              v={spec.cubierta.tipo}
              opts={[
                { v: "ninguna", t: "Sin cubierta" },
                { v: "integrada", t: "Integrada (mismo tablero)" },
                { v: "sobrepuesta", t: "Sobrepuesta (piedra, etc.)" },
              ]}
              on={(v) => set((s) => { s.cubierta.tipo = v as FurnitureSpec["cubierta"]["tipo"]; })}
            />
            {spec.cubierta.tipo !== "ninguna" && (
              <>
                <Sel label="Material" v={spec.cubierta.material} opts={matOpts} on={(v) => set((s) => { s.cubierta.material = v; })} />
                <Num label="Espesor" v={spec.cubierta.esp} u="mm" on={(v) => set((s) => { s.cubierta.esp = v; })} />
                <Num label="Voladizo" v={spec.cubierta.voladizo} u="mm" on={(v) => set((s) => { s.cubierta.voladizo = v; })} />
                <Num label="Alto de entrecalle" v={spec.cubierta.entrecalleAlto} u="mm" on={(v) => set((s) => { s.cubierta.entrecalleAlto = v; })} />
                {spec.cubierta.entrecalleAlto > 0 && (
                  <Sel label="Acabado de entrecalle" v={spec.cubierta.entrecalleAcabado} opts={acabOpts} on={(v) => set((s) => { s.cubierta.entrecalleAcabado = v; })} />
                )}
                <Chk
                  label="Se compra o subcontrata"
                  v={spec.cubierta.subcontrato}
                  on={(v) => set((s) => { s.cubierta.subcontrato = v; })}
                />
              </>
            )}
          </div>
        </section>
      </div>

      {/* Estructura interna */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[15px] font-medium">Division interna</h3>
          <button
            className="btn"
            onClick={() =>
              set((s) => {
                s.columnas.push(mkColumna(1, [mkCelda(1, "puerta_doble", 1)]));
              })
            }
          >
            Agregar columna
          </button>
        </div>

        <div className="space-y-3">
          {spec.columnas.map((col, ci) => (
            <div key={ci} className="card p-3">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="lbl">Columna {ci + 1}</span>
                <div className="flex items-center gap-1.5">
                  <label className="text-[12px] text-muted" htmlFor={`aw-${ci}`}>
                    Proporcion de ancho
                  </label>
                  <input
                    id={`aw-${ci}`}
                    type="number"
                    className="field w-[66px]"
                    step={0.1}
                    min={0.1}
                    value={col.anchoRel}
                    onChange={(e) =>
                      set((s) => {
                        s.columnas[ci].anchoRel = Math.max(0.1, Number(e.target.value) || 1);
                      })
                    }
                  />
                </div>
                <div className="ml-auto flex gap-1.5">
                  <button
                    className="btn"
                    onClick={() =>
                      set((s) => {
                        s.columnas[ci].celdas.push(mkCelda(1, "puerta_doble", 0));
                      })
                    }
                  >
                    Agregar celda
                  </button>
                  {spec.columnas.length > 1 && (
                    <button
                      className="btn"
                      onClick={() =>
                        set((s) => {
                          s.columnas.splice(ci, 1);
                        })
                      }
                    >
                      Quitar columna
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {col.celdas.map((cel, ri) => (
                  <div
                    key={ri}
                    className="flex flex-wrap items-center gap-2 pl-3 border-l-2 border-rule"
                  >
                    <span className="text-[12px] text-muted w-[74px]">
                      Celda {ri + 1}
                      {ri === 0 && " (abajo)"}
                    </span>
                    <select
                      aria-label={`Frente de la celda ${ri + 1}`}
                      className="px-2 py-1 rounded border border-rule bg-panel text-[12px] focus:outline-none focus:border-pine"
                      value={cel.frente}
                      onChange={(e) =>
                        set((s) => {
                          s.columnas[ci].celdas[ri].frente = e.target.value as FrenteTipo;
                        })
                      }
                    >
                      {FRENTES.map((f) => (
                        <option key={f.v} value={f.v}>
                          {f.t}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <label className="text-[12px] text-muted">Alto rel.</label>
                      <input
                        type="number"
                        aria-label={`Proporcion de alto de la celda ${ri + 1}`}
                        className="field w-[60px]"
                        step={0.1}
                        min={0.1}
                        value={cel.altoRel}
                        onChange={(e) =>
                          set((s) => {
                            s.columnas[ci].celdas[ri].altoRel = Math.max(
                              0.1,
                              Number(e.target.value) || 1
                            );
                          })
                        }
                      />
                    </div>
                    {cel.frente !== "cajon" && (
                      <div className="flex items-center gap-1">
                        <label className="text-[12px] text-muted">Repisas</label>
                        <input
                          type="number"
                          aria-label={`Repisas de la celda ${ri + 1}`}
                          className="field w-[54px]"
                          min={0}
                          max={8}
                          value={cel.repisas}
                          onChange={(e) =>
                            set((s) => {
                              s.columnas[ci].celdas[ri].repisas = Math.max(
                                0,
                                Math.min(8, Number(e.target.value) || 0)
                              );
                            })
                          }
                        />
                      </div>
                    )}
                    {col.celdas.length > 1 && (
                      <button
                        className="btn ml-auto"
                        onClick={() =>
                          set((s) => {
                            s.columnas[ci].celdas.splice(ri, 1);
                          })
                        }
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-muted mt-2">
          Las celdas se apilan de abajo hacia arriba. Las proporciones reparten el espacio
          disponible: dos celdas de 1 y 2 dan un tercio y dos tercios.
        </p>
      </section>

      {/* Materiales y construccion */}
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h3 className="text-[15px] font-medium mb-2">Materiales</h3>
          <div className="card p-3 space-y-3">
            <Sel label="Carcasa" v={spec.materiales.carcasa} opts={matOpts} on={(v) => set((s) => { s.materiales.carcasa = v; })} />
            <Sel label="Frentes" v={spec.materiales.frente} opts={matOpts} on={(v) => set((s) => { s.materiales.frente = v; })} />
            <Sel label="Fondo" v={spec.materiales.fondo} opts={matOpts} on={(v) => set((s) => { s.materiales.fondo = v; })} />
            <Sel label="Caja de cajon" v={spec.materiales.cajon} opts={matOpts} on={(v) => set((s) => { s.materiales.cajon = v; })} />
            <Sel label="Canto" v={spec.materiales.canto} opts={cantoOpts} on={(v) => set((s) => { s.materiales.canto = v; })} />
            <Sel label="Acabado de frentes" v={spec.materiales.acabadoFrente} opts={acabOpts} on={(v) => set((s) => { s.materiales.acabadoFrente = v; })} />
          </div>
        </section>

        <section>
          <h3 className="text-[15px] font-medium mb-2">Construccion y herrajes</h3>
          <div className="card p-3 space-y-3">
            <Num label="Espesor de tablero" v={spec.esp} u="mm" on={(v) => set((s) => { s.esp = v; })} />
            <Num label="Espesor de fondo" v={spec.espFondo} u="mm" on={(v) => set((s) => { s.espFondo = v; })} />
            <Num label="Holgura de frentes" v={spec.holgura} u="mm" step={0.5} on={(v) => set((s) => { s.holgura = v; })} />
            <Num label="Descuento por correderas" v={spec.holguraCorrederas} u="mm" on={(v) => set((s) => { s.holguraCorrederas = v; })} />
            <Chk label="Fondo ranurado" v={spec.fondoRanurado} on={(v) => set((s) => { s.fondoRanurado = v; })} />
            <Sel label="Bisagra" v={spec.herrajes.bisagra} opts={herrOpts} on={(v) => set((s) => { s.herrajes.bisagra = v; })} />
            <Sel label="Corredera" v={spec.herrajes.corredera} opts={herrOpts} on={(v) => set((s) => { s.herrajes.corredera = v; })} />
            <Sel label="Jaladera" v={spec.herrajes.jaladera} opts={herrOpts} on={(v) => set((s) => { s.herrajes.jaladera = v; })} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Num({
  label,
  v,
  u,
  step,
  on,
}: {
  label: string;
  v: number;
  u?: string;
  step?: number;
  on: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[13px]">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          aria-label={label}
          className="field w-[82px]"
          value={v}
          step={step ?? 1}
          onChange={(e) => on(Number(e.target.value) || 0)}
        />
        {u && <span className="text-[11px] text-muted w-[20px]">{u}</span>}
      </div>
    </div>
  );
}

function Sel({
  label,
  v,
  opts,
  on,
}: {
  label: string;
  v: string;
  opts: { v: string; t: string }[];
  on: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[13px] shrink-0">{label}</label>
      <select
        aria-label={label}
        className="px-2 py-1 rounded border border-rule bg-panel text-[12px] max-w-[190px] focus:outline-none focus:border-pine"
        value={v}
        onChange={(e) => on(e.target.value)}
      >
        {opts.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </select>
    </div>
  );
}

function Chk({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span className="text-[13px]">{label}</span>
      <input
        type="checkbox"
        className="w-4 h-4 accent-pine"
        checked={v}
        onChange={(e) => on(e.target.checked)}
      />
    </label>
  );
}

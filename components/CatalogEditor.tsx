"use client";

import type { Catalog } from "@/lib/types";

export default function CatalogEditor({
  catalog,
  onChange,
  onReset,
}: {
  catalog: Catalog;
  onChange: (c: Catalog) => void;
  onReset: () => void;
}) {
  const set = (fn: (c: Catalog) => void) => {
    const next: Catalog = JSON.parse(JSON.stringify(catalog));
    fn(next);
    onChange(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] text-muted max-w-xl">
          Estos precios son de ejemplo. Editalos con los tuyos: se guardan en este navegador. En
          produccion conviene moverlos a una base de datos con historial, para que una cotizacion
          emitida se pueda reproducir aunque los precios cambien.
        </p>
        <button className="btn shrink-0" onClick={onReset}>
          Restaurar ejemplo
        </button>
      </div>

      <section>
        <h3 className="text-[15px] font-medium mb-2">Materiales</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[720px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Material</th>
                <th className="lbl px-2 py-2 text-right font-medium">Hoja (mm)</th>
                <th className="lbl px-2 py-2 text-right font-medium">Precio</th>
                <th className="lbl px-2 py-2 font-medium">Por</th>
                <th className="lbl px-3 py-2 text-right font-medium">Aprovech. %</th>
              </tr>
            </thead>
            <tbody>
              {catalog.materiales.map((mat, i) => (
                <tr key={mat.sku} className="border-b border-rule/60 last:border-0">
                  <td className="px-3 py-1.5">
                    {mat.nombre}
                    <div className="num text-[11px] text-muted">{mat.sku}</div>
                  </td>
                  <td className="num px-2 py-1.5 text-right text-muted">
                    {mat.hojaAncho ? `${mat.hojaAncho} × ${mat.hojaLargo}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Precio de ${mat.nombre}`}
                      className="field w-[92px]"
                      value={mat.precio}
                      onChange={(e) =>
                        set((c) => {
                          c.materiales[i].precio = Number(e.target.value) || 0;
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 text-[12px] text-muted">{mat.precioPor}</td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      type="number"
                      aria-label={`Aprovechamiento de ${mat.nombre}`}
                      className="field w-[68px]"
                      value={Math.round(mat.aprovechamiento * 100)}
                      min={10}
                      max={100}
                      onChange={(e) =>
                        set((c) => {
                          c.materiales[i].aprovechamiento =
                            Math.min(100, Math.max(10, Number(e.target.value) || 75)) / 100;
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h3 className="text-[15px] font-medium mb-2">Cantos (por ml)</h3>
          <SimpleTable
            rows={catalog.cantos.map((c) => ({ nombre: c.nombre, valor: c.precioMl }))}
            onChange={(i, v) =>
              set((c) => {
                c.cantos[i].precioMl = v;
              })
            }
          />
        </section>

        <section>
          <h3 className="text-[15px] font-medium mb-2">Acabados (por m²)</h3>
          <SimpleTable
            rows={catalog.acabados.map((a) => ({ nombre: a.nombre, valor: a.precioM2 }))}
            onChange={(i, v) =>
              set((c) => {
                c.acabados[i].precioM2 = v;
              })
            }
          />
        </section>
      </div>

      <section>
        <h3 className="text-[15px] font-medium mb-2">Herrajes (por pieza)</h3>
        <SimpleTable
          rows={catalog.herrajes.map((h) => ({
            nombre: h.nombre,
            valor: h.precio,
            sub: h.proveedor,
          }))}
          onChange={(i, v) =>
            set((c) => {
              c.herrajes[i].precio = v;
            })
          }
        />
      </section>

      <section>
        <h3 className="text-[15px] font-medium mb-2">Mano de obra e indirectos</h3>
        <div className="card p-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <NumField
            label="Corte CNC por pieza"
            value={catalog.manoObra.cortePorPieza}
            onChange={(v) => set((c) => { c.manoObra.cortePorPieza = v; })}
          />
          <NumField
            label="Canto por ml"
            value={catalog.manoObra.cantoPorMl}
            onChange={(v) => set((c) => { c.manoObra.cantoPorMl = v; })}
          />
          <NumField
            label="Armado por modulo"
            value={catalog.manoObra.armadoPorModulo}
            onChange={(v) => set((c) => { c.manoObra.armadoPorModulo = v; })}
          />
          <NumField
            label="Instalacion herraje por pieza"
            value={catalog.manoObra.herrajePorPieza}
            onChange={(v) => set((c) => { c.manoObra.herrajePorPieza = v; })}
          />
          <NumField
            label="Overhead %"
            value={catalog.overheadPct}
            onChange={(v) => set((c) => { c.overheadPct = v; })}
          />
          <NumField
            label="Margen %"
            value={catalog.margenPct}
            onChange={(v) => set((c) => { c.margenPct = v; })}
          />
        </div>
      </section>
    </div>
  );
}

function SimpleTable({
  rows,
  onChange,
}: {
  rows: { nombre: string; valor: number; sub?: string }[];
  onChange: (i: number, v: number) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-rule/60 last:border-0">
              <td className="px-3 py-1.5">
                {r.nombre}
                {r.sub && <span className="ml-1.5 text-[11px] text-muted">{r.sub}</span>}
              </td>
              <td className="px-3 py-1.5 text-right w-[120px]">
                <input
                  type="number"
                  aria-label={`Precio de ${r.nombre}`}
                  className="field w-[92px]"
                  value={r.valor}
                  onChange={(e) => onChange(i, Number(e.target.value) || 0)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="lbl block mb-1">{label}</label>
      <input
        type="number"
        className="field"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

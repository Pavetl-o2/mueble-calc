"use client";

import type { CutRow } from "@/lib/costing";
import { partMaterialName } from "@/lib/costing";
import type { Catalog, ModelResult } from "@/lib/types";

const rutaStyle: Record<string, string> = {
  cnc: "bg-pineLight text-pine",
  subcontrato: "bg-bronzeLight text-bronze",
  compra: "bg-[#EDEFEA] text-muted",
};

const rutaLabel: Record<string, string> = {
  cnc: "CNC",
  subcontrato: "Subcontrato",
  compra: "Compra",
};

export default function PartsTable({
  rows,
  model,
  catalog,
}: {
  rows: CutRow[];
  model: ModelResult;
  catalog: Catalog;
}) {
  const totalPz = rows.reduce((a, r) => a + r.qty, 0);
  const totalM2 = rows.filter((r) => r.ruta === "cnc").reduce((a, r) => a + r.m2, 0);
  const totalMl = rows.reduce((a, r) => a + r.ml, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[15px] font-medium">Lista de corte</h3>
          <div className="num text-[12px] text-muted">
            {totalPz} pz · {totalM2.toFixed(3)} m² CNC · {totalMl.toFixed(2)} ml canto
          </div>
        </div>
        <div className="card overflow-x-auto">
          {/* El material va como sublinea de la pieza, no como columna: asi la
              tabla cabe en el panel lateral sin esconder la ruta. */}
          <table className="w-full text-[13px] min-w-[430px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Pieza</th>
                <th className="lbl px-2 py-2 text-right font-medium">Cant</th>
                <th className="lbl px-2 py-2 text-right font-medium">Largo</th>
                <th className="lbl px-2 py-2 text-right font-medium">Ancho</th>
                <th className="lbl px-2 py-2 text-right font-medium">Esp</th>
                <th className="lbl px-2 py-2 font-medium">Ruta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-rule/60 last:border-0 align-top">
                  <td className="px-3 py-1.5">
                    <div>
                      {r.grupo}
                      {r.acabado && (
                        <span className="ml-1.5 text-[11px] text-bronze">
                          + {catalog.acabados.find((a) => a.sku === r.acabado)?.nombre ?? r.acabado}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted">
                      {partMaterialName(r.material, catalog)}
                    </div>
                  </td>
                  <td className="num px-2 py-1.5 text-right">{r.qty}</td>
                  <td className="num px-2 py-1.5 text-right">{r.largo}</td>
                  <td className="num px-2 py-1.5 text-right">{r.ancho}</td>
                  <td className="num px-2 py-1.5 text-right text-muted">{r.espesor}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${rutaStyle[r.ruta]}`}
                    >
                      {rutaLabel[r.ruta]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-medium mb-2">Herrajes</h3>
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px] min-w-[380px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Herraje</th>
                <th className="lbl px-2 py-2 text-right font-medium">Cant</th>
                <th className="lbl px-3 py-2 font-medium">Derivado de</th>
              </tr>
            </thead>
            <tbody>
              {model.hardware.map((h) => (
                <tr key={h.sku} className="border-b border-rule/60 last:border-0">
                  <td className="px-3 py-1.5">
                    {catalog.herrajes.find((x) => x.sku === h.sku)?.nombre ?? h.sku}
                  </td>
                  <td className="num px-2 py-1.5 text-right">{h.qty}</td>
                  <td className="px-3 py-1.5 text-[12px] text-muted">{h.origen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Los herrajes se derivan de las reglas del metodo constructivo: bisagras por altura de
          puerta, correderas por cajon, pernos por repisa.
        </p>
      </div>
    </div>
  );
}

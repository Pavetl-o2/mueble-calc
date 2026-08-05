"use client";

import { money } from "@/lib/costing";
import type { Catalog, CostResult } from "@/lib/types";

const catLabel: Record<string, string> = {
  tablero: "Tablero",
  canto: "Canto",
  herraje: "Herrajes",
  acabado: "Acabados",
  subcontrato: "Subcontrato",
  mano_obra: "Mano de obra",
};

export default function CostPanel({
  cost,
  catalog,
  modulos,
}: {
  cost: CostResult;
  catalog: Catalog;
  modulos: number;
}) {
  const m = (v: number) => money(v, catalog.moneda);
  const cats = Object.entries(cost.porCategoria).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...cats.map(([, v]) => v), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 cq-cols-4 gap-3">
        <Stat label="Costo directo" value={m(cost.costoDirecto)} />
        <Stat label={`Overhead ${catalog.overheadPct}%`} value={m(cost.overhead)} />
        <Stat label={`Margen ${catalog.margenPct}%`} value={m(cost.margen)} />
        <Stat label="Precio de venta" value={m(cost.total)} accent />
      </div>

      {modulos > 1 && (
        <div className="text-[13px] text-muted">
          Por modulo:{" "}
          <span className="num text-ink font-medium">{m(cost.total / modulos)}</span> ·{" "}
          {modulos} modulos iguales
        </div>
      )}

      <div>
        <h3 className="text-[15px] font-medium mb-2">Distribucion del costo</h3>
        <div className="card p-3 space-y-2">
          {cats.map(([c, v]) => (
            <div key={c} className="flex items-center gap-3">
              <div className="w-[110px] text-[13px]">{catLabel[c] ?? c}</div>
              <div className="flex-1 h-3 bg-[#F0F2ED] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-pine rounded-sm"
                  style={{ width: `${(v / maxCat) * 100}%` }}
                />
              </div>
              <div className="num text-[13px] w-[92px] text-right">{m(v)}</div>
              <div className="num text-[11px] text-muted w-[42px] text-right">
                {((v / cost.costoDirecto) * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-medium mb-2">Desglose</h3>
        <div className="card overflow-x-auto">
          {/* La unidad va junto a la cantidad en vez de en su propia columna:
              asi el importe no se sale del panel lateral. */}
          <table className="w-full text-[13px] min-w-[400px]">
            <thead>
              <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                <th className="lbl px-3 py-2 font-medium">Concepto</th>
                <th className="lbl px-2 py-2 text-right font-medium">Cant</th>
                <th className="lbl px-2 py-2 text-right font-medium">P. unit</th>
                <th className="lbl px-3 py-2 text-right font-medium">Importe</th>
              </tr>
            </thead>
            <tbody>
              {cost.lineas.map((l, i) => (
                <tr key={i} className="border-b border-rule/60 last:border-0 align-top">
                  <td className="px-3 py-1.5">
                    <div>{l.concepto}</div>
                    {l.detalle && <div className="text-[11px] text-muted">{l.detalle}</div>}
                  </td>
                  <td className="num px-2 py-1.5 text-right whitespace-nowrap">
                    {fmtQty(l.cantidad)}
                    <span className="ml-1 text-[11px] text-muted">{l.unidad}</span>
                  </td>
                  <td className="num px-2 py-1.5 text-right text-muted">{m(l.precioUnit)}</td>
                  <td className="num px-3 py-1.5 text-right font-medium">{m(l.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {cost.materialUso.length > 0 && (
        <div>
          <h3 className="text-[15px] font-medium mb-2">Consumo de material</h3>
          <div className="card overflow-x-auto">
            <table className="w-full text-[13px] min-w-[440px]">
              <thead>
                <tr className="bg-[#F3F5F1] border-b border-rule text-left">
                  <th className="lbl px-3 py-2 font-medium">Material</th>
                  <th className="lbl px-2 py-2 text-right font-medium">m² neto</th>
                  <th className="lbl px-2 py-2 text-right font-medium">m² c/desperdicio</th>
                  <th className="lbl px-3 py-2 text-right font-medium">Hojas</th>
                </tr>
              </thead>
              <tbody>
                {cost.materialUso.map((u) => (
                  <tr key={u.sku} className="border-b border-rule/60 last:border-0">
                    <td className="px-3 py-1.5">{u.nombre}</td>
                    <td className="num px-2 py-1.5 text-right">{u.m2Neto.toFixed(3)}</td>
                    <td className="num px-2 py-1.5 text-right">{u.m2Bruto.toFixed(3)}</td>
                    <td className="num px-3 py-1.5 text-right">
                      {u.hojas > 0 ? u.hojas.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            El m² con desperdicio usa el factor de aprovechamiento del catalogo. Calibralo contra
            el consumo real que te reporte tu software de nesting.
          </p>
        </div>
      )}

      {cost.advertencias.length > 0 && (
        <div className="card border-bronze bg-bronzeLight p-3">
          <div className="lbl text-bronze mb-1">Revisar</div>
          <ul className="text-[13px] space-y-0.5 list-disc list-inside text-bronze">
            {cost.advertencias.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`card p-3 ${accent ? "border-pine bg-pineLight" : ""}`}>
      <div className="lbl">{label}</div>
      <div className={`num text-[19px] mt-0.5 ${accent ? "text-pine font-medium" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function fmtQty(v: number) {
  return v >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2);
}

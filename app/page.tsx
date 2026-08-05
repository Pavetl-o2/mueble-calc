"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SpecEditor from "@/components/SpecEditor";
import ImportPanel from "@/components/ImportPanel";
import PartsTable from "@/components/PartsTable";
import CostPanel from "@/components/CostPanel";
import CatalogEditor from "@/components/CatalogEditor";
import { defaultCatalog } from "@/lib/catalog";
import { costModel, cutList, money } from "@/lib/costing";
import { costCsv, cutListCsv, download, manifestJson, partsDxf } from "@/lib/exporters";
import { buildFurniture } from "@/lib/build";
import { getPreset, presets, type FurnitureSpec } from "@/lib/spec";
import type { Catalog } from "@/lib/types";

const Viewer3D = dynamic(() => import("@/components/Viewer3D"), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-[13px] text-muted">Cargando visor…</div>
  ),
});

const KEY_CAT = "mueble-calc.catalog.v2";
const KEY_SPEC = "mueble-calc.spec.v2";
type Tab = "importar" | "estructura" | "despiece" | "costo" | "catalogo";

export default function Page() {
  const [spec, setSpec] = useState<FurnitureSpec>(() => getPreset("base").make());
  const [catalog, setCatalog] = useState<Catalog>(defaultCatalog);
  const [modulos, setModulos] = useState(1);
  const [explode, setExplode] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("importar");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const c = localStorage.getItem(KEY_CAT);
      if (c) setCatalog(JSON.parse(c));
      const s = localStorage.getItem(KEY_SPEC);
      if (s) setSpec(JSON.parse(s));
    } catch {
      /* valores por defecto */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY_CAT, JSON.stringify(catalog));
      localStorage.setItem(KEY_SPEC, JSON.stringify(spec));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [catalog, spec, ready]);

  const model = useMemo(() => buildFurniture(spec), [spec]);
  const rows = useMemo(() => cutList(model, modulos), [model, modulos]);
  const cost = useMemo(() => costModel(model, catalog, modulos), [model, catalog, modulos]);
  const selPart = model.parts.find((p) => p.id === selected);

  function aplicarImport(s: FurnitureSpec) {
    setSpec(s);
    setSelected(null);
    setTab("estructura");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = `${spec.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.round(
    model.bbox.w
  )}x${Math.round(model.bbox.d)}x${Math.round(model.bbox.h)}`;

  return (
    <main className="min-h-screen">
      <header className="border-b border-rule bg-panel">
        <div className="max-w-[1500px] mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <h1 className="text-[17px] font-medium leading-tight">Despiece</h1>
            <p className="text-[12px] text-muted leading-tight">
              Del shop drawing al modelo paramétrico, la lista de corte y el costo
            </p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="lbl">Precio de venta</span>
            <span className="num text-[19px] font-medium text-pine">
              {money(cost.total, catalog.moneda)}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-[1500px] mx-auto px-4 py-4 grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
        <aside className="space-y-4">
          <div className="card p-3">
            <label className="lbl block mb-1.5" htmlFor="preset">
              Empezar desde
            </label>
            <select
              id="preset"
              className="w-full px-2 py-1.5 rounded border border-rule bg-panel text-[13px] focus:outline-none focus:border-pine"
              onChange={(e) => {
                if (!e.target.value) return;
                setSpec(getPreset(e.target.value).make());
                setSelected(null);
              }}
              value=""
            >
              <option value="">Elegir un preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <div className="mt-2">
              <label className="lbl block mb-1" htmlFor="nombre">
                Nombre
              </label>
              <input
                id="nombre"
                type="text"
                className="w-full px-2 py-1 rounded border border-rule bg-panel text-[13px] focus:outline-none focus:border-pine"
                value={spec.nombre}
                onChange={(e) => setSpec({ ...spec, nombre: e.target.value })}
              />
            </div>
          </div>

          <div className="card p-3">
            <div className="lbl mb-2">Resumen</div>
            <dl className="text-[13px] space-y-1">
              <Fila k="Envolvente" v={`${Math.round(model.bbox.w)} × ${Math.round(model.bbox.d)} × ${Math.round(model.bbox.h)} mm`} />
              <Fila k="Piezas" v={String(model.parts.length)} />
              <Fila k="Herrajes" v={String(model.hardware.reduce((a, h) => a + h.qty, 0))} />
              <Fila k="Costo directo" v={money(cost.costoDirecto, catalog.moneda)} />
            </dl>
            <div className="mt-3 pt-3 border-t border-rule flex items-baseline justify-between gap-2">
              <label htmlFor="modulos" className="text-[13px]">
                Modulos iguales
              </label>
              <input
                id="modulos"
                type="number"
                className="field w-[70px]"
                min={1}
                max={200}
                value={modulos}
                onChange={(e) => setModulos(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="card p-3">
            <div className="lbl mb-2">Exportar</div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn" onClick={() => download(`corte-${slug}-${stamp}.csv`, cutListCsv(rows, catalog), "text/csv")}>
                Lista de corte CSV
              </button>
              <button className="btn" onClick={() => download(`costo-${slug}-${stamp}.csv`, costCsv(cost, catalog), "text/csv")}>
                Costos CSV
              </button>
              <button className="btn" onClick={() => download(`manifiesto-${slug}-${stamp}.json`, manifestJson(spec.nombre, { ancho: spec.ancho, alto: spec.alto, prof: spec.prof }, model, cost, modulos), "application/json")}>
                Manifiesto JSON
              </button>
              <button className="btn" onClick={() => download(`piezas-${slug}-${stamp}.dxf`, partsDxf(model, modulos), "image/vnd.dxf")}>
                Piezas DXF
              </button>
            </div>
            <p className="text-[11px] text-muted mt-2">
              El DXF trae una polilinea cerrada por pieza, cada una en su capa. Es el puente hacia
              tu software de nesting.
            </p>
          </div>
        </aside>

        <section className="space-y-4 min-w-0">
          <div className="card overflow-hidden">
            <div className="h-[360px] md:h-[420px] relative">
              <Viewer3D model={model} explode={explode} selected={selected} onSelect={setSelected} />
              {selPart && (
                <div className="absolute right-3 top-3 bg-panel/92 border border-pine rounded-md px-2.5 py-1.5 max-w-[240px]">
                  <div className="text-[13px] font-medium">{selPart.nombre}</div>
                  <div className="num text-[12px] text-muted">
                    {[selPart.sx, selPart.sy, selPart.sz].sort((a, b) => b - a).map(Math.round).join(" × ")} mm
                  </div>
                </div>
              )}
              {model.warnings.length > 0 && (
                <div className="absolute left-3 bottom-3 bg-bronzeLight border border-bronze rounded-md px-2.5 py-1.5 max-w-[400px]">
                  <div className="text-[12px] text-bronze">{model.warnings[0]}</div>
                </div>
              )}
            </div>
            <div className="border-t border-rule px-3 py-2 flex items-center gap-3">
              <label htmlFor="explode" className="lbl shrink-0">Vista explotada</label>
              <input
                id="explode"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={explode}
                className="flex-1 h-1 cursor-pointer"
                onChange={(e) => setExplode(Number(e.target.value))}
              />
              <span className="text-[11px] text-muted shrink-0">Clic en una pieza para inspeccionarla</span>
            </div>
          </div>

          <div>
            <div className="flex gap-1 border-b border-rule mb-4 overflow-x-auto" role="tablist">
              {([
                ["importar", "Importar plano"],
                ["estructura", "Estructura"],
                ["despiece", "Despiece"],
                ["costo", "Costo"],
                ["catalogo", "Catalogo"],
              ] as [Tab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={`tab whitespace-nowrap ${tab === id ? "tab-active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "importar" && <ImportPanel spec={spec} onApply={aplicarImport} />}
            {tab === "estructura" && <SpecEditor spec={spec} catalog={catalog} onChange={setSpec} />}
            {tab === "despiece" && <PartsTable rows={rows} model={model} catalog={catalog} />}
            {tab === "costo" && <CostPanel cost={cost} catalog={catalog} modulos={modulos} />}
            {tab === "catalogo" && (
              <CatalogEditor catalog={catalog} onChange={setCatalog} onReset={() => setCatalog(defaultCatalog)} />
            )}
          </div>
        </section>
      </div>

      <footer className="max-w-[1500px] mx-auto px-4 py-6 text-[12px] text-muted">
        Los precios del catalogo son ejemplos. Sustituyelos por los tuyos antes de cotizar.
      </footer>
    </main>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  );
}

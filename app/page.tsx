"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SpecEditor from "@/components/SpecEditor";
import ImportPanel from "@/components/ImportPanel";
import PartsTable from "@/components/PartsTable";
import CostPanel from "@/components/CostPanel";
import CatalogEditor from "@/components/CatalogEditor";
import CncPanel, { type EstadoCnc } from "@/components/CncPanel";
import { aplicarAjuste, despieceCnc, proponerArmado } from "@/lib/cncArmado";
import { pisoDe, resolverArmado } from "@/lib/cncSolver";
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

const Viewer3DCnc = dynamic(() => import("@/components/CncViewer3D"), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-[13px] text-muted">Cargando visor…</div>
  ),
});

const KEY_CAT = "mueble-calc.catalog.v2";
const KEY_SPEC = "mueble-calc.spec.v2";
type Tab = "importar" | "estructura" | "cnc" | "despiece" | "costo" | "catalogo";

export default function Page() {
  const [spec, setSpec] = useState<FurnitureSpec>(() => getPreset("base").make());
  const [catalog, setCatalog] = useState<Catalog>(defaultCatalog);
  const [modulos, setModulos] = useState(1);
  const [explode, setExplode] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("importar");
  const [ready, setReady] = useState(false);
  // Cuando hay un corte CNC cargado, el despiece y el costo salen de el y
  // no del modelo parametrico. Son dos fuentes excluyentes a proposito.
  const [cnc, setCnc] = useState<EstadoCnc | null>(null);

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

  const model = useMemo(
    () => (cnc ? despieceCnc(cnc.lectura, cnc.asig, catalog) : buildFurniture(spec)),
    [cnc, spec, catalog]
  );
  // Primero se intenta resolver el mueble por sus juntas. Si el dibujo
  // trae con que -espigas, cajas, ranuras que emparejen-, el armado sale
  // de la geometria y no hay nada que adivinar. Solo cuando el archivo no
  // declara ninguna junta se cae a la propuesta por parametros.
  const armadura = useMemo(() => {
    if (!cnc?.armar) return null;
    const a = resolverArmado(cnc.lectura.piezas, cnc.asig.espesor);
    return a.uniones.length ? a : null;
  }, [cnc]);
  const armado = useMemo(() => {
    if (!cnc?.armar || armadura) return null;
    const a = proponerArmado(cnc.lectura, cnc.opciones);
    // Las correcciones del usuario se aplican encima de la propuesta, no
    // la reemplazan: si cambia el armado, los ajustes siguen valiendo.
    return { ...a, colocaciones: a.colocaciones.map((c) => aplicarAjuste(c, cnc.ajustes[c.piezaId])) };
  }, [cnc, armadura]);
  const pisoArmadura = useMemo(
    () => (armadura && cnc ? pisoDe(armadura, cnc.lectura.piezas, cnc.asig.espesor) : undefined),
    [armadura, cnc]
  );
  const rows = useMemo(() => cutList(model, modulos), [model, modulos]);
  const cost = useMemo(() => costModel(model, catalog, modulos), [model, catalog, modulos]);
  const selPart = model.parts.find((p) => p.id === selected);
  const selCnc = cnc?.lectura.piezas.find((p) => p.id === selected);

  function aplicarImport(s: FurnitureSpec) {
    setSpec(s);
    setCnc(null); // el modelo parametrico y el corte CNC son excluyentes
    setSelected(null);
    setTab("estructura");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const nombreActivo = cnc?.nombre || spec.nombre;
  const slug = `${nombreActivo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.round(
    model.bbox.w
  )}x${Math.round(model.bbox.d)}x${Math.round(model.bbox.h)}`;

  return (
    // En xl el espacio de trabajo ocupa exactamente la pantalla y cada columna
    // hace su propio scroll, para que el visor 3D quede siempre a la vista.
    // Debajo de xl se apila y la pagina scrollea normal.
    <main className="min-h-screen xl:h-screen xl:flex xl:flex-col xl:overflow-hidden">
      <header className="border-b border-rule bg-panel xl:shrink-0">
        <div className="max-w-[1800px] mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
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

      <div
        className="w-full max-w-[1800px] mx-auto px-4 py-4 grid gap-4 xl:flex-1 xl:min-h-0
                   lg:grid-cols-[300px_minmax(0,1fr)]
                   xl:grid-cols-[260px_minmax(0,1fr)_440px]
                   2xl:grid-cols-[280px_minmax(0,1fr)_560px]"
      >
        <aside className="space-y-4 min-w-0 lg:col-start-1 lg:row-start-1 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
          {cnc && (
            <div className="card border-pine bg-pineLight p-3">
              <div className="lbl text-pine mb-1">Corte CNC cargado</div>
              <p className="text-[12px] text-ink">
                El despiece y el costo salen de <span className="font-medium">{cnc.nombre}</span>,
                no del modelo parametrico.
              </p>
              <button className="btn mt-2" onClick={() => { setCnc(null); setSelected(null); }}>
                Volver al parametrico
              </button>
            </div>
          )}

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
                setCnc(null);
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

        <section className="min-w-0 flex flex-col lg:col-start-2 lg:row-start-1 xl:min-h-0">
          <div className="card overflow-hidden flex flex-col h-[380px] md:h-[440px] xl:h-auto xl:flex-1 xl:min-h-0">
            <div className="relative flex-1 min-h-0">
              {cnc ? (
                <Viewer3DCnc
                  piezas={cnc.lectura.piezas}
                  espesor={cnc.asig.espesor}
                  colocaciones={armado?.colocaciones}
                  armadura={armadura}
                  alturaPiso={pisoArmadura ?? armado?.alturaPiso}
                  selected={selected}
                  onSelect={setSelected}
                />
              ) : (
                <Viewer3D model={model} explode={explode} selected={selected} onSelect={setSelected} />
              )}
              {selCnc && (
                <div className="absolute right-3 top-3 bg-panel/92 border border-pine rounded-md px-2.5 py-1.5 max-w-[240px]">
                  <div className="text-[13px] font-medium">
                    {selCnc.huecos.length ? "Panel" : "Pieza"}
                  </div>
                  <div className="num text-[12px] text-muted">
                    {Math.round(selCnc.largo)} × {Math.round(selCnc.ancho)} mm ·{" "}
                    {(selCnc.areaMm2 / 1e6).toFixed(3)} m²
                  </div>
                </div>
              )}
              {!cnc && selPart && (
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
            <div className="shrink-0 border-t border-rule px-3 py-2 flex items-center gap-3">
              {cnc ? (
                <>
                  <span className="lbl shrink-0">
                    {armadura ? "Armado resuelto" : armado ? "Armado propuesto" : "Piezas planas"}
                  </span>
                  <span className="text-[11px] text-muted flex-1 min-w-0 truncate">
                    {armadura
                      ? `${armadura.instancias.length} pieza(s) colocadas por ${armadura.uniones.length} junta(s)` +
                        (armadura.sueltas.length ? ` · ${armadura.sueltas.length} suelta(s)` : "")
                      : armado
                      ? `${armado.familia} · confianza ${armado.confianza} · hipotesis, no fabricacion`
                      : "Piezas como vienen en la hoja de corte"}
                  </span>
                </>
              ) : (
                <>
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
                </>
              )}
              <span className="text-[11px] text-muted shrink-0">Clic en una pieza para inspeccionarla</span>
            </div>
          </div>
        </section>

        <aside className="min-w-0 flex flex-col lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0">
          <div className="flex gap-1 border-b border-rule shrink-0 overflow-x-auto" role="tablist">
            {([
              ["importar", "Importar"],
              ["estructura", "Estructura"],
              ["cnc", "CNC"],
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

          {/* .cq marca este bloque como contenedor: los paneles se adaptan al
              ancho de la columna, no al del viewport. */}
          <div className="cq flex-1 min-w-0 pt-4 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
            {tab === "importar" && <ImportPanel spec={spec} onApply={aplicarImport} />}
            {tab === "estructura" && <SpecEditor spec={spec} catalog={catalog} onChange={setSpec} />}
            {tab === "cnc" && (
              <CncPanel
                catalog={catalog}
                estado={cnc}
                onEstado={(e) => {
                  // La seleccion solo se pierde al cambiar de archivo. Si se
                  // limpiara en cada cambio de estado, mover un control de
                  // ajuste deseleccionaria la pieza que se esta ajustando.
                  if (!e || e.lectura !== cnc?.lectura) setSelected(null);
                  setCnc(e);
                }}
                selected={selected}
                onSelect={setSelected}
              />
            )}
            {tab === "despiece" && <PartsTable rows={rows} model={model} catalog={catalog} />}
            {tab === "costo" && <CostPanel cost={cost} catalog={catalog} modulos={modulos} />}
            {tab === "catalogo" && (
              <CatalogEditor catalog={catalog} onChange={setCatalog} onReset={() => setCatalog(defaultCatalog)} />
            )}
          </div>
        </aside>
      </div>

      <footer className="max-w-[1800px] w-full mx-auto px-4 py-6 xl:py-2 text-[12px] text-muted xl:shrink-0">
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

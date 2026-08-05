"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Edges } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ContornoCnc } from "@/lib/cnc";
import type { Colocacion } from "@/lib/cncArmado";

// ---------------------------------------------------------------
// Visor de piezas de corte.
//
// A diferencia del visor parametrico, aqui las piezas no son cajas:
// son contornos libres con huecos. Se construyen con THREE.Shape y se
// extruyen por el espesor.
//
// Cada contorno se centra en su propio bbox, de modo que la colocacion
// que calcula lib/cncArmado solo tiene que decir donde va ese centro.
// ---------------------------------------------------------------

/**
 * El contorno viene cerrado, con el ultimo punto repitiendo el primero.
 * Si se le pasa asi a THREE.Shape queda una arista de longitud cero que
 * rompe la triangulacion: la pieza sale sin caras, solo con el canto.
 * Aqui se quita ese punto y se normaliza el sentido de giro, que es lo
 * que espera el recortador de huecos.
 */
function limpiar(pts: THREE.Vector2[], horario: boolean): THREE.Vector2[] {
  const out = pts.slice();
  while (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-6) out.pop();
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0 !== horario) out.reverse();
  return out;
}

/**
 * Se extruye siempre a espesor 1 y el espesor real se aplica escalando en
 * Z. Asi mover el control de espesor no reconstruye nada: antes cada
 * cambio generaba geometrias nuevas para todas las piezas, y aunque se
 * liberen, el churn acaba tirando el contexto de WebGL.
 */
function geometriaDe(c: ContornoCnc): THREE.ExtrudeGeometry {
  const cx = (c.bbox.x0 + c.bbox.x1) / 2;
  const cy = (c.bbox.y0 + c.bbox.y1) / 2;
  const v = (p: [number, number]) => new THREE.Vector2(p[0] - cx, p[1] - cy);

  // Exterior antihorario, huecos horarios.
  const shape = new THREE.Shape(limpiar(c.ext.map(v), false));
  for (const h of c.huecos) {
    shape.holes.push(new THREE.Path(limpiar(h.map(v), true)));
  }

  // OJO con el bisel: en three r175, ExtrudeGeometry con bevelEnabled:false
  // NO genera las tapas. Solo llena contractedContourVertices dentro del
  // bucle de biseles, y ese bucle no corre cuando bevelSegments es 0, asi
  // que la triangulacion recibe una lista vacia y la pieza sale hueca:
  // se ve una cinta con la silueta y se transparenta.
  // Un bisel de tamano cero hace correr el bucle una vez y devuelve las
  // tapas, con una geometria identica a la extrusion recta.
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSize: 0,
    bevelThickness: 0,
    bevelOffset: 0,
    bevelSegments: 1,
  });
  // La extrusion crece hacia +Z; se recentra para que al escalar el
  // espesor quede repartido a ambos lados del plano de la pieza.
  g.translate(0, 0, -0.5);
  return g;
}

function Malla({
  contorno,
  espesor,
  seleccionada,
  onSelect,
}: {
  contorno: ContornoCnc;
  espesor: number;
  seleccionada: boolean;
  onSelect: (id: string | null) => void;
}) {
  const geo = useMemo(() => geometriaDe(contorno), [contorno]);

  // Al cambiar de archivo se generan geometrias nuevas. Sin liberar las
  // viejas se acumulan en la GPU y acaban tirando el contexto de WebGL
  // ("Context Lost"), que deja el visor congelado.
  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <mesh
      geometry={geo}
      scale={[1, 1, espesor]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(seleccionada ? null : contorno.id);
      }}
    >
      <meshStandardMaterial
        color={seleccionada ? "#0F5C4B" : contorno.huecos.length ? "#E3D4B8" : "#D9C7A7"}
        roughness={0.72}
        metalness={0.03}
        side={THREE.DoubleSide}
      />
      <Edges threshold={25} color={seleccionada ? "#0F5C4B" : "#8E9489"} />
    </mesh>
  );
}

/**
 * Compone la colocacion con grupos anidados en vez de angulos de Euler:
 * el orden queda explicito y no depende de la convencion que use three.
 * De adentro hacia afuera: se para la pieza, se gira un cuarto sobre su
 * propio eje para que su lado largo quede TANGENTE (si no, la pieza se
 * mete radialmente y cruza por el centro del mueble), se separa al radio
 * y por ultimo se gira a su posicion alrededor del eje vertical.
 */
function PiezaColocada({
  contorno,
  espesor,
  colocacion,
  seleccionada,
  onSelect,
}: {
  contorno: ContornoCnc;
  espesor: number;
  colocacion: Colocacion;
  seleccionada: boolean;
  onSelect: (id: string | null) => void;
}) {
  const c = colocacion;
  const malla = (
    <Malla
      contorno={contorno}
      espesor={espesor}
      seleccionada={seleccionada}
      onSelect={onSelect}
    />
  );

  if (c.acostada) {
    return <group position={[0, 0, c.z]}>{malla}</group>;
  }

  return (
    <group rotation={[0, 0, c.giro]}>
      <group position={[c.radio, 0, c.z]}>
        <group rotation={[0, 0, Math.PI / 2]}>
          {/* +inclinacion abre la pieza hacia afuera por abajo, que es como
              se dibujan las patas conicas. Con signo negativo se cerrarian
              en X, apoyando hacia el centro. */}
          <group rotation={[Math.PI / 2 + c.inclinacion, 0, 0]}>{malla}</group>
        </group>
      </group>
    </group>
  );
}

export default function CncViewer3D({
  piezas,
  espesor,
  colocaciones,
  selected,
  onSelect,
}: {
  piezas: ContornoCnc[];
  espesor: number;
  /** Sin colocaciones se muestran acostadas como en la hoja de corte. */
  colocaciones?: Colocacion[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const armado = !!colocaciones?.length;

  const porId = useMemo(() => {
    const m = new Map<string, Colocacion>();
    for (const c of colocaciones ?? []) m.set(c.piezaId, c);
    return m;
  }, [colocaciones]);

  // Encuadre: se mide la escena que realmente se va a ver, en vez de
  // suponerla. Armada, manda el alto y el radio; plana, el tamano de la hoja.
  const vista = useMemo(() => {
    const xs = piezas.flatMap((p) => [p.bbox.x0, p.bbox.x1]);
    const ys = piezas.flatMap((p) => [p.bbox.y0, p.bbox.y1]);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

    if (!armado) {
      const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 1000;
      const h = ys.length ? Math.max(...ys) - Math.min(...ys) : 1000;
      return { cx, cy, alturaOjo: 0, extension: Math.max(w, h, 200) };
    }

    const alto = Math.max(...(colocaciones ?? []).map((c) => c.z), 1);
    const radio = Math.max(...(colocaciones ?? []).map((c) => c.radio), 1);
    const ancho = Math.max(...piezas.map((p) => p.largo), 1);
    return {
      cx: 0,
      cy: 0,
      alturaOjo: alto / 2,
      extension: Math.max(ancho, radio * 2, alto),
    };
  }, [piezas, colocaciones, armado]);

  const dist = Math.max(400, vista.extension * 1.9);

  // El navegador puede tirar el contexto de WebGL por su cuenta (cambio de
  // GPU, suspension, demasiados canvas). Sin avisar, el visor se queda
  // congelado y parece que la app se rompio.
  const [contextoPerdido, setContextoPerdido] = useState(false);

  if (contextoPerdido) {
    return (
      <div className="h-full grid place-items-center p-6 text-center">
        <div>
          <p className="text-[13px] text-ink">Se perdio el contexto 3D del navegador.</p>
          <p className="text-[12px] text-muted mt-1">
            Recarga la pagina para volver a dibujar. El despiece y el costo no se ven afectados.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Canvas
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          setContextoPerdido(true);
        });
      }}
      shadows={false}
      dpr={[1, 2]}
      // near y far ajustados al tamano de la escena. Con el rango por
      // defecto (0.1 a 200000) el buffer de profundidad pierde precision y
      // las piezas se atraviesan entre si: la cubierta se ve transparente.
      camera={{
        position: [dist * 0.7, dist * 0.55, dist * 0.85],
        fov: 35,
        near: Math.max(1, vista.extension / 100),
        far: vista.extension * 40,
      }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#E7EAE5"]} />
      <Suspense fallback={null}>
        <hemisphereLight intensity={0.85} groundColor="#B9BEB4" />
        <directionalLight position={[dist, dist * 1.6, dist * 0.8]} intensity={1.5} />
        <directionalLight position={[-dist, dist * 0.6, -dist]} intensity={0.5} />

        {/* CAD usa Z arriba y three.js usa Y arriba. Este giro convierte el
            mundo entero de una vez, para que las colocaciones se puedan
            escribir en coordenadas CAD sin traducir cada rotacion. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {piezas.map((p) => {
            const col = porId.get(p.id);
            if (col) {
              return (
                <PiezaColocada
                  key={p.id}
                  contorno={p}
                  espesor={espesor}
                  colocacion={col}
                  seleccionada={selected === p.id}
                  onSelect={onSelect}
                />
              );
            }
            // Sin armado cada pieza se queda donde venia en la hoja de corte.
            return (
              <group
                key={p.id}
                position={[
                  (p.bbox.x0 + p.bbox.x1) / 2 - vista.cx,
                  (p.bbox.y0 + p.bbox.y1) / 2 - vista.cy,
                  0,
                ]}
              >
                <Malla
                  contorno={p}
                  espesor={espesor}
                  seleccionada={selected === p.id}
                  onSelect={onSelect}
                />
              </group>
            );
          })}
        </group>

        <Grid
          position={[0, -espesor, 0]}
          args={[vista.extension * 6, vista.extension * 6]}
          cellSize={100}
          cellThickness={0.5}
          cellColor="#C4C9BF"
          sectionSize={500}
          sectionThickness={1}
          sectionColor="#A8AEA2"
          fadeDistance={vista.extension * 10}
          infiniteGrid
        />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={vista.extension * 0.25}
          maxDistance={vista.extension * 12}
          target={[0, vista.alturaOjo, 0]}
        />
      </Suspense>
    </Canvas>
  );
}

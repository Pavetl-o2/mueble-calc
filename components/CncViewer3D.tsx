"use client";

import { Canvas } from "@react-three/fiber";
import { Edges, GizmoHelper, GizmoViewcube, Grid, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { ContornoCnc } from "@/lib/cnc";
import type { Colocacion } from "@/lib/cncArmado";
import { alMundo, type Armadura, type Pose } from "@/lib/cncSolver";

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
/**
 * Origen local de la geometria:
 *   - acostada: el centro del contorno, para el panel.
 *   - parada: el medio de su CANTO SUPERIOR, que es el que topa con el
 *     panel y ademas hace de eje al inclinar la pieza. Asi basta con
 *     decir donde va ese punto y la pieza cuelga sola.
 *
 * La orientacion de armado se hornea aqui, en los puntos, en vez de
 * componerla como otra rotacion mas: mantiene el arbol de grupos corto y
 * evita depender del orden en que se apliquen.
 */
interface Orient {
  giroLocal: number;
  espejo: boolean;
  /** true = origen en el medio del canto superior; false = en el centro. */
  colgante: boolean;
}

function geometriaDe(c: ContornoCnc, o?: Orient): THREE.ExtrudeGeometry {
  let ext = c.ext;
  let huecos = c.huecos;

  if (o) {
    const ca = Math.cos(o.giroLocal);
    const sa = Math.sin(o.giroLocal);
    const s = o.espejo ? -1 : 1;
    const tr = (pts: [number, number][]): [number, number][] =>
      pts.map(([x, y]) => [s * (x * ca - y * sa), x * sa + y * ca]);
    ext = tr(ext);
    huecos = huecos.map(tr);
  }

  const xs = ext.map((p) => p[0]);
  const ys = ext.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  // Parada: el origen queda en el canto de arriba. Acostada: en el centro.
  const cy = o?.colgante ? Math.max(...ys) : (Math.min(...ys) + Math.max(...ys)) / 2;
  const v = (p: [number, number]) => new THREE.Vector2(p[0] - cx, p[1] - cy);

  // Exterior antihorario, huecos horarios. limpiar() normaliza el sentido,
  // que hace falta porque reflejar la pieza lo invierte.
  const shape = new THREE.Shape(limpiar(ext.map(v), false));
  for (const h of huecos) {
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
  orientacion,
  seleccionada,
  onSelect,
}: {
  contorno: ContornoCnc;
  espesor: number;
  orientacion?: Orient;
  seleccionada: boolean;
  onSelect: (id: string | null) => void;
}) {
  const geo = useMemo(
    () => geometriaDe(contorno, orientacion),
    [contorno, orientacion?.giroLocal, orientacion?.espejo, orientacion?.colgante]
  );

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
 *
 * De adentro hacia afuera: la pieza ya viene orientada y con su origen en
 * el canto superior, se para (y se inclina) girando sobre ese canto, se
 * gira un cuarto para que su lado largo quede TANGENTE (si no se mete
 * radialmente y cruza el centro del mueble), se separa al radio y por
 * ultimo se lleva a su posicion alrededor del eje vertical.
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
      orientacion={{ giroLocal: c.giroLocal, espejo: c.espejo, colgante: !c.acostada }}
      seleccionada={seleccionada}
      onSelect={onSelect}
    />
  );

  // El mismo arbol para todas: el panel tambien se puede girar y correr,
  // solo que no se para. Antes tenia una rama aparte que ignoraba sus
  // ajustes, asi que seleccionarlo no servia de nada.
  return (
    <group rotation={[0, 0, c.giro]}>
      {/* desliz corre a lo largo del propio eje de la pieza (la tangente),
          que es lo que alinea su espiga con la mortaja. */}
      <group position={[c.radio, c.desliz, c.z]}>
        {c.acostada ? (
          malla
        ) : (
          <group rotation={[0, 0, Math.PI / 2]}>
            {/* +inclinacion abre la pieza hacia afuera por abajo. Con signo
                negativo se cerraria en X, apoyando hacia el centro. */}
            <group rotation={[Math.PI / 2 + c.inclinacion, 0, 0]}>{malla}</group>
          </group>
        )}
      </group>
    </group>
  );
}

/**
 * Pieza colocada por el solver de juntas.
 *
 * Aqui no hay radio ni giro que componer: la pose ya es una base
 * completa, asi que se pasa como matriz y three no tiene que
 * interpretar nada. Y como el solver trabaja con Y hacia arriba -que es
 * el convenio de three, no el de CAD-, estas piezas van FUERA del giro
 * global que endereza la hoja de corte.
 */
function PiezaResuelta({
  contorno,
  espesor,
  pose,
  seleccionada,
  onSelect,
}: {
  contorno: ContornoCnc;
  espesor: number;
  pose: Pose;
  seleccionada: boolean;
  onSelect: (id: string | null) => void;
}) {
  const m = useMemo(() => {
    const u = new THREE.Vector3(...pose.u);
    const v = new THREE.Vector3(...pose.v);
    const w = new THREE.Vector3(...pose.w).normalize();
    // La geometria viene centrada en la caja de la pieza, asi que el
    // origen del grupo es la imagen de ese centro y no la del (0,0).
    const cx = (contorno.bbox.x0 + contorno.bbox.x1) / 2;
    const cy = (contorno.bbox.y0 + contorno.bbox.y1) / 2;
    const pos = new THREE.Vector3(...pose.o)
      .addScaledVector(u, cx)
      .addScaledVector(v, cy);
    return new THREE.Matrix4().makeBasis(u, v, w).setPosition(pos);
  }, [pose, contorno]);

  return (
    <group matrixAutoUpdate={false} matrix={m}>
      <Malla
        contorno={contorno}
        espesor={espesor}
        seleccionada={seleccionada}
        onSelect={onSelect}
      />
    </group>
  );
}

export default function CncViewer3D({
  piezas,
  espesor,
  colocaciones,
  armadura,
  alturaPiso,
  selected,
  onSelect,
}: {
  piezas: ContornoCnc[];
  espesor: number;
  /** Sin colocaciones se muestran acostadas como en la hoja de corte. */
  colocaciones?: Colocacion[];
  /** Armado resuelto por juntas. Si viene, manda sobre `colocaciones`. */
  armadura?: Armadura | null;
  /** Cota donde apoya el mueble. El piso se dibuja ahi. */
  alturaPiso?: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const armado = !!colocaciones?.length || !!armadura?.instancias.length;

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

    // Con el armado resuelto la escena se mide de verdad, recorriendo
    // los contornos ya colocados, en vez de deducirla de un radio y un
    // alto que aqui ya no existen.
    if (armadura?.instancias.length) {
      const mapa = new Map(piezas.map((p) => [p.id, p]));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const inst of armadura.instancias) {
        const c = mapa.get(inst.piezaId);
        if (!c) continue;
        for (let k = 0; k < c.ext.length; k += 3) {
          const w = alMundo(inst.pose, c.ext[k]);
          x0 = Math.min(x0, w[0]); x1 = Math.max(x1, w[0]);
          y0 = Math.min(y0, w[1]); y1 = Math.max(y1, w[1]);
          z0 = Math.min(z0, w[2]); z1 = Math.max(z1, w[2]);
        }
      }
      if (Number.isFinite(x0)) {
        const w = x1 - x0;
        const h = y1 - y0;
        const d = z1 - z0;
        return {
          cx: 0,
          cy: 0,
          alturaOjo: (y0 + y1) / 2,
          extension: Math.max(w, h, d, 200),
          piso: Math.max(w, d, 500),
        };
      }
    }

    if (!armado) {
      const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 1000;
      const h = ys.length ? Math.max(...ys) - Math.min(...ys) : 1000;
      return { cx, cy, alturaOjo: 0, extension: Math.max(w, h, 200), piso: Math.max(w, h, 200) };
    }

    const alto = Math.max(...(colocaciones ?? []).map((c) => c.z), 1);
    const radio = Math.max(...(colocaciones ?? []).map((c) => c.radio), 1);
    const ancho = Math.max(...piezas.map((p) => p.largo), 1);
    return {
      cx: 0,
      cy: 0,
      alturaOjo: (alto + (alturaPiso ?? 0)) / 2,
      extension: Math.max(ancho, radio * 2, alto),
      // El piso NO se escala con los controles: si su tamano y su
      // desvanecido cambiaran al mover el alto, pareceria que el suelo se
      // mueve bajo el mueble. Se fija al tamano de las piezas, que no cambia.
      piso: Math.max(ancho, 500),
    };
  }, [piezas, colocaciones, armado, armadura, alturaPiso]);

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

        {/* Armado por juntas: la pose ya viene con Y arriba, asi que no
            pasa por el giro de CAD. */}
        {armadura?.instancias.map((inst) => {
          const c = piezas.find((p) => p.id === inst.piezaId);
          if (!c) return null;
          return (
            <PiezaResuelta
              key={inst.id}
              contorno={c}
              espesor={espesor}
              pose={inst.pose}
              seleccionada={selected === inst.piezaId}
              onSelect={onSelect}
            />
          );
        })}

        {/* Las que no cerraron con nada se dejan tendidas en el piso, al
            lado del mueble. Se ven, se pueden picar y se distinguen de un
            golpe de vista de las que si se resolvieron: mejor eso que
            colocarlas donde no consta que vayan. */}
        {armadura?.sueltas.map((id, k) => {
          const c = piezas.find((p) => p.id === id);
          if (!c) return null;
          return (
            <group
              key={`suelta-${id}`}
              position={[vista.extension * (0.75 + k * 0.55), alturaPiso ?? 0, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <Malla
                contorno={c}
                espesor={espesor}
                seleccionada={selected === id}
                onSelect={onSelect}
              />
            </group>
          );
        })}

        {/* CAD usa Z arriba y three.js usa Y arriba. Este giro convierte el
            mundo entero de una vez, para que las colocaciones se puedan
            escribir en coordenadas CAD sin traducir cada rotacion. */}
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {armadura?.instancias.length
            ? null
            : piezas.map((p) => {
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
                // Sin armado cada pieza se queda donde venia en la hoja.
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

        {/* El piso va donde apoya el mueble, no a una altura fija: al mover
            el alto, un suelo fijo hace que el mueble se hunda o flote.
            followCamera queda apagado a proposito, que es lo que hace que
            la rejilla se deslice al orbitar. */}
        <Grid
          position={[0, (alturaPiso ?? -espesor) - 1, 0]}
          args={[vista.piso * 4, vista.piso * 4]}
          cellSize={100}
          cellThickness={0.6}
          cellColor="#C4C9BF"
          sectionSize={500}
          sectionThickness={1.2}
          sectionColor="#A8AEA2"
          fadeDistance={vista.piso * 8}
          fadeStrength={1.5}
          followCamera={false}
          infiniteGrid
        />

        {/* Cubo de vistas: al picar una cara la camara se va a ella, como en
            Fusion o Blender. Los nombres van en ejes de CAD, no de three. */}
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewcube
            faces={["Derecha", "Izquierda", "Arriba", "Abajo", "Frente", "Atras"]}
            color="#F3F5F1"
            hoverColor="#E3EFEA"
            textColor="#171A17"
            strokeColor="#8E9489"
          />
        </GizmoHelper>

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

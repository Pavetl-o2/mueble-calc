"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Edges } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import type { ModelResult, Part } from "@/lib/types";

// CAD usa Z arriba; three.js usa Y arriba. Aqui se hace el cambio de ejes.
function PartMesh({
  part,
  center,
  explode,
  selected,
  onSelect,
}: {
  part: Part;
  center: [number, number, number];
  explode: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const cx = part.px + part.sx / 2 - center[0];
  const cy = part.pz + part.sz / 2 - center[2];
  const cz = part.py + part.sy / 2 - center[1];

  const k = explode;
  const pos: [number, number, number] = [cx * (1 + k), cy * (1 + k * 0.6), cz * (1 + k)];

  const isSel = selected === part.id;
  const dim = selected !== null && !isSel;

  return (
    <mesh
      position={pos}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(isSel ? null : part.id);
      }}
    >
      <boxGeometry args={[part.sx, part.sz, part.sy]} />
      <meshStandardMaterial
        color={isSel ? "#0F5C4B" : part.color}
        roughness={0.72}
        metalness={0.03}
        transparent={dim}
        opacity={dim ? 0.28 : 1}
      />
      <Edges threshold={20} color={isSel ? "#0F5C4B" : "#8E9489"} />
    </mesh>
  );
}

export default function Viewer3D({
  model,
  explode,
  selected,
  onSelect,
}: {
  model: ModelResult;
  explode: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { center, radius } = useMemo(() => {
    const b = model.bbox;
    return {
      center: [b.w / 2, b.d / 2, b.h / 2] as [number, number, number],
      radius: Math.max(b.w, b.d, b.h) || 800,
    };
  }, [model.bbox]);

  const camDist = radius * 2.1;

  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      camera={{ position: [camDist * 0.75, camDist * 0.6, camDist * 0.9], fov: 35, far: 40000 }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#E7EAE5"]} />
      <Suspense fallback={null}>
        <hemisphereLight intensity={0.85} groundColor="#B9BEB4" />
        <directionalLight position={[radius, radius * 1.6, radius * 0.8]} intensity={1.5} />
        <directionalLight position={[-radius, radius * 0.6, -radius]} intensity={0.5} />

        <group>
          {model.parts.map((p) => (
            <PartMesh
              key={p.id}
              part={p}
              center={center}
              explode={explode}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </group>

        <Grid
          position={[0, -radius / 2 - 2, 0]}
          args={[radius * 6, radius * 6]}
          cellSize={100}
          cellThickness={0.5}
          cellColor="#C4C9BF"
          sectionSize={500}
          sectionThickness={1}
          sectionColor="#A8AEA2"
          fadeDistance={radius * 9}
          infiniteGrid
        />

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          minDistance={radius * 0.5}
          maxDistance={radius * 8}
          target={[0, 0, 0]}
        />
      </Suspense>
    </Canvas>
  );
}

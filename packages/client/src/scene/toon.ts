import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Three-step gradient gives the flat, banded toon look from the GDD.
let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = new Uint8Array([125, 195, 255]);
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMaterial(
  color: THREE.ColorRepresentation = 0xffffff,
  opts: { vertexColors?: boolean } = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), vertexColors: opts.vertexColors ?? false });
}

const outlineCache = new Map<number, THREE.MeshBasicMaterial>();

/**
 * Inverted-hull outline: back faces pushed out along smoothed normals by a fixed width.
 * Unlike scaling the mesh, the line stays even on tall buildings. Cheaper than a post pass on phones.
 */
export function outlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  const cached = outlineCache.get(thickness);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({ color: 0x283130, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed += normal * ${thickness.toFixed(4)};`,
    );
  };
  m.customProgramCacheKey = () => `outline-${thickness}`;
  outlineCache.set(thickness, m);
  return m;
}

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Welds vertices and averages normals so the pushed-out hull has no gaps at hard corners. */
export function hullGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = hullCache.get(source);
  if (cached) return cached;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', source.getAttribute('position'));
  if (source.index) g.setIndex(source.index);
  const welded = mergeVertices(g, 1e-3);
  welded.computeVertexNormals();
  hullCache.set(source, welded);
  return welded;
}

export function withOutline<T extends THREE.Mesh>(mesh: T, thickness = 0.04): T {
  const hull = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(thickness));
  hull.userData.hull = true;
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

export function toonMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Mesh {
  return withOutline(new THREE.Mesh(geometry, toonMaterial(color)));
}

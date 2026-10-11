import * as THREE from 'three';

// Three-step gradient gives the flat, banded toon look from the GDD.
let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = new Uint8Array([90, 170, 255]);
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMaterial(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() });
}

const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2420, side: THREE.BackSide });

/**
 * Inverted-hull outline: a slightly larger back-face copy behind the mesh.
 * Cheaper than a post-processing outline pass, which matters on mid-range phones.
 */
export function withOutline(mesh: THREE.Mesh, thickness = 0.04): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial);
  hull.scale.setScalar(1 + thickness);
  hull.raycast = () => {};
  mesh.add(hull);
  return mesh;
}

export function toonMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Mesh {
  return withOutline(new THREE.Mesh(geometry, toonMaterial(color)));
}

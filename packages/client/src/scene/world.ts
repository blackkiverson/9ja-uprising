import * as THREE from 'three';
import type { LocationId } from '@9ja/shared';
import { toonMesh } from './toon';

export interface Place {
  id: LocationId;
  label: string;
  /** Where the player stands to interact. */
  door: THREE.Vector3;
}

// Greybox Surulere block. Placeholder geometry until Blender GLBs replace it.
const BUILDINGS: { id: LocationId; label: string; x: number; z: number; w: number; d: number; h: number; color: number }[] = [
  { id: 'home', label: 'Home (face-me-I-face-you)', x: -12, z: -6, w: 8, d: 6, h: 4, color: 0x9ccfb0 },
  { id: 'food_stall', label: "Mama Put's food stall", x: 2, z: -10, w: 4, d: 3, h: 3, color: 0xf2a65a },
  { id: 'office', label: 'Office (Bode Thomas St)', x: 14, z: 6, w: 9, d: 7, h: 9, color: 0x9fc5c8 },
  { id: 'bus_stop', label: 'Bus stop (danfo park)', x: -4, z: 10, w: 5, d: 2, h: 2.5, color: 0xf5d547 },
];

export function buildWorld(scene: THREE.Scene): { ground: THREE.Mesh; places: Place[] } {
  scene.background = new THREE.Color(0xf3e6c8);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0xb59a7a, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshToonMaterial({ color: 0xc8a878 }));
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(80, 5), new THREE.MeshToonMaterial({ color: 0x6d6560 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, 4);
  road.raycast = () => {};
  scene.add(road);

  const places: Place[] = BUILDINGS.map((b) => {
    const mesh = toonMesh(new THREE.BoxGeometry(b.w, b.h, b.d), b.color);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.userData.occluder = true;
    scene.add(mesh);
    // Door sits on the side of the building that faces the road (z = 4).
    const doorZ = b.z < 4 ? b.z + b.d / 2 + 1 : b.z - b.d / 2 - 1;
    return { id: b.id, label: b.label, door: new THREE.Vector3(b.x, 0, doorZ) };
  });

  // A few palms for scale and mood.
  for (const [x, z] of [[-20, 2], [6, -4], [22, -2], [-8, -14], [10, 14]] as const) {
    const trunk = toonMesh(new THREE.CylinderGeometry(0.2, 0.3, 4, 6), 0x8b5a2b);
    trunk.position.set(x, 2, z);
    const crown = toonMesh(new THREE.ConeGeometry(1.6, 1.2, 7), 0x3f9a4a);
    crown.position.y = 2.4;
    trunk.add(crown);
    scene.add(trunk);
  }

  return { ground, places };
}

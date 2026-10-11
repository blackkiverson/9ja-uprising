import * as THREE from 'three';

// Fixed League-style camera: angled down ~55 degrees, follows the player, never rotates.
const PITCH_DEG = 55;
const DISTANCE = 32;
const PITCH = THREE.MathUtils.degToRad(PITCH_DEG);

/** Portrait phones see less horizontally, so pull the camera back to keep the block readable. */
function offsetFor(aspect: number): THREE.Vector3 {
  const d = DISTANCE * Math.max(1, Math.sqrt(1.2 / aspect));
  return new THREE.Vector3(0, Math.sin(PITCH) * d, Math.cos(PITCH) * d);
}

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.5, 200);
}

export function followTarget(camera: THREE.PerspectiveCamera, target: THREE.Vector3, dt: number): void {
  const offset = offsetFor(camera.aspect);
  camera.position.lerp(target.clone().add(offset), 1 - Math.exp(-8 * dt));
  camera.lookAt(camera.position.clone().sub(offset));
}

/** Fade buildings that sit between the camera and the player, as per the GDD. */
export function fadeOccluders(camera: THREE.Camera, target: THREE.Vector3, scene: THREE.Scene): void {
  const head = target.clone().setY(1.5);
  const ray = new THREE.Raycaster(camera.position, head.clone().sub(camera.position).normalize(), 0, camera.position.distanceTo(head));
  const hits = new Set(ray.intersectObjects(scene.children, false).map((h) => h.object));
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.userData.occluder) return;
    const mat = obj.material as THREE.MeshToonMaterial;
    const goal = hits.has(obj) ? 0.25 : 1;
    mat.transparent = true;
    mat.opacity += (goal - mat.opacity) * 0.2;
    // Hide the outline hull while faded, otherwise it shows as a dark slab.
    for (const child of obj.children) child.visible = mat.opacity > 0.9;
  });
}

import * as THREE from 'three';
export function makeSlime({ color = 0x4ade80, size = 1 } = {}) {
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.9, roughness: 0.2 }));
  body.position.y = 0.5; body.castShadow = true;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  eye.position.set(-0.25, 0.75, 0.55); const eye2 = eye.clone(); eye2.position.x = 0.25;
  inner.add(body, eye, eye2);
  let t = 0, atk = 0;
  return {
    root,
    play(n) { if (n === 'attack') atk = 0.25; },
    animate(dt, e) {
      t += dt * (e.isMoving ? 9 : 3);
      const s = Math.sin(t);
      inner.scale.set(size * (1 - s * 0.08), size * (1 + s * 0.12), size * (1 - s * 0.08));
      if (atk > 0) { atk -= dt; inner.position.z = Math.sin((1 - atk / 0.25) * Math.PI) * 0.5; } else inner.position.z = 0;
    },
  };
}

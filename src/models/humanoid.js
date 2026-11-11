import * as THREE from 'three';
const box = (w, h, d, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color })); m.castShadow = true; return m; };
const limb = (x, y, s, len, color) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = box(s, len, s, color); m.position.y = -len / 2; p.add(m); return p; };

// Model người tham số hóa: đổi màu / kích thước / vũ khí để ra nhiều nhân vật khác nhau
export function makeHumanoid(o = {}) {
  const { scale = 1, skin = 0xffd7a8, body = 0x3b82f6, legs = 0x1e3a8a, helmet = null, weapon = 'none', weaponColor = 0xcfd8e3 } = o;
  const root = new THREE.Group(), rig = new THREE.Group(); rig.scale.setScalar(scale); root.add(rig);

  const torso = box(0.8, 1, 0.5, body); torso.position.y = 1.5;
  const head = box(0.6, 0.6, 0.6, skin); head.position.y = 2.3;
  const eyeL = box(0.1, 0.1, 0.05, 0x111111); eyeL.position.set(-0.15, 2.35, 0.3);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.15;
  const armL = limb(-0.55, 1.95, 0.25, 0.9, body), armR = limb(0.55, 1.95, 0.25, 0.9, body);
  const legL = limb(-0.2, 1, 0.3, 1, legs), legR = limb(0.2, 1, 0.3, 1, legs);
  rig.add(torso, head, eyeL, eyeR, armL, armR, legL, legR);

  if (helmet !== null) { const h = box(0.7, 0.25, 0.7, helmet); h.position.y = 2.68; rig.add(h); }
  if (weapon === 'sword') {
    const blade = box(0.08, 0.08, 0.95, weaponColor); blade.position.set(0, -0.9, 0.5);
    const guard = box(0.35, 0.08, 0.08, 0x8b5a2b); guard.position.set(0, -0.9, 0.05);
    armR.add(blade, guard);
  } else if (weapon === 'club') {
    const club = box(0.2, 0.2, 0.9, 0x8b5a2b); club.position.set(0, -0.9, 0.45); armR.add(club);
  }

  let t = 0, atk = 0;
  const L = (a, b) => THREE.MathUtils.lerp(a, b, 0.3);
  return {
    root,
    play(n) { if (n === 'attack') atk = 0.25; },
    animate(dt, e) {
      t += dt * (e.isMoving ? 10 : 2);
      const s = e.isMoving && e.onGround ? Math.sin(t) * 0.8 : 0;
      legL.rotation.x = L(legL.rotation.x, s); legR.rotation.x = L(legR.rotation.x, -s);
      armL.rotation.x = L(armL.rotation.x, -s);
      if (atk > 0) { atk -= dt; armR.rotation.x = -Math.sin((1 - atk / 0.25) * Math.PI) * 2.2; }
      else armR.rotation.x = L(armR.rotation.x, s);
      rig.position.y = e.isMoving ? 0 : Math.sin(t) * 0.03;
    },
  };
}

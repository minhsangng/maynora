import * as THREE from 'three';
import { ITEM_DEFS } from './fooddefs';

const MAX_DROPS = 24;
const LIFETIME = 180; // giây: không nhặt thì tự biến mất
const MAGNET_RANGE = 6; // lại gần trong phạm vi này thì vật phẩm tự bay về phía người chơi
const MAGNET_SPEED = 9;

/**
 * Chọn các món rơi ra khi mod `def` bị đánh bại. Bảng rơi khai báo trong mods.js:
 *   drops: [{ item: 'meat', chance: 1, count: [1, 2] }, { item: 'apple', chance: 0.3 }]
 * Không khai báo thì mặc định rơi 1 Thịt. Trả về mảng id (mỗi phần tử = 1 vật phẩm).
 */
export function rollDrops(def, rng = Math.random) {
  const table = def?.drops ?? [{ item: 'meat', chance: 1, count: [1, 1] }];
  const out = [];
  for (const d of table) {
    if (!ITEM_DEFS[d.item] || rng() > (d.chance ?? 1)) continue;
    const [a, b] = d.count ?? [1, 1];
    const n = a + Math.floor(rng() * (b - a + 1));
    for (let i = 0; i < n; i++) out.push(d.item);
  }
  return out;
}

/** Vật phẩm rơi trên mặt đất (chiến lợi phẩm). Dùng model của ItemLibrary; xoay, nhấp nhô để dễ thấy. */
export class Drops {
  constructor(scene, items, terrain) {
    this.scene = scene;
    this.items = items;
    this.terrain = terrain;
    this.list = [];
    this.time = 0;
  }

  spawn(id, x, z) {
    const def = ITEM_DEFS[id];
    if (!def) return;
    const group = new THREE.Group();
    for (const part of this.items.parts(id)) group.add(new THREE.Mesh(part.geometry, part.material));
    group.scale.setScalar(def.size * 1.6); // to hơn quả mọc tự nhiên một chút để dễ nhìn thấy
    group.position.set(x, this.terrain.height(x, z) + 0.6, z);
    this.scene.add(group);
    this.list.push({ id, group, age: 0, phase: Math.random() * 6 });
    if (this.list.length > MAX_DROPS) this.removeAt(0);
  }

  removeAt(i) {
    this.list[i].group.removeFromParent(); // geometry/material dùng chung nên không dispose
    this.list.splice(i, 1);
  }

  update(dt, pp) {
    this.time += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age > LIFETIME) {
        this.removeAt(i);
        continue;
      }
      const p = d.group.position;
      const dx = pp.x - p.x;
      const dz = pp.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < MAGNET_RANGE && dist > 0.3) {
        const step = Math.min(dist, MAGNET_SPEED * dt);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
      }
      p.y = this.terrain.height(p.x, p.z) + 0.6 + Math.sin(this.time * 3 + d.phase) * 0.15;
      d.group.rotation.y += dt * 1.6;
    }
  }

  /** Nhặt các vật phẩm trong bán kính `radius`. Trả về danh sách id đã nhặt. */
  collect(pp, radius) {
    const picked = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i].group.position;
      if (Math.hypot(pp.x - p.x, pp.z - p.z) < radius && Math.abs(pp.y - p.y) < 4) {
        picked.push(this.list[i].id);
        this.removeAt(i);
      }
    }
    return picked;
  }

  clear() {
    for (const d of this.list) d.group.removeFromParent();
    this.list = [];
  }
}
import * as THREE from 'three';
const d = new THREE.Vector3();
// AI đơn giản: thấy player thì đuổi, vào tầm thì dùng skill đầu tiên
export class ChaseAI {
  constructor(e) { this.e = e; }
  update(dt, world) {
    const e = this.e, p = world.player;
    e.moveDir.set(0, 0, 0);
    if (!p?.alive) return;
    d.copy(p.position).sub(e.position); d.y = 0;
    const dist = d.length(), atk = e.skills[0];
    if (dist > e.stats.aggroRange) return;
    e.faceToward(d);
    if (atk && dist <= atk.range * 0.9) atk.tryUse(world);
    else e.moveDir.copy(d);
  }
}

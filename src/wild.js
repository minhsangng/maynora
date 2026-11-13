import * as THREE from 'three';
import { WATER_LEVEL } from './terrain';

const DEFAULTS = {
  max: 6, // số mod hoang dã tối đa cùng lúc
  spawnMin: 18, // mét: chỉ xuất hiện trong "vòng tròn" quanh player, từ spawnMin ...
  spawnMax: 55, // ... đến spawnMax
  despawn: 85, // đi xa quá khoảng này thì biến mất
  interval: 1.8, // giây giữa các lần thử xuất hiện
  wanderSpeed: 1.6,
  noticeDist: 10, // player lại gần trong khoảng này thì mod đứng lại nhìn
};

export class WildSpawner {
  constructor({ scene, terrain, library, camera, effects, levelProvider, config = {} }) {
    this.scene = scene;
    this.terrain = terrain;
    this.library = library;
    this.camera = camera;
    this.effects = effects;
    this.levelProvider = levelProvider ?? (() => 1);
    this.cfg = { ...DEFAULTS, ...config };
    this.list = [];
    this.timer = 0.5;
    this.frustum = new THREE.Frustum();
    this.tmpMat = new THREE.Matrix4();
    this.tmpVec = new THREE.Vector3();
    this.setPool(null);
  }

  setPool(ids) {
    let pool = this.library.defs.filter((d) => (d.wildWeight ?? 0) > 0 && (!ids || ids.includes(d.id)));
    if (pool.length === 0) pool = this.library.defs.filter((d) => (d.wildWeight ?? 0) > 0);
    this.pool = pool;
  }

  clear() {
    for (const a of this.list) a.dispose();
    this.list = [];
    this.timer = 0.5;
  }

  update(dt, playerPos) {
    const cfg = this.cfg;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = cfg.interval * (0.7 + Math.random() * 0.6);
      if (this.list.length < cfg.max) this.trySpawn(playerPos);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.update(dt);
      if (a.engaged) continue;
      const dx = playerPos.x - a.group.position.x;
      const dz = playerPos.z - a.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > cfg.despawn) {
        this.list.splice(i, 1);
        a.vanish(0.4);
        this.effects.adopt(a);
        continue;
      }
      this.wander(a, dt, dx, dz, dist);
    }
  }

  wander(a, dt, dx, dz, dist) {
    if (!a.ai) a.ai = { target: null, wait: 1 + Math.random() * 3 };
    const ai = a.ai;
    const p = a.group.position;

    if (dist < this.cfg.noticeDist) {
      a.moving = false;
      ai.target = null;
      a.faceDir(dx, dz);
    } else if (ai.target) {
      const tx = ai.target.x - p.x;
      const tz = ai.target.z - p.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.4) {
        ai.target = null;
        ai.wait = 2 + Math.random() * 4;
        a.moving = false;
      } else {
        const step = Math.min(d, this.cfg.wanderSpeed * dt);
        const nx = p.x + (tx / d) * step;
        const nz = p.z + (tz / d) * step;
        if (this.terrain.height(nx, nz) < WATER_LEVEL + 0.3) {
          ai.target = null;
          ai.wait = 1;
          a.moving = false;
        } else {
          p.x = nx;
          p.z = nz;
          a.moving = true;
          a.faceDir(tx, tz);
        }
      }
    } else {
      a.moving = false;
      ai.wait -= dt;
      if (ai.wait <= 0) {
        const ang = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 6;
        ai.target = { x: p.x + Math.cos(ang) * r, z: p.z + Math.sin(ang) * r };
      }
    }
    p.y = this.terrain.height(p.x, p.z);
  }

  pickDef() {
    const total = this.pool.reduce((s, d) => s + d.wildWeight, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const d of this.pool) {
      r -= d.wildWeight;
      if (r <= 0) return d;
    }
    return this.pool[this.pool.length - 1];
  }

  trySpawn(pp) {
    const def = this.pickDef();
    if (!def) return;
    const { spawnMin, spawnMax } = this.cfg;
    this.camera.updateMatrixWorld();
    this.tmpMat.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.tmpMat);

    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = spawnMin + Math.sqrt(Math.random()) * (spawnMax - spawnMin);
      const x = pp.x + Math.cos(ang) * r;
      const z = pp.z + Math.sin(ang) * r;
      const h = this.terrain.height(x, z);
      if (h < WATER_LEVEL + 1.2) continue;
      const slope =
        Math.abs(this.terrain.height(x + 1.5, z) - h) + Math.abs(this.terrain.height(x, z + 1.5) - h);
      if (slope > 2) continue;
      
      this.tmpVec.set(x, h + 0.8, z);
      if (i < 8 && this.frustum.containsPoint(this.tmpVec)) continue;
      this.spawnAt(def, x, h, z);
      return;
    }
  }

  spawnAt(def, x, y, z) {
    const base = this.levelProvider();
    const level = Math.max(1, Math.min(30, base + Math.floor(Math.random() * 3) - 1));
    const actor = this.library.spawn(def.id, { level, owner: 'wild' });
    actor.group.position.set(x, y, z);
    const ang = Math.random() * Math.PI * 2;
    actor.faceDir(Math.sin(ang), Math.cos(ang), true);
    actor.spawnIn();
    this.scene.add(actor.group);
    this.effects.ring(actor.group.position, def.color ?? 0xffffff, 1.5);
    this.list.push(actor);
  }

  nearest(pos, range) {
    let best = null;
    let bestD = range;
    for (const a of this.list) {
      if (a.engaged || a.fainted || a.gone) continue;
      const d = Math.hypot(pos.x - a.group.position.x, pos.z - a.group.position.z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  release(actor) {
    const i = this.list.indexOf(actor);
    if (i >= 0) this.list.splice(i, 1);
  }
}
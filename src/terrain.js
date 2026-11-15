import * as THREE from 'three';
import { TerrainGenerator, WATER_LEVEL, SEA_FLOOR, SEABED_COLOR } from './terraingen';
import { buildChunk } from './chunkbuild';
import { InstanceBatch } from './instancing';
import { FOOD_DEFS } from './fooddefs';

export { TerrainGenerator, WATER_LEVEL, SEA_FLOOR, SEABED_COLOR };

const MAX_INFLIGHT = 3; // số chunk gửi cho worker cùng lúc (ít để còn đổi ưu tiên khi người chơi di chuyển)

/**
 * Quản lý chunk:
 *  - Dựng dữ liệu chunk trong Web Worker (không giật luồng chính). Không có Worker thì tự dựng 1 chunk / frame.
 *  - Mặt đất: 1 mesh / chunk (three tự cắt ngoài khung hình).
 *  - Cây / đá / cỏ / đồ ăn: gộp toàn cục bằng InstanceBatch => chỉ vài chục draw call dù có bao nhiêu chunk.
 *  - Lưu vòng va chạm (cây, đá) và vị trí thực phẩm của từng chunk.
 */
export class ChunkManager {
  constructor(scene, gen, props, options = {}) {
    this.scene = scene;
    this.gen = gen;
    this.props = props;
    this.cfg = {
      chunkSize: 64,
      resolution: 40, // số ô lưới / cạnh chunk
      viewRadius: 4, // bán kính nạp (chunk)
      propScale: 1, // nhân số lượng cây/đá
      grassScale: 1, // nhân số lượng cỏ (0 = tắt)
      drawScale: 1, // nhân khoảng cách vẽ của prop
      foodScale: 1,
      foodDraw: 2.5, // bán kính vẽ thực phẩm (chunk)
      bake: false, // true: nướng ánh sáng vào màu đỉnh + dùng material không đèn (nhẹ nhất)
      simpleMaterials: false, // true: đổi vật liệu PBR của model sang Lambert (nhẹ hơn nhiều)
      ...options,
    };
    this.chunks = new Map(); // key -> { mesh, colliders, food: [...] }
    this.pending = new Set();
    this.queue = [];
    this.ready = [];
    this.batches = [];
    this.propBatches = new Map(); // `${ti}|${vi}` -> [InstanceBatch theo từng mesh con của model]
    this.foodBatches = [];
    this.own = []; // geometry/material tự tạo, cần dispose
    this.epoch = 0;
    this.lastCx = NaN;
    this.lastCz = NaN;
    this.batchDirty = true;
    this.lastRebuild = 0;
    this.terrainMat = null;
    this.indexTemplate = null;

    this.frustum = new THREE.Frustum();
    this.pv = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.lastCamPos = new THREE.Vector3(1e9, 1e9, 1e9);
    this.lastCamQuat = new THREE.Quaternion();
    this.visibleFn = (seg) => this.isVisible(seg);

    this.worker = null;
    this.startWorker();
    this.rebuildAll();
  }

  get viewDistance() {
    return this.cfg.viewRadius * this.cfg.chunkSize;
  }

  get loadedCount() {
    return this.chunks.size;
  }

  get pendingCount() {
    return this.pending.size + this.ready.length;
  }

  startWorker() {
    if (typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        if (e.data.type === 'chunk') this.ready.push(e.data);
      };
      w.onerror = (e) => {
        console.warn('[chunks] Worker lỗi -> dựng chunk trên luồng chính (chậm hơn)', e.message);
        this.worker = null;
        this.pending.clear();
        this.lastCx = NaN;
      };
      this.worker = w;
    } catch (err) {
      console.warn('[chunks] Không tạo được Worker -> dựng chunk trên luồng chính', err);
      this.worker = null;
    }
  }

  /** Đổi cấu hình (mức chất lượng). Có thay đổi thì dựng lại toàn bộ chunk. */
  configure(patch = {}) {
    const keys = Object.keys(patch);
    if (!keys.some((k) => patch[k] !== this.cfg[k])) return;
    this.cfg = { ...this.cfg, ...patch };
    this.rebuildAll();
  }

  /** Bỏ hết chunk và dựng lại từ đầu (đổi đảo hoặc đổi chất lượng). Gọi sau terrain.setIsland(). */
  reset() {
    this.rebuildAll();
  }

  rebuildAll() {
    this.disposeAll();
    this.epoch++;
    this.ready.length = 0;
    this.pending.clear();
    this.queue = [];
    this.lastCx = NaN;
    this.lastCz = NaN;
    this.batchDirty = true;
    this.makeTerrainMaterial();
    this.makeIndexTemplate();
    this.makeBatches();

    this.propInfo = this.props.info();
    this.buildCfg = {
      chunkSize: this.cfg.chunkSize,
      resolution: this.cfg.resolution,
      propScale: this.cfg.propScale,
      grassScale: this.cfg.grassScale,
      foodScale: this.cfg.foodScale,
      bake: this.cfg.bake,
    };
    if (this.worker) {
      this.worker.postMessage({
        type: 'init',
        epoch: this.epoch,
        island: {
          seed: this.gen.seed,
          radius: this.gen.radius,
          relief: this.gen.relief,
          forestThreshold: this.gen.forestThreshold,
        },
        cfg: this.buildCfg,
        propInfo: this.propInfo,
      });
    }
  }

  makeTerrainMaterial() {
    this.terrainMat?.dispose();
    this.terrainMat = this.cfg.bake
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  makeIndexTemplate() {
    const R = this.cfg.resolution;
    const N = R + 1;
    const idx = N * N > 65535 ? new Uint32Array(R * R * 6) : new Uint16Array(R * R * 6);
    let k = 0;
    for (let iz = 0; iz < R; iz++) {
      for (let ix = 0; ix < R; ix++) {
        const a = iz * N + ix;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    this.indexTemplate = idx;
  }

  makeBatches() {
    const cfg = this.cfg;
    const chunksIn = (r) => Math.ceil(Math.PI * (r + 0.8) ** 2);

    this.props.types.forEach((t, ti) => {
      const def = t.def;
      const attempts = Math.floor(def.perChunk * cfg.propScale * (def.groundCover ? cfg.grassScale : 1));
      if (attempts <= 0) return;
      const farthest = Math.max(...def.sizes.map((s) => s.drawChunks ?? def.drawChunks ?? cfg.viewRadius));
      const capacity = Math.max(16, attempts * chunksIn(Math.min(cfg.viewRadius, farthest * Math.max(1, cfg.drawScale))));
      t.variants.forEach((v, vi) => {
        const list = v.parts.map((part) => {
          const b = new InstanceBatch(this.scene, part.geometry, cfg.simpleMaterials ? part.materialSimple : part.material, capacity);
          this.batches.push(b);
          return b;
        });
        this.propBatches.set(`${ti}|${vi}`, list);
      });
    });

    this.foodBatches = FOOD_DEFS.map((def) => {
      const geo = def.shape === 'cone' ? new THREE.ConeGeometry(1, 1.4, 8) : new THREE.SphereGeometry(1, 8, 6);
      const mat = new THREE.MeshBasicMaterial({ color: def.color });
      this.own.push(geo, mat);
      const capacity = Math.max(16, Math.floor(def.perChunk * cfg.foodScale) * chunksIn(cfg.foodDraw));
      const b = new InstanceBatch(this.scene, geo, mat, capacity);
      this.batches.push(b);
      return b;
    });
  }

  disposeChunk(chunk) {
    chunk.mesh.removeFromParent();
    chunk.mesh.geometry.dispose();
  }

  disposeAll() {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    for (const b of this.batches) b.dispose();
    this.batches = [];
    this.propBatches.clear();
    this.foodBatches = [];
    for (const o of this.own) o.dispose();
    this.own = [];
  }

  // ---------------------------------------------------------------- nạp / bỏ chunk

  /**
   * Gọi mỗi frame với vị trí người chơi và camera.
   * opts.budgetMs: thời gian tối đa để dựng mesh từ kết quả worker trong frame này.
   */
  update(px, pz, camera, opts = {}) {
    const S = this.cfg.chunkSize;
    const ccx = Math.floor(px / S);
    const ccz = Math.floor(pz / S);
    if (ccx !== this.lastCx || ccz !== this.lastCz) {
      this.lastCx = ccx;
      this.lastCz = ccz;
      this.refreshQueue(ccx, ccz);
      this.unloadFar();
      this.batchDirty = true;
    }
    this.pump();
    this.applyReady(opts.budgetMs ?? 2);
    this.updateBatches(camera);
  }

  refreshQueue(ccx, ccz) {
    const R = this.cfg.viewRadius;
    const S = this.cfg.chunkSize;
    const missing = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d > R * R) continue; // vùng tròn
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = `${cx},${cz}`;
        if (this.chunks.has(key) || this.pending.has(key)) continue;
        if (this.gen.isOpenSea(cx, cz, S)) continue; // ngoài khơi: không cần mesh
        missing.push({ cx, cz, d });
      }
    }
    missing.sort((a, b) => a.d - b.d); // chunk gần player dựng trước
    this.queue = missing;
  }

  tooFar(cx, cz) {
    const lim = (this.cfg.viewRadius + 1) ** 2; // +1 để tránh nạp/bỏ liên tục ở rìa
    return (cx - this.lastCx) ** 2 + (cz - this.lastCz) ** 2 > lim;
  }

  unloadFar() {
    for (const [key, chunk] of this.chunks) {
      if (this.tooFar(chunk.cx, chunk.cz)) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
        for (const b of this.batches) b.remove(key);
      }
    }
  }

  pump() {
    while (this.queue.length > 0) {
      if (this.worker && this.pending.size >= MAX_INFLIGHT) break;
      if (!this.worker && this.ready.length > 0) break; // không có worker: 1 chunk / frame
      const { cx, cz } = this.queue.shift();
      const key = `${cx},${cz}`;
      if (this.chunks.has(key) || this.pending.has(key) || this.tooFar(cx, cz)) continue;
      this.pending.add(key);
      if (this.worker) {
        this.worker.postMessage({ type: 'build', epoch: this.epoch, cx, cz });
      } else {
        const r = buildChunk(this.gen, this.buildCfg, this.propInfo, cx, cz);
        r.epoch = this.epoch;
        this.ready.push(r);
      }
    }
  }

  applyReady(budgetMs) {
    const t0 = performance.now();
    while (this.ready.length > 0) {
      this.applyResult(this.ready.shift());
      if (performance.now() - t0 >= budgetMs) break;
    }
  }

  applyResult(r) {
    const key = `${r.cx},${r.cz}`;
    if (r.epoch !== this.epoch) return; // kết quả của đảo / cấu hình cũ
    this.pending.delete(key);
    if (this.chunks.has(key) || this.tooFar(r.cx, r.cz)) return;

    const S = this.cfg.chunkSize;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(r.col, 3));
    geo.setIndex(new THREE.BufferAttribute(this.indexTemplate.slice(), 1));
    const h = r.maxY - r.minY;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(S / 2, (r.minY + r.maxY) / 2, S / 2), Math.hypot(S / 2, S / 2, h / 2));
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(r.cx * S, 0, r.cz * S);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false; // chunk là vật tĩnh
    this.scene.add(mesh);

    // Mặt cầu bao quanh chunk (cho việc cắt theo khung hình của prop)
    const meta = {
      cx: r.cx,
      cz: r.cz,
      wx: r.cx * S + S / 2,
      wz: r.cz * S + S / 2,
      cy: (r.minY + r.maxY) / 2,
      r: Math.hypot(S * 0.7072, h / 2),
    };
    for (const p of r.props) {
      const list = this.propBatches.get(`${p.ti}|${p.vi}`);
      if (!list) continue;
      for (const b of list) b.set(key, p.data, p.n, { ...meta, dc: p.dc });
    }
    const food = [];
    for (const f of r.food) {
      this.foodBatches[f.ti]?.set(key, f.data, f.n, { ...meta, dc: this.cfg.foodDraw });
      food.push({ id: FOOD_DEFS[f.ti].id, n: f.n, pos: f.pos, data: f.data, taken: new Uint8Array(f.n) });
    }

    this.chunks.set(key, { cx: r.cx, cz: r.cz, mesh, colliders: r.colliders, food });
    this.batchDirty = true;
  }

  /** Chờ vài chunk đầu tiên quanh (px, pz) nạp xong (dùng lúc vào đảo, khi màn hình đang tối). */
  async waitInitial(px, pz, camera, count = 9, timeoutMs = 10000) {
    const t0 = performance.now();
    while (this.chunks.size < count && performance.now() - t0 < timeoutMs) {
      this.update(px, pz, camera, { budgetMs: 50 });
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
  }

  // ---------------------------------------------------------------- vẽ prop

  isVisible(seg) {
    const dx = seg.cx - this.lastCx;
    const dz = seg.cz - this.lastCz;
    const lim = seg.dc * this.cfg.drawScale;
    if (dx * dx + dz * dz > lim * lim) return false;
    this.sphere.center.set(seg.wx, seg.cy, seg.wz);
    this.sphere.radius = seg.r + 40; // chừa lề để khi quay camera nhanh không thấy cây "hiện ra"
    return this.frustum.intersectsSphere(this.sphere);
  }

  updateBatches(camera) {
    const now = performance.now();
    const moved =
      camera.position.distanceToSquared(this.lastCamPos) > 9 || camera.quaternion.dot(this.lastCamQuat) < 0.9995;
    const due = this.batchDirty || (moved && now - this.lastRebuild > 80) || now - this.lastRebuild > 500;
    if (!due) return;
    camera.updateMatrixWorld();
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    for (const b of this.batches) b.rebuild(this.visibleFn);
    this.lastCamPos.copy(camera.position);
    this.lastCamQuat.copy(camera.quaternion);
    this.lastRebuild = now;
    this.batchDirty = false;
  }

  // ---------------------------------------------------------------- va chạm & thực phẩm

  /**
   * Đẩy (pos.x, pos.z) ra khỏi các vật cản (thân cây, đá) trong bán kính `radius`.
   * Vì là đẩy ra theo pháp tuyến nên người chơi tự "trượt" quanh vật cản thay vì bị kẹt.
   * Trả về true nếu có va chạm.
   */
  resolve(pos, radius) {
    const S = this.cfg.chunkSize;
    const ccx = Math.floor(pos.x / S);
    const ccz = Math.floor(pos.z / S);
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = this.chunks.get(`${ccx + dx},${ccz + dz}`);
          if (!c) continue;
          const a = c.colliders;
          for (let i = 0; i < a.length; i += 3) {
            const ddx = pos.x - a[i];
            const ddz = pos.z - a[i + 1];
            const rr = a[i + 2] + radius;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 1e-4;
              const push = rr - d;
              pos.x += (ddx / d) * push;
              pos.z += (ddz / d) * push;
              hit = true;
            }
          }
        }
      }
    }
    return hit;
  }

  /** Nhặt thực phẩm trong bán kính `radius` quanh người chơi. Trả về danh sách id đã nhặt. */
  collectFood(px, py, pz, radius) {
    const S = this.cfg.chunkSize;
    const ccx = Math.floor(px / S);
    const ccz = Math.floor(pz / S);
    const r2 = radius * radius;
    const picked = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${ccx + dx},${ccz + dz}`);
        if (!c) continue;
        for (const f of c.food) {
          for (let i = 0; i < f.n; i++) {
            if (f.taken[i]) continue;
            const ex = f.pos[i * 3] - px;
            const ey = f.pos[i * 3 + 1] - py;
            const ez = f.pos[i * 3 + 2] - pz;
            if (ex * ex + ez * ez < r2 && Math.abs(ey) < 3) {
              f.taken[i] = 1;
              f.data.fill(0, i * 16, i * 16 + 16); // ma trận 0 => không còn vẽ
              picked.push(f.id);
              this.batchDirty = true;
            }
          }
        }
      }
    }
    return picked;
  }
}
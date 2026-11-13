import * as THREE from 'three';
import { SimplexNoise } from './noise';

export const WATER_LEVEL = 0;
export const SEA_FLOOR = -8; // đáy biển phẳng: mọi thứ thấp hơn bị ép lên mức này
export const SEABED_COLOR = 0x1d5f8a;

const TAU = Math.PI * 2;
const COAST_STEPS = 720;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Địa hình của MỘT đảo, tâm ở (0, 0), xung quanh là biển.
 * Mọi thứ (mesh, cây, va chạm) đều suy ra từ các hàm THUẦN TÚY này:
 * cùng (x, z) + cùng đảo => luôn cùng kết quả, nên đảo luôn đồng nhất dù load/unload bao nhiêu lần.
 * Đổi sang đảo khác bằng setIsland() - đối tượng này giữ nguyên nên mọi nơi đang tham chiếu vẫn dùng được.
 */
export class TerrainGenerator {
  seed;
  radius;
  relief;
  forestThreshold;
  maxRadius;

  constructor(island = {}) {
    this.setIsland(typeof island === 'number' ? { seed: island } : island);
  }

  setIsland(def = {}) {
    this.seed = def.seed ?? 12345;
    this.radius = def.radius ?? 400; // bán kính "danh nghĩa" của đảo (mét)
    this.relief = def.relief ?? 1; // độ gồ ghề: đồi núi cao thấp
    this.forestThreshold = def.forestThreshold ?? 0.05; // thấp hơn = nhiều rừng hơn
    this.shape = new SimplexNoise(this.seed);
    this.forestNoise = new SimplexNoise(this.seed + 1337);

    // Bảng bán kính bờ biển theo góc => đường bờ lồi lõm tự nhiên (không phải hình tròn)
    const coastNoise = new SimplexNoise(this.seed + 4242);
    this.coast = new Float32Array(COAST_STEPS + 1);
    let maxR = 0;
    for (let i = 0; i <= COAST_STEPS; i++) {
      const a = (i / COAST_STEPS) * TAU;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const n = coastNoise.noise2D(cx * 1.3 + 7, cz * 1.3 + 3) + 0.5 * coastNoise.noise2D(cx * 2.7 - 5, cz * 2.7 + 11);
      const r = this.radius * (1 + 0.28 * (n / 1.5));
      this.coast[i] = r;
      if (r > maxR) maxR = r;
    }
    this.maxRadius = maxR;
  }

  fbm(n, x, z, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += n.noise2D(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /** Bán kính bờ biển theo góc a (radian). */
  coastRadius(a) {
    let t = a / TAU;
    t -= Math.floor(t);
    const f = t * COAST_STEPS;
    const i = Math.floor(f);
    const k = f - i;
    return this.coast[i] * (1 - k) + this.coast[i + 1] * k;
  }

  /** Độ cao "đất liền" nếu không có biển bao quanh. Chỉnh các hệ số để đổi hình dạng đảo. */
  landHeight(x, z) {
    const continent = this.fbm(this.shape, x * 0.0012, z * 0.0012, 3);
    const hills = this.fbm(this.shape, x * 0.008 + 50, z * 0.008 + 50, 5);
    const ridge = 1 - Math.abs(this.shape.noise2D(x * 0.0035 - 200, z * 0.0035 + 200));
    const mountainMask = smoothstep(0.05, 0.45, continent);
    return 8 + continent * 20 + hills * 12 * this.relief + ridge ** 3 * 80 * this.relief * mountainMask;
  }

  /** Độ cao tại toạ độ thế giới (x, z). Ngoài đảo luôn là SEA_FLOOR. */
  height(x, z) {
    const d = Math.hypot(x, z);
    const rEff = this.coastRadius(Math.atan2(z, x));
    if (d >= rEff) return SEA_FLOOR; // ngoài khơi: khỏi tính noise
    const mask = smoothstep(0, rEff * 0.3, rEff - d); // 0 ở bờ -> 1 khi vào trong 30% bán kính (bãi biển thoải)
    return Math.max(SEA_FLOOR, -12 + (this.landHeight(x, z) + 12) * mask);
  }

  /** Chunk nằm hoàn toàn ngoài đảo (chỉ có biển) -> khỏi dựng mesh, đã có mặt nước + đáy biển lo. */
  isOpenSea(cx, cz, S) {
    const x0 = cx * S;
    const z0 = cz * S;
    const x1 = x0 + S;
    const z1 = z0 + S;
    const mx = x0 + S / 2;
    const mz = z0 + S / 2;
    const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [mx, z0], [mx, z1], [x0, mz], [x1, mz]];
    let rMax = 0;
    for (const [x, z] of pts) rMax = Math.max(rMax, this.coastRadius(Math.atan2(z, x)));
    const dMin = Math.hypot(mx, mz) - S * 0.7072; // khoảng cách gần nhất từ tâm đảo tới chunk
    return dMin > rMax * 1.06;
  }

  /** Mật độ rừng, khoảng [-1, 1]. */
  forest(x, z) {
    return this.fbm(this.forestNoise, x * 0.01, z * 0.01, 2);
  }
}

const GRASS = new THREE.Color(0x5c9e3a);
const HIGH_GRASS = new THREE.Color(0x3f6b34);
const SAND = new THREE.Color(0xd9c58f);
const ROCK = new THREE.Color(0x7d7a74);
const SNOW = new THREE.Color(0xf4f7fb);
const SEABED = new THREE.Color(SEABED_COLOR);

export class ChunkManager {
  viewDistance;

  scene;
  gen;
  opts;
  chunks = new Map();
  queue = [];
  lastCx = NaN;
  lastCz = NaN;

  terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor(scene, gen, opts, props = null) {
    this.props = props; // PropScatter (tuỳ chọn) - rải model GLB lên chunk
    this.scene = scene;
    this.gen = gen;
    this.opts = opts;
    this.viewDistance = opts.chunkSize * opts.viewRadius;
  }

  get loadedCount() {
    return this.chunks.size;
  }

  /**
   * Gọi mỗi frame.
   * `budgetMs`  = ngân sách thời gian build chunk trong frame này (luôn build ít nhất 1 chunk nếu còn hàng đợi)
   * `maxCount`  = số chunk tối đa (dùng để load nhanh vài chunk gần nhất lúc khởi động)
   */
  update(px, pz, budgetMs = 4, maxCount = Infinity) {
    const S = this.opts.chunkSize;
    const ccx = Math.floor(px / S);
    const ccz = Math.floor(pz / S);

    // Chỉ tính lại danh sách khi player sang chunk mới
    if (ccx !== this.lastCx || ccz !== this.lastCz) {
      this.lastCx = ccx;
      this.lastCz = ccz;
      this.refreshQueue(ccx, ccz);
      this.unloadFar(ccx, ccz);
      this.updatePropVisibility();
    }

    const t0 = performance.now();
    let built = 0;
    while (this.queue.length > 0 && built < maxCount) {
      const { cx, cz } = this.queue.shift();
      if (this.chunks.has(`${cx},${cz}`)) continue;
      this.load(cx, cz);
      built++;
      if (performance.now() - t0 >= budgetMs) break; // hết ngân sách -> để frame sau
    }
  }

  refreshQueue(ccx, ccz) {
    const R = this.opts.viewRadius;
    const missing = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d > R * R) continue; // vùng tròn
        const cx = ccx + dx, cz = ccz + dz;
        if (this.gen.isOpenSea(cx, cz, this.opts.chunkSize)) continue; // ngoài khơi: không dựng
        if (!this.chunks.has(`${cx},${cz}`)) missing.push({ cx, cz, d });
      }
    }
    missing.sort((a, b) => a.d - b.d); // chunk gần player build trước
    this.queue = missing;
  }

  /** Bỏ toàn bộ chunk đang load (dùng khi chuyển đảo). */
  reset() {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    this.queue = [];
    this.lastCx = NaN;
    this.lastCz = NaN;
  }

  unloadFar(ccx, ccz) {
    const limit = (this.opts.viewRadius + 1) ** 2; // +1 để tránh load/unload liên tục ở rìa
    for (const [key, chunk] of this.chunks) {
      const [cx, cz] = key.split(',').map(Number);
      if ((cx - ccx) ** 2 + (cz - ccz) ** 2 > limit) {
        this.disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }
  }

  load(cx, cz) {
    const key = `${cx},${cz}`;
    const chunk = this.build(cx, cz);
    this.chunks.set(key, chunk);
    this.applyPropVisibility(key, chunk);
  }

  /** Prop nặng (vd cỏ) chỉ được vẽ ở các chunk gần player (theo drawChunks). */
  updatePropVisibility() {
    for (const [key, chunk] of this.chunks) this.applyPropVisibility(key, chunk);
  }

  applyPropVisibility(key, chunk) {
    const [cx, cz] = key.split(',').map(Number);
    const d2 = (cx - this.lastCx) ** 2 + (cz - this.lastCz) ** 2;
    for (const p of chunk.props) p.mesh.visible = d2 <= p.drawChunks ** 2;
  }

  disposeChunk(chunk) {
    chunk.group.removeFromParent();
    chunk.mesh.geometry.dispose();
    // geometry/material của model GLB dùng chung cho mọi chunk nên KHÔNG dispose,
    // chỉ giải phóng bảng ma trận instance của chunk này
    for (const p of chunk.props) p.mesh.dispose();
  }

  colorAt(h, ny, out) {
    out.copy(GRASS).lerp(HIGH_GRASS, smoothstep(8, 35, h));
    out.lerp(SAND, 1 - smoothstep(WATER_LEVEL + 0.3, WATER_LEVEL + 2.2, h));
    const rockT = smoothstep(0.1, 0.28, 1 - ny); // dốc đứng -> đá
    out.lerp(ROCK, rockT);
    out.lerp(SNOW, smoothstep(55, 70, h) * (1 - 0.6 * rockT)); // đỉnh cao -> tuyết
    out.lerp(SEABED, smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL - 5, h)); // dưới nước -> màu đáy biển (khớp mặt đáy)
  }

  build(cx, cz) {
    const S = this.opts.chunkSize;
    const R = this.opts.resolution;
    const step = S / R;
    const N = R + 1; // số vertex / cạnh
    const stride = R + 3; // lưới độ cao có viền 1 ô mỗi phía để tính normal
    const ox = cx * S;
    const oz = cz * S;

    // 1) Lấy mẫu độ cao theo TOẠ ĐỘ THẾ GIỚI. Vertex biên của 2 chunk kề nhau
    // có cùng toạ độ => cùng độ cao => không bị nứt.
    // Viết (i * S) / R thay vì i * step để vertex biên khớp tuyệt đối.
    const hs = new Float32Array(stride * stride);
    for (let gz = 0; gz < stride; gz++) {
      for (let gx = 0; gx < stride; gx++) {
        hs[gz * stride + gx] = this.gen.height(ox + ((gx - 1) * S) / R, oz + ((gz - 1) * S) / R);
      }
    }

    // 2) Dựng vertex (toạ độ cục bộ trong chunk, giúp tránh lỗi số thực khi đi rất xa)
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const g = (iz + 1) * stride + (ix + 1);
        const h = hs[g];
        // normal từ chênh lệch độ cao của ô lân cận (kể cả ô nằm ngoài chunk) => liền mạch
        const nx = (hs[g - 1] - hs[g + 1]) / (2 * step);
        const nz = (hs[g - stride] - hs[g + stride]) / (2 * step);
        const inv = 1 / Math.hypot(nx, 1, nz);
        const i3 = (iz * N + ix) * 3;
        pos[i3] = ix * step;
        pos[i3 + 1] = h;
        pos[i3 + 2] = iz * step;
        nor[i3] = nx * inv;
        nor[i3 + 1] = inv;
        nor[i3 + 2] = nz * inv;
        this.colorAt(h, inv, c);
        col[i3] = c.r;
        col[i3 + 1] = c.g;
        col[i3 + 2] = c.b;
      }
    }

    const idx = new Uint32Array(R * R * 6);
    let k = 0;
    for (let iz = 0; iz < R; iz++) {
      for (let ix = 0; ix < R; ix++) {
        const a = iz * N + ix;
        const b = a + 1;
        const cc = a + N;
        const d = cc + 1;
        idx[k++] = a; idx[k++] = cc; idx[k++] = b;
        idx[k++] = b; idx[k++] = cc; idx[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    group.add(mesh);

    // 3) Rải model GLB (cây, đá, cỏ...). Vị trí suy ra từ seed + (cx, cz) nên luôn cố định
    // Dùng lại lưới độ cao `hs` để đặt vật thể -> không phải gọi lại noise
    const props = this.props ? this.props.populate(cx, cz, group, { hs, stride, step }) : [];

    // Chunk là vật tĩnh: tắt tự cập nhật ma trận mỗi frame (đỡ tốn CPU khi có hàng trăm object)
    group.updateMatrix();
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });

    this.scene.add(group);
    return { group, mesh, props };
  }
}
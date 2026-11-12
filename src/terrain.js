import * as THREE from 'three';
import { SimplexNoise } from './noise';

export const WATER_LEVEL = 0;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class TerrainGenerator {
  seed;
  shape;
  forestNoise;

  constructor(seed) {
    this.seed = seed;
    this.shape = new SimplexNoise(seed);
    this.forestNoise = new SimplexNoise(seed + 1337);
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

  height(x, z) {
    const continent = this.fbm(this.shape, x * 0.0012, z * 0.0012, 3);
    const hills = this.fbm(this.shape, x * 0.008 + 50, z * 0.008 + 50, 5);
    const ridge = 1 - Math.abs(this.shape.noise2D(x * 0.0035 - 200, z * 0.0035 + 200));
    const mountainMask = smoothstep(0.05, 0.45, continent);
    return 6 + continent * 25 + hills * 14 + ridge ** 3 * 90 * mountainMask;
  }

  forest(x, z) {
    return this.fbm(this.forestNoise, x * 0.01, z * 0.01, 2);
  }
}

const GRASS = new THREE.Color(0x5c9e3a);
const HIGH_GRASS = new THREE.Color(0x3f6b34);
const SAND = new THREE.Color(0xd9c58f);
const ROCK = new THREE.Color(0x7d7a74);
const SNOW = new THREE.Color(0xf4f7fb);

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
    this.props = props;
    this.scene = scene;
    this.gen = gen;
    this.opts = opts;
    this.viewDistance = opts.chunkSize * opts.viewRadius;
  }

  get loadedCount() {
    return this.chunks.size;
  }

  update(px, pz, budgetMs = 4, maxCount = Infinity) {
    const S = this.opts.chunkSize;
    const ccx = Math.floor(px / S);
    const ccz = Math.floor(pz / S);

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
      if (performance.now() - t0 >= budgetMs) break;
    }
  }

  refreshQueue(ccx, ccz) {
    const R = this.opts.viewRadius;
    const missing = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = dx * dx + dz * dz;
        if (d > R * R) continue;
        const cx = ccx + dx, cz = ccz + dz;
        if (!this.chunks.has(`${cx},${cz}`)) missing.push({ cx, cz, d });
      }
    }
    missing.sort((a, b) => a.d - b.d);
    this.queue = missing;
  }

  unloadFar(ccx, ccz) {
    const limit = (this.opts.viewRadius + 1) ** 2;
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
    for (const p of chunk.props) p.mesh.dispose();
  }

  colorAt(h, ny, out) {
    out.copy(GRASS).lerp(HIGH_GRASS, smoothstep(8, 35, h));
    out.lerp(SAND, 1 - smoothstep(WATER_LEVEL + 0.3, WATER_LEVEL + 2.2, h));
    const rockT = smoothstep(0.1, 0.28, 1 - ny);
    out.lerp(ROCK, rockT);
    out.lerp(SNOW, smoothstep(55, 70, h) * (1 - 0.6 * rockT));
  }

  build(cx, cz) {
    const S = this.opts.chunkSize;
    const R = this.opts.resolution;
    const step = S / R;
    const N = R + 1;
    const stride = R + 3;
    const ox = cx * S;
    const oz = cz * S;

    const hs = new Float32Array(stride * stride);
    for (let gz = 0; gz < stride; gz++) {
      for (let gx = 0; gx < stride; gx++) {
        hs[gz * stride + gx] = this.gen.height(ox + ((gx - 1) * S) / R, oz + ((gz - 1) * S) / R);
      }
    }

    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const g = (iz + 1) * stride + (ix + 1);
        const h = hs[g];
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

    const props = this.props ? this.props.populate(cx, cz, group, { hs, stride, step }) : [];

    group.updateMatrix();
    group.traverse((o) => {
      o.matrixAutoUpdate = false;
    });

    this.scene.add(group);
    return { group, mesh, props };
  }
}
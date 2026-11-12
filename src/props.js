import * as THREE from 'three';
import { makeLoader } from './loader';
import { hash2D, mulberry32 } from './noise';
import { WATER_LEVEL } from './terrain';

export const PROP_DEFS = [
  {
    name: 'tree',
    variants: [
      { url: '/models/tree.glb', weight: 4 },
      { url: '/models/tree.glb', weight: 3 },
      { url: '/models/tree.glb', weight: 2 },
    ],
    sizes: [
      { height: [3, 5], weight: 3, drawChunks: 2.5 },
      { height: [6, 9], weight: 5, drawChunks: 3.5 },
      { height: [10, 15], weight: 2, drawChunks: 5 },
    ],
    jitter: 0.12,
    perChunk: 80,
    minHeight: WATER_LEVEL + 2,
    maxHeight: 42,
    maxSlope: 1.2,
    density: (gen, x, z) => gen.forest(x, z) > 0.05,
  },
  {
    name: 'rock',
    variants: [
      { url: '/models/rock.glb', weight: 4 },
      { url: '/models/rock.glb', weight: 3 },
      { url: '/models/rock.glb', weight: 2 },
    ],
    sizes: [
      { height: [0.3, 0.8], weight: 6, drawChunks: 2 }, // đá nhỏ
      { height: [1, 2], weight: 3, drawChunks: 3 }, // đá vừa
      { height: [3, 6], weight: 1, drawChunks: 5 }, // tảng đá lớn
    ],
    jitter: 0.2,
    perChunk: 24,
    minHeight: WATER_LEVEL - 1,
    maxHeight: 200,
    maxSlope: Infinity,
    alignToGround: true,
    sink: 0.12,
  },
  {
    name: 'grass',
    variants: [{ url: '/models/grass.glb', weight: 1 }],
    sizes: [{ height: [0.5, 0.9], weight: 1, drawChunks: 1.5 }],
    jitter: 0.2,
    perChunk: 400,
    minHeight: WATER_LEVEL + 1,
    maxHeight: 30,
    maxSlope: 0.8,
    doubleSide: true,
    cutout: 0.5,
  },
];

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const dummy = new THREE.Object3D();
const qAlign = new THREE.Quaternion();
const qYaw = new THREE.Quaternion();
const normal = new THREE.Vector3();
const hit = { h: 0, dx: 0, dz: 0 };

function hashName(name) {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return h;
}

function makeCum(items) {
  const total = items.reduce((a, it) => a + (it.weight ?? 1), 0);
  let acc = 0;
  return items.map((it) => (acc += (it.weight ?? 1) / total));
}
function pick(cum, r) {
  for (let i = 0; i < cum.length; i++) if (r <= cum[i]) return i;
  return cum.length - 1;
}

function sampleGrid(g, lx, lz) {
  const fx = lx / g.step + 1;
  const fz = lz / g.step + 1;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * g.stride + ix;
  const hs = g.hs;
  const h00 = hs[i];
  const h10 = hs[i + 1];
  const h01 = hs[i + g.stride];
  const h11 = hs[i + g.stride + 1];
  if (tx + tz <= 1) {
    hit.h = h00 + tx * (h10 - h00) + tz * (h01 - h00);
    hit.dx = (h10 - h00) / g.step;
    hit.dz = (h01 - h00) / g.step;
  } else {
    hit.h = h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
    hit.dx = (h11 - h01) / g.step;
    hit.dz = (h11 - h10) / g.step;
  }
  return hit;
}

function extractParts(root, def) {
  root.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();

  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    for (const m of [].concat(o.material)) {
      if (def.doubleSide) m.side = THREE.DoubleSide;
      if (def.cutout) {
        m.alphaTest = def.cutout;
        m.transparent = false;
        m.depthWrite = true;
      }
    }
    parts.push({ geometry, material: o.material });
  });

  if (parts.length === 0) throw new Error('GLB không có mesh nào');

  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 1e-6 ? 1 / size.y : 1;
  const fit = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      ),
    );

  let tris = 0;
  for (const p of parts) {
    p.geometry.applyMatrix4(fit);
    const g = p.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  return { parts, tris };
}

export class PropScatter {
  constructor(gen, chunkSize, defs = PROP_DEFS) {
    this.gen = gen;
    this.chunkSize = chunkSize;
    this.defs = defs;
    this.types = [];
  }

  async load() {
    const loader = makeLoader();
    const results = await Promise.all(
      this.defs.map(async (def) => {
        const loaded = await Promise.all(
          def.variants.map(async (v) => {
            try {
              const gltf = await loader.loadAsync(v.url);
              const { parts, tris } = extractParts(gltf.scene, def);
              console.log(
                `[props] ${def.name} <- ${v.url}: ${parts.length} mesh (= ${parts.length} draw call), ` +
                  `${Math.round(tris).toLocaleString()} tam giác/bản`,
              );
              if (tris > 4000) {
                console.warn(
                  `[props] "${v.url}" khá nặng (${Math.round(tris)} tam giác). ` +
                    `Nên giảm poly (Blender Decimate / gltf-transform) hoặc giảm perChunk/drawChunks.`,
                );
              }
              return { weight: v.weight ?? 1, parts };
            } catch (err) {
              console.warn(`[props] Bỏ qua "${v.url}" (không tải/đọc được)`, err);
              return null;
            }
          }),
        );
        const variants = loaded.filter(Boolean);
        if (variants.length === 0) {
          console.warn(`[props] Không có model nào cho "${def.name}" -> bỏ loại này`);
          return null;
        }
        return {
          def,
          salt: hashName(def.name),
          variants,
          vCum: makeCum(variants),
          sCum: makeCum(def.sizes),
        };
      }),
    );
    this.types = results.filter(Boolean);
  }

  populate(cx, cz, group, grid) {
    const S = this.chunkSize;
    const gen = this.gen;
    const out = [];

    for (const { def, salt, variants, vCum, sCum } of this.types) {
      const rand = mulberry32(hash2D(cx, cz, gen.seed + salt));
      const minH = def.minHeight ?? -Infinity;
      const maxH = def.maxHeight ?? Infinity;
      const maxSlope = def.maxSlope ?? Infinity;
      const jitter = def.jitter ?? 0;
      const buckets = new Map();

      for (let i = 0; i < def.perChunk; i++) {
        const lx = rand() * S;
        const lz = rand() * S;
        const rot = rand() * TAU;
        const rv = rand();
        const rs = rand();
        const rt = rand();
        const rj1 = rand();
        const rj2 = rand();

        const g = sampleGrid(grid, lx, lz);
        if (g.h < minH || g.h > maxH) continue;
        if (Math.abs(g.dx) + Math.abs(g.dz) > maxSlope) continue;
        if (def.density && !def.density(gen, cx * S + lx, cz * S + lz)) continue;

        const vi = pick(vCum, rv);
        const size = def.sizes[pick(sCum, rs)];
        const s = size.height[0] + rt * (size.height[1] - size.height[0]);
        const dc = size.drawChunks ?? def.drawChunks ?? Infinity;

        const key = `${vi}|${dc}`;
        let b = buckets.get(key);
        if (!b) {
          b = { vi, dc, data: new Float32Array(def.perChunk * 16), n: 0 };
          buckets.set(key, b);
        }

        dummy.position.set(lx, g.h - (def.sink ?? 0) * s, lz);
        if (def.alignToGround) {
          normal.set(-g.dx, 1, -g.dz).normalize();
          qAlign.setFromUnitVectors(UP, normal);
          qYaw.setFromAxisAngle(UP, rot);
          dummy.quaternion.copy(qAlign).multiply(qYaw);
        } else {
          dummy.rotation.set(0, rot, 0);
        }
        dummy.scale.set(s * (1 + (rj1 * 2 - 1) * jitter), s, s * (1 + (rj2 * 2 - 1) * jitter));
        dummy.updateMatrix();
        dummy.matrix.toArray(b.data, b.n * 16);
        b.n++;
      }

      for (const b of buckets.values()) {
        for (const part of variants[b.vi].parts) {
          // geometry + material dùng chung giữa mọi chunk; mỗi chunk chỉ có bảng ma trận riêng
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, b.n);
          mesh.instanceMatrix.array.set(b.data.subarray(0, b.n * 16));
          mesh.instanceMatrix.needsUpdate = true;
          group.add(mesh);
          out.push({ mesh, drawChunks: b.dc });
        }
      }
    }
    return out;
  }
}

/** Lấy material của mesh đầu tiên trong 1 GLB (dùng nếu bạn có sẵn water.glb). */
export async function loadFirstMaterial(url) {
  try {
    const gltf = await makeLoader().loadAsync(url);
    let mat = null;
    gltf.scene.traverse((o) => {
      if (!mat && o.isMesh) mat = Array.isArray(o.material) ? o.material[0] : o.material;
    });
    return mat;
  } catch (err) {
    console.warn(`[props] Không tải được "${url}" -> dùng nước mặc định`, err);
    return null;
  }
}
import * as THREE from 'three';
import { makeLoader } from './loader';
import { PROP_DEFS } from './propdefs';
import { hashName, makeCum } from './chunkbuild';

// Cấu hình cây / đá / cỏ (model, kích cỡ, mật độ, va chạm...) nằm trong propDefs.js
export { PROP_DEFS };

/** Đổi vật liệu PBR (MeshStandard...) sang Lambert: giữ màu/texture/alpha nhưng tính đèn nhẹ hơn nhiều. */
function toLambert(m) {
  if (Array.isArray(m)) return m.map(toLambert);
  if (m.isMeshLambertMaterial || m.isMeshBasicMaterial) return m;
  return new THREE.MeshLambertMaterial({
    color: m.color ? m.color.clone() : 0xffffff,
    map: m.map ?? null,
    alphaTest: m.alphaTest ?? 0,
    transparent: m.transparent ?? false,
    opacity: m.opacity ?? 1,
    side: m.side,
    vertexColors: m.vertexColors ?? false,
    emissive: m.emissive ? m.emissive.clone() : 0x000000,
    emissiveMap: m.emissiveMap ?? null,
  });
}

/**
 * Gom mọi mesh trong GLB thành danh sách {geometry, material} đã "nướng" sẵn transform,
 * chuẩn hoá về CAO 1 MÉT, chân ở y = 0, căn giữa X/Z.
 * Mỗi phần (vd: thân + tán lá) thành 1 InstancedMesh riêng => 1 draw call mỗi phần (toàn cục, không theo chunk).
 */
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
    p.materialSimple = toLambert(p.material); // dùng ở mức chất lượng thấp / vừa
    const g = p.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  // nửa bề ngang / chiều cao (sau chuẩn hoá) - dùng để tính bán kính va chạm của đá
  const halfW = size.y > 1e-6 ? Math.max(size.x, size.z) / 2 / size.y : 0.3;
  return { parts, tris, halfW };
}

/**
 * Nạp model GLB cho các loại prop (1 lần). Việc ĐẶT cây/đá lên map làm trong worker (chunkBuild.js).
 * Variant nào không tải được thì bỏ qua; cả loại không có variant nào thì bỏ loại đó.
 */
export class PropScatter {
  constructor(gen, chunkSize, defs = PROP_DEFS) {
    this.gen = gen;
    this.chunkSize = chunkSize;
    this.defs = defs;
    this.types = []; // [{ defIndex, def, salt, variants: [{ weight, parts, halfW }], vCum, sCum }]
  }

  async load() {
    const loader = makeLoader();
    const results = await Promise.all(
      this.defs.map(async (def, defIndex) => {
        const loaded = await Promise.all(
          def.variants.map(async (v) => {
            try {
              const gltf = await loader.loadAsync(v.url);
              const { parts, tris, halfW } = extractParts(gltf.scene, def);
              console.log(
                `[props] ${def.name} <- ${v.url}: ${parts.length} mesh (= ${parts.length} draw call), ` +
                  `${Math.round(tris).toLocaleString()} tam giác/bản`,
              );
              if (tris > 4000) {
                console.warn(
                  `[props] "${v.url}" khá nặng (${Math.round(tris)} tam giác). ` +
                    `Nên giảm poly (Blender Decimate / gltf-transform) hoặc dùng mức chất lượng thấp hơn.`,
                );
              }
              return { weight: v.weight ?? 1, parts, halfW };
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
        return { defIndex, def, salt: hashName(def.name), variants, vCum: makeCum(variants), sCum: makeCum(def.sizes) };
      }),
    );
    this.types = results.filter(Boolean);
  }

  /** Thông tin gửi cho worker để đặt prop (chỉ số liệu thuần, không có geometry). */
  info() {
    return this.types.map((t) => ({
      defIndex: t.defIndex,
      salt: t.salt,
      vCum: t.vCum,
      sCum: t.sCum,
      halfW: t.variants.map((v) => v.halfW),
    }));
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
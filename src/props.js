import { makeLoader } from './loader';
import { extractParts } from './modelutils';
import { PROP_DEFS } from './propdefs';
import { hashName, makeCum } from './chunkbuild';

// Cấu hình cây / đá / cỏ (model, kích cỡ, mật độ, va chạm...) nằm trong propdefs.js
export { PROP_DEFS };

/**
 * Nạp model GLB cho các loại prop (1 lần). Việc ĐẶT cây/đá lên map làm trong worker (chunkbuild.js).
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
              const { parts, tris, halfW } = extractParts(gltf.scene, def); // def có doubleSide / cutout
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
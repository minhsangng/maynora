import * as THREE from 'three';
import { makeLoader } from './loader';
import { ITEM_DEFS } from './fooddefs';
import { extractParts } from './modelutils';

/** Hình khối thay thế khi chưa có model: cao đúng 1 đơn vị, đáy ở y = 0 (giống model đã chuẩn hoá). */
function fallbackParts(def) {
  let geometry;
  if (def.shape === 'cone') geometry = new THREE.ConeGeometry(0.35, 1, 8).translate(0, 0.5, 0);
  else if (def.shape === 'box') geometry = new THREE.BoxGeometry(1.6, 1, 1).translate(0, 0.5, 0);
  else geometry = new THREE.SphereGeometry(0.5, 10, 8).translate(0, 0.5, 0);
  const material = new THREE.MeshBasicMaterial({ color: def.color ?? 0xffffff });
  return [{ geometry, material, materialSimple: material }];
}

/**
 * Nạp model GLB của các vật phẩm (trái cây mọc tự nhiên + chiến lợi phẩm). File nào chưa có thì dùng hình khối
 * đơn giản, nên thêm model dần dần được. Mỗi món = danh sách mesh đã chuẩn hoá cao 1 đơn vị (nhân với `size` khi dùng).
 */
export class ItemLibrary {
  constructor(defs = ITEM_DEFS) {
    this.defs = defs;
    this.models = new Map();
  }

  async load() {
    const loader = makeLoader();
    await Promise.all(
      Object.entries(this.defs).map(async ([id, def]) => {
        let parts = null;
        if (def.url) {
          try {
            const gltf = await loader.loadAsync(def.url);
            const r = extractParts(gltf.scene, {});
            parts = r.parts;
            console.log(`[items] ${def.name} <- ${def.url}: ${r.parts.length} mesh, ${Math.round(r.tris)} tam giác`);
          } catch {
            console.warn(`[items] Chưa có "${def.url}" -> dùng hình khối đơn giản cho "${def.name}"`);
          }
        }
        this.models.set(id, parts ?? fallbackParts(def));
      }),
    );
  }

  /** Danh sách {geometry, material, materialSimple} của món `id`. */
  parts(id) {
    return this.models.get(id) ?? [];
  }
}
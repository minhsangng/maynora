const PREF_KEY = 'infinite-terrain-quality';

/**
 * Các mức chất lượng. Số nào cũng đổi được; game tự hạ mức khi FPS thấp, và bạn đổi tay bằng phím [ ] .
 *  pixelRatio        độ phân giải render (tối đa = tỉ lệ pixel của màn hình)
 *  viewRadius        tầm nhìn (số chunk)           resolution   độ mịn mặt đất
 *  propScale         nhân số cây / đá              grassScale   nhân số cỏ (0 = tắt)
 *  drawScale         nhân khoảng cách vẽ cây/đá    foodScale    nhân số thực phẩm
 *  bake              nướng ánh sáng vào mặt đất, không tính đèn từng pixel
 *  simpleMaterials   model cây/đá dùng vật liệu Lambert thay vì PBR
 *  simpleWater       mặt nước đặc, không trong suốt, không normal map
 *  wildMax           số mod hoang dã tối đa
 */
export const TIERS = [
  { id: 'low', name: 'Thấp', pixelRatio: 0.85, viewRadius: 3, resolution: 24, propScale: 0.3, grassScale: 0, drawScale: 0.6, foodScale: 0.8, bake: true, simpleMaterials: true, simpleWater: true, wildMax: 3 },
  { id: 'med', name: 'Vừa', pixelRatio: 1.0, viewRadius: 4, resolution: 32, propScale: 0.55, grassScale: 0.4, drawScale: 0.8, foodScale: 1, bake: false, simpleMaterials: true, simpleWater: true, wildMax: 4 },
  { id: 'high', name: 'Cao', pixelRatio: 1.25, viewRadius: 5, resolution: 40, propScale: 0.85, grassScale: 0.8, drawScale: 1, foodScale: 1, bake: false, simpleMaterials: false, simpleWater: false, wildMax: 6 },
  { id: 'ultra', name: 'Tối đa', pixelRatio: 2, viewRadius: 6, resolution: 48, propScale: 1, grassScale: 1, drawScale: 1.2, foodScale: 1, bake: false, simpleMaterials: false, simpleWater: false, wildMax: 6 },
];

export const DEFAULT_TIER = 1; // "Vừa"

export function loadTierIndex() {
  try {
    const v = Number(localStorage.getItem(PREF_KEY));
    if (Number.isInteger(v) && v >= 0 && v < TIERS.length) return v;
  } catch {
    /* bỏ qua */
  }
  return DEFAULT_TIER;
}

export function saveTierIndex(i) {
  try {
    localStorage.setItem(PREF_KEY, String(i));
  } catch {
    /* bỏ qua */
  }
}

/** Phần cấu hình dành cho ChunkManager. */
export function chunkConfig(t) {
  return {
    viewRadius: t.viewRadius,
    resolution: t.resolution,
    propScale: t.propScale,
    grassScale: t.grassScale,
    drawScale: t.drawScale,
    foodScale: t.foodScale,
    bake: t.bake,
    simpleMaterials: t.simpleMaterials,
  };
}s
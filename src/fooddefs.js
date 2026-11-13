import { WATER_LEVEL } from './terraingen';

/**
 * Thực phẩm mọc tự nhiên trên đảo: đi tới gần để nhặt, nhấn E để ăn.
 * Rời khỏi vùng đó rồi quay lại thì mọc lại.
 *  hunger / stamina   hồi bao nhiêu điểm độ đói / thể lực khi ăn
 *  shape, size        hình dạng đơn giản (sphere | cone) và kích cỡ (mét)
 *  perChunk           số lần "thử đặt" mỗi chunk (số thực tế ít hơn vì bị lọc theo luật)
 */
export const FOOD_DEFS = [
  {
    id: 'apple', name: 'Táo', hunger: 22, stamina: 8, color: 0xe53935, shape: 'sphere', size: 0.45,
    perChunk: 7, minHeight: WATER_LEVEL + 2, maxHeight: 40, maxSlope: 1.2,
    density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold - 0.15, // gần khu rừng
  },
  {
    id: 'berry', name: 'Quả mọng', hunger: 10, stamina: 14, color: 0x7e57c2, shape: 'sphere', size: 0.3,
    perChunk: 9, minHeight: WATER_LEVEL + 1.5, maxHeight: 45, maxSlope: 1.5,
  },
  {
    id: 'mushroom', name: 'Nấm', hunger: 16, stamina: 4, color: 0xffb74d, shape: 'cone', size: 0.4,
    perChunk: 5, minHeight: WATER_LEVEL + 2, maxHeight: 60, maxSlope: 1.5,
    density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold - 0.3,
  },
];

/** Vật phẩm không mọc tự nhiên: nhận từ trận đấu hoặc quà khởi đầu. */
const EXTRA = {
  meat: { name: 'Thịt', hunger: 45, stamina: 10 },
  bread: { name: 'Bánh mì', hunger: 30, stamina: 10 },
};

/** Tra cứu mọi loại thực phẩm theo id. */
export const FOOD_INFO = {
  ...Object.fromEntries(FOOD_DEFS.map((d) => [d.id, { name: d.name, hunger: d.hunger, stamina: d.stamina }])),
  ...EXTRA,
};
import { WATER_LEVEL } from './terraingen';

/**
 * TẤT CẢ vật phẩm ăn được. Mỗi món:
 *  name             tên hiển thị
 *  url              file GLB của món này (đặt trong public/models/items/). Không có file -> dùng hình khối đơn giản
 *                   (shape: sphere | cone | box) tô màu `color`, nên chưa có model vẫn chơi được.
 *                   Model tự được chuẩn hoá: cao đúng `size` mét, đáy đặt sát đất.
 *  hunger, stamina  hồi bao nhiêu điểm độ đói / thể lực khi ăn
 *  size             chiều cao trong game (mét)
 *  grow             (tuỳ chọn) có thì món này MỌC TỰ NHIÊN trên đảo để nhặt:
 *                     perChunk = số lần thử đặt mỗi chunk, minHeight/maxHeight/maxSlope/density = luật chỗ mọc.
 *                   Không có `grow` = chỉ nhận từ trận đấu (xem `drops` của từng mod trong mods.js) hoặc quà khởi đầu.
 * Thêm món mới: thêm 1 phần tử vào đây (và thêm file model nếu có).
 */
export const ITEM_DEFS = {
  red_apple: {
    name: 'Táo đỏ', url: '/models/items/red_apple.glb', hunger: 22, stamina: 8, color: 0xe53935, shape: 'sphere', size: 0.5,
    grow: { perChunk: 7, minHeight: WATER_LEVEL + 2, maxHeight: 40, maxSlope: 1.2, density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold - 0.15 }, // gần khu rừng
  },
  green_apple: {
    name: 'Táo xanh', url: '/models/items/green_apple.glb', hunger: 22, stamina: 8, color: 0xe53935, shape: 'sphere', size: 0.5,
    grow: { perChunk: 7, minHeight: WATER_LEVEL + 2, maxHeight: 40, maxSlope: 1.2, density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold - 0.15 }, // gần khu rừng
  },
  blueberry: {
    name: 'Quả mọng', url: '/models/items/blueberry.glb', hunger: 10, stamina: 14, color: 0x7e57c2, shape: 'sphere', size: 0.4,
    grow: { perChunk: 9, minHeight: WATER_LEVEL + 1.5, maxHeight: 45, maxSlope: 1.5 },
  },
  strawberry: {
    name: 'Dâu tây', url: '/models/items/strawberry.glb', hunger: 10, stamina: 14, color: 0x7e57c2, shape: 'sphere', size: 0.4,
    grow: { perChunk: 9, minHeight: WATER_LEVEL + 1.5, maxHeight: 45, maxSlope: 1.5 },
  },
  mushroom: {
    name: 'Nấm', url: '/models/items/mushroom.glb', hunger: 16, stamina: 4, color: 0xffb74d, shape: 'cone', size: 0.5,
    grow: { perChunk: 5, minHeight: WATER_LEVEL + 2, maxHeight: 60, maxSlope: 1.5, density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold - 0.3 },
  }/* ,
  meat: { name: 'Thịt', url: '/models/items/meat.glb', hunger: 45, stamina: 10, color: 0xc0392b, shape: 'sphere', size: 0.55 },
  bread: { name: 'Bánh mì', url: '/models/items/bread.glb', hunger: 30, stamina: 10, color: 0xd9a441, shape: 'box', size: 0.4 }, */
};

/** Các món mọc tự nhiên (dạng phẳng, dùng trong worker để đặt lên map). */
export const FOOD_DEFS = Object.entries(ITEM_DEFS)
  .filter(([, d]) => d.grow)
  .map(([id, d]) => ({ id, name: d.name, size: d.size, ...d.grow }));

/** Tra cứu hiệu ứng ăn của mọi món theo id. */
export const FOOD_INFO = Object.fromEntries(
  Object.entries(ITEM_DEFS).map(([id, d]) => [id, { name: d.name, hunger: d.hunger, stamina: d.stamina }]),
);
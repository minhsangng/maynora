import { WATER_LEVEL } from './terraingen';

/**
 * Mỗi phần tử = 1 loại vật thể rải trên map (cây, đá, cỏ...).
 *
 *  name        tên (làm "salt" cho random -> thêm/bớt loại khác không làm đổi vị trí loại này)
 *  variants    các model GLB khác nhau của loại này (đa dạng hình dáng).
 *              { url, weight }: weight càng lớn càng hay xuất hiện.
 *  sizes       các LỚP KÍCH THƯỚC: { height: [min, max] (mét), weight, drawChunks? }
 *              Model tự được chuẩn hoá về cao 1m rồi scale theo `height` ở đây, nên model gốc to nhỏ
 *              thế nào cũng được. drawChunks riêng cho từng lớp: vật nhỏ chỉ vẽ gần, vật to vẽ xa hơn.
 *  jitter      độ méo ngẫu nhiên theo chiều ngang (0.15 = ±15%) để 2 vật cùng loại không giống hệt nhau
 *  perChunk    số lần "thử đặt" trong mỗi chunk (số thực tế ít hơn vì bị lọc theo luật bên dưới)
 *  minHeight / maxHeight   khoảng độ cao cho phép
 *  maxSlope    độ dốc tối đa (|dh/dx| + |dh/dz|). 0.3 = gần phẳng, 1.2 = khá dốc
 *  density     (gen, x, z) => boolean, ví dụ chỉ mọc ở vùng rừng
 *  alignToGround  nghiêng theo mặt đất (hợp với đá)
 *  sink        chôn xuống đất bao nhiêu % chiều cao (0.1 = 10%)
 *  drawChunks  bán kính (chunk) vẽ mặc định nếu lớp kích thước không khai báo riêng
 *  doubleSide  vẽ 2 mặt (cỏ / lá dạng tấm phẳng)
 *  groundCover  đánh dấu cỏ/hoa: mức chất lượng thấp sẽ giảm hoặc tắt hẳn loại này
 *  cutout      ngưỡng alphaTest (vd 0.5) cho cỏ/lá có texture trong suốt
 *
 * Lưu ý hiệu năng: số draw call/chunk = (số variant) x (số mức drawChunks khác nhau) x (số mesh trong model).
 * Chỉ có 1-2 file model thì cứ để 1-2 variant, file nào không tồn tại sẽ tự bị bỏ qua.
 */
export const PROP_DEFS = [
  {
    name: 'tree',
    variants: [
      { url: '/models/tree.glb', weight: 4 },
      { url: '/models/tree.glb', weight: 3 },
      { url: '/models/tree.glb', weight: 2 },
    ],
    sizes: [
      { height: [3, 5], weight: 3, drawChunks: 2.5 }, // cây nhỏ / cây non
      { height: [6, 9], weight: 5, drawChunks: 3.5 }, // cây vừa
      { height: [10, 15], weight: 2, drawChunks: 5 }, // cây cao
    ],
    jitter: 0.12,
    perChunk: 80,
    minHeight: WATER_LEVEL + 2,
    maxHeight: 42,
    maxSlope: 1.2,
    density: (gen, x, z) => gen.forest(x, z) > gen.forestThreshold, // ngưỡng rừng riêng của từng đảo
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
    groundCover: true, // lớp phủ mặt đất: số lượng theo tuỳ chọn cỏ của mức chất lượng
  },
];
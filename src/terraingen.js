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
    this.radius = def.radius ?? 600; // bán kính "danh nghĩa" của đảo (mét)
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
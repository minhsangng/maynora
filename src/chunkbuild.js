import { WATER_LEVEL, SEABED_COLOR } from './terraingen';
import { PROP_DEFS } from './propdefs';
import { FOOD_DEFS } from './fooddefs';
import { hash2D, mulberry32 } from './noise';

/**
 * Dựng dữ liệu của 1 chunk (mặt đất + vị trí cây/đá/cỏ + thực phẩm) hoàn toàn bằng số liệu thuần:
 * KHÔNG dùng three, nên chạy được trong Web Worker => luồng chính không còn bị giật khi nạp chunk mới.
 * Kết quả chỉ phụ thuộc (gen, cfg, cx, cz) nên chunk dựng lại lúc nào cũng y hệt.
 */

const TAU = Math.PI * 2;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Màu: giống THREE.Color(hex) - đổi sRGB sang không gian tuyến tính (vertex color được shader coi là tuyến tính)
const srgb = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLin = (hex) => [srgb(((hex >> 16) & 255) / 255), srgb(((hex >> 8) & 255) / 255), srgb((hex & 255) / 255)];
const GRASS = hexLin(0x5c9e3a);
const HIGH_GRASS = hexLin(0x3f6b34);
const SAND = hexLin(0xd9c58f);
const ROCK = hexLin(0x7d7a74);
const SNOW = hexLin(0xf4f7fb);
const SEABED = hexLin(SEABED_COLOR);

// Hướng mặt trời (khớp DirectionalLight ở main.js) - dùng khi "nướng" ánh sáng vào màu đỉnh
const LL = Math.hypot(100, 200, 60);
const SUN = [100 / LL, 200 / LL, 60 / LL];

export function hashName(name) {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return h;
}

/** Bảng xác suất cộng dồn theo weight, và hàm chọn theo số ngẫu nhiên r trong [0,1). */
export function makeCum(items) {
  const total = items.reduce((a, it) => a + (it.weight ?? 1), 0);
  let acc = 0;
  return items.map((it) => (acc += (it.weight ?? 1) / total));
}
export function pick(cum, r) {
  for (let i = 0; i < cum.length; i++) if (r <= cum[i]) return i;
  return cum.length - 1;
}

function mix(o, c, t) {
  o[0] += (c[0] - o[0]) * t;
  o[1] += (c[1] - o[1]) * t;
  o[2] += (c[2] - o[2]) * t;
}

function colorAt(h, ny, o) {
  o[0] = GRASS[0];
  o[1] = GRASS[1];
  o[2] = GRASS[2];
  mix(o, HIGH_GRASS, smoothstep(8, 35, h));
  mix(o, SAND, 1 - smoothstep(WATER_LEVEL + 0.3, WATER_LEVEL + 2.2, h));
  const rockT = smoothstep(0.1, 0.28, 1 - ny); // dốc đứng -> đá
  mix(o, ROCK, rockT);
  mix(o, SNOW, smoothstep(55, 70, h) * (1 - 0.6 * rockT)); // đỉnh cao -> tuyết
  mix(o, SEABED, smoothstep(WATER_LEVEL - 0.5, WATER_LEVEL - 5, h)); // dưới nước -> màu đáy biển
}

const hit = { h: 0, dx: 0, dz: 0 };
/** Độ cao + độ dốc tại điểm bất kỳ trong chunk, nội suy đúng theo 2 tam giác của mesh. */
function sampleGrid(g, lx, lz) {
  const fx = lx / g.step + 1; // +1 vì lưới có viền 1 ô
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

/** Ghi ma trận 4x4 (cột trước, giống THREE.Matrix4.compose) vào te[o..o+15]. */
function setMatrix(te, o, px, py, pz, x, y, z, w, sx, sy, sz) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  te[o] = (1 - (yy + zz)) * sx;
  te[o + 1] = (xy + wz) * sx;
  te[o + 2] = (xz - wy) * sx;
  te[o + 3] = 0;
  te[o + 4] = (xy - wz) * sy;
  te[o + 5] = (1 - (xx + zz)) * sy;
  te[o + 6] = (yz + wx) * sy;
  te[o + 7] = 0;
  te[o + 8] = (xz + wy) * sz;
  te[o + 9] = (yz - wx) * sz;
  te[o + 10] = (1 - (xx + yy)) * sz;
  te[o + 11] = 0;
  te[o + 12] = px;
  te[o + 13] = py;
  te[o + 14] = pz;
  te[o + 15] = 1;
}

function placeProps(gen, cfg, propInfo, cx, cz, grid) {
  const S = cfg.chunkSize;
  const ox = cx * S;
  const oz = cz * S;
  const out = [];

  for (let ti = 0; ti < propInfo.length; ti++) {
    const info = propInfo[ti];
    const def = PROP_DEFS[info.defIndex];
    const attempts = Math.floor(def.perChunk * cfg.propScale * (def.groundCover ? cfg.grassScale : 1));
    if (attempts <= 0) continue;
    const rand = mulberry32(hash2D(cx, cz, gen.seed + info.salt));
    const minH = def.minHeight ?? -Infinity;
    const maxH = def.maxHeight ?? Infinity;
    const maxSlope = def.maxSlope ?? Infinity;
    const jitter = def.jitter ?? 0;
    const buckets = new Map(); // gộp theo (variant, drawChunks)

    for (let i = 0; i < attempts; i++) {
      // Mỗi lượt luôn rút đủ 8 số random dù vật thể có bị loại hay không:
      // đổi số lượng (mức chất lượng) thì các vật thể đầu tiên vẫn đứng nguyên chỗ cũ.
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
      const wx = ox + lx;
      const wz = oz + lz;
      if (def.density && !def.density(gen, wx, wz)) continue;

      const vi = pick(info.vCum, rv);
      const size = def.sizes[pick(info.sCum, rs)];
      const s = size.height[0] + rt * (size.height[1] - size.height[0]); // chiều cao thực (mét)
      const dc = size.drawChunks ?? def.drawChunks ?? Infinity;

      const key = `${vi}|${dc}`;
      let b = buckets.get(key);
      if (!b) {
        b = { ti, vi, dc, data: new Float32Array(attempts * 16), n: 0 };
        buckets.set(key, b);
      }

      let qx = 0;
      let qy = Math.sin(rot / 2);
      let qz = 0;
      let qw = Math.cos(rot / 2);
      if (def.alignToGround) {
        // nghiêng theo mặt đất: q = qAlign * qYaw, qAlign xoay (0,1,0) về pháp tuyến
        const nx = -g.dx;
        const ny = 1;
        const nz = -g.dz;
        const nl = Math.hypot(nx, ny, nz);
        let ax = nz / nl;
        let ay = 0;
        let az = -nx / nl;
        let aw = 1 + ny / nl;
        const al = Math.hypot(ax, ay, az, aw);
        ax /= al; ay /= al; az /= al; aw /= al;
        const bx = qx, by = qy, bz = qz, bw = qw;
        qx = aw * bx + ax * bw + ay * bz - az * by;
        qy = aw * by - ax * bz + ay * bw + az * bx;
        qz = aw * bz + ax * by - ay * bx + az * bw;
        qw = aw * bw - ax * bx - ay * by - az * bz;
      }
      setMatrix(
        b.data, b.n * 16,
        wx, g.h - (def.sink ?? 0) * s, wz,
        qx, qy, qz, qw,
        s * (1 + (rj1 * 2 - 1) * jitter), s, s * (1 + (rj2 * 2 - 1) * jitter),
      );
      b.n++;
    }

    for (const b of buckets.values()) {
      out.push({ ti: b.ti, vi: b.vi, dc: b.dc, n: b.n, data: b.data.slice(0, b.n * 16) });
    }
  }
  return out;
}

function placeFood(gen, cfg, cx, cz, grid) {
  const S = cfg.chunkSize;
  const ox = cx * S;
  const oz = cz * S;
  const out = [];
  for (let ti = 0; ti < FOOD_DEFS.length; ti++) {
    const def = FOOD_DEFS[ti];
    const attempts = Math.floor(def.perChunk * (cfg.foodScale ?? 1));
    if (attempts <= 0) continue;
    const rand = mulberry32(hash2D(cx, cz, gen.seed + hashName(`food_${def.id}`)));
    const data = new Float32Array(attempts * 16);
    const pos = new Float32Array(attempts * 3);
    let n = 0;
    for (let i = 0; i < attempts; i++) {
      const lx = rand() * S;
      const lz = rand() * S;
      const rot = rand() * TAU;
      const g = sampleGrid(grid, lx, lz);
      if (g.h < def.minHeight || g.h > def.maxHeight) continue;
      if (Math.abs(g.dx) + Math.abs(g.dz) > def.maxSlope) continue;
      const wx = ox + lx;
      const wz = oz + lz;
      if (def.density && !def.density(gen, wx, wz)) continue;
      const y = g.h + def.size * 0.6;
      setMatrix(data, n * 16, wx, y, wz, 0, Math.sin(rot / 2), 0, Math.cos(rot / 2), def.size, def.size, def.size);
      pos[n * 3] = wx;
      pos[n * 3 + 1] = y;
      pos[n * 3 + 2] = wz;
      n++;
    }
    if (n > 0) out.push({ ti, n, data: data.slice(0, n * 16), pos: pos.slice(0, n * 3) });
  }
  return out;
}

/**
 * cfg: { chunkSize, resolution, propScale, grassScale, foodScale, bake }
 * propInfo: [{ defIndex, salt, vCum, sCum }] - các loại prop đã tải được model (do luồng chính gửi sang)
 */
export function buildChunk(gen, cfg, propInfo, cx, cz) {
  const S = cfg.chunkSize;
  const R = cfg.resolution;
  const step = S / R;
  const N = R + 1; // số vertex / cạnh
  const stride = R + 3; // lưới độ cao có viền 1 ô mỗi phía để tính normal
  const ox = cx * S;
  const oz = cz * S;

  // Lấy mẫu độ cao theo TOẠ ĐỘ THẾ GIỚI. Viết (i * S) / R để vertex biên của 2 chunk kề nhau khớp tuyệt đối.
  const hs = new Float32Array(stride * stride);
  for (let gz = 0; gz < stride; gz++) {
    for (let gx = 0; gx < stride; gx++) {
      hs[gz * stride + gx] = gen.height(ox + ((gx - 1) * S) / R, oz + ((gz - 1) * S) / R);
    }
  }

  const pos = new Float32Array(N * N * 3);
  const nor = new Float32Array(N * N * 3);
  const col = new Float32Array(N * N * 3);
  const c = [0, 0, 0];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const g = (iz + 1) * stride + (ix + 1);
      const h = hs[g];
      // normal từ chênh lệch độ cao của ô lân cận (kể cả ô nằm ngoài chunk) => liền mạch giữa các chunk
      const nx = (hs[g - 1] - hs[g + 1]) / (2 * step);
      const nz = (hs[g - stride] - hs[g + stride]) / (2 * step);
      const inv = 1 / Math.hypot(nx, 1, nz);
      const i3 = (iz * N + ix) * 3;
      pos[i3] = ix * step; // toạ độ cục bộ trong chunk (tránh lỗi số thực khi đi xa)
      pos[i3 + 1] = h;
      pos[i3 + 2] = iz * step;
      nor[i3] = nx * inv;
      nor[i3 + 1] = inv;
      nor[i3 + 2] = nz * inv;
      colorAt(h, inv, c);
      if (cfg.bake) {
        // Mức chất lượng thấp: nướng sẵn ánh sáng vào màu để khỏi tính đèn từng pixel
        const nd = Math.max(0, nx * inv * SUN[0] + inv * SUN[1] + nz * inv * SUN[2]);
        const sh = 0.2 + 0.75 * nd;
        c[0] *= sh;
        c[1] *= sh;
        c[2] *= sh;
      }
      col[i3] = c[0];
      col[i3 + 1] = c[1];
      col[i3 + 2] = c[2];
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }

  const grid = { hs, stride, step };
  return {
    cx,
    cz,
    pos,
    nor,
    col,
    minY,
    maxY,
    props: placeProps(gen, cfg, propInfo, cx, cz, grid),
    food: placeFood(gen, cfg, cx, cz, grid),
  };
}

/** Danh sách buffer để chuyển (transfer) sang luồng chính không tốn thời gian sao chép. */
export function transferList(r) {
  const t = [r.pos.buffer, r.nor.buffer, r.col.buffer];
  for (const p of r.props) t.push(p.data.buffer);
  for (const f of r.food) t.push(f.data.buffer, f.pos.buffer);
  return t;
}
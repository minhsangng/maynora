import * as THREE from 'three';
import { mulberry32 } from './noise';
import { SEA_FLOOR, SEABED_COLOR } from './terrain';

const TAU = Math.PI * 2;

// Các sóng (fx, fy là SỐ NGUYÊN) -> normal map lặp khít khi ghép ô, không thấy đường nối
const WAVES = [
  [1, 0], [0, 1], [2, 1], [1, 2], [3, 2], [2, 3],
  [5, 3], [3, 5], [7, 4], [4, 7], [-2, 3], [3, -4],
];

/** Sinh dữ liệu normal map nước (thuần tính toán, không cần file ảnh). */
export function buildNormalData(size = 256, strength = 0.025) {
  const rand = mulberry32(777);
  const waves = WAVES.map(([fx, fy]) => ({
    fx,
    fy,
    a: 1 / Math.hypot(fx, fy), // sóng nhỏ thì biên độ nhỏ
    ph: rand() * TAU,
  }));
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let dhx = 0;
      let dhy = 0;
      for (const w of waves) {
        const c = Math.cos(TAU * (w.fx * u + w.fy * v) + w.ph) * w.a * TAU;
        dhx += c * w.fx;
        dhy += c * w.fy;
      }
      let nx = -dhx * strength;
      let ny = -dhy * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function makeProceduralNormalMap(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(buildNormalData(size), size, size), 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // normal map không phải màu
  return tex;
}

/** Tải normal map nước có sẵn (ảnh tileable). Lỗi thì trả null -> dùng bản tự sinh. */
export async function loadWaterNormal(url) {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  } catch (err) {
    console.warn(`[water] Không tải được "${url}" -> dùng normal map tự sinh`, err);
    return null;
  }
}

function tileTextures(material, repeat) {
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
    const tex = material[key];
    if (!tex) continue;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  }
}

/**
 * Mặt nước = 1 tấm phẳng khổng lồ đi theo player (KHÔNG cần model nước).
 * Ưu tiên: material từ GLB (nếu có) > normal map tải về > normal map tự sinh.
 */
export function createWater({ size, tile = 12, level = 0, material = null, normalMap = null }) {
  const repeat = size / tile;
  let mat = material;
  if (!mat) {
    mat = new THREE.MeshPhongMaterial({
      color: 0x2a7fb8,
      specular: 0xbfd8ee,
      shininess: 90,
      transparent: true,
      opacity: 0.8,
      normalMap: normalMap ?? makeProceduralNormalMap(),
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
  }
  tileTextures(mat, repeat);
  // Nước "đơn giản" cho mức chất lượng thấp: đặc, không trong suốt, không normal map => ít tốn GPU nhất
  const matSimple = new THREE.MeshLambertMaterial({ color: 0x2a7fb8 });
  let current = mat;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);

  // Đáy biển: 1 tấm phẳng duy nhất thay cho mọi chunk ngoài khơi (rẻ hơn rất nhiều).
  // Thấp hơn SEA_FLOOR 0.5m để không bị "đánh nhau" (z-fighting) với chunk đáy biển thật.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: SEABED_COLOR }),
  );

  return {
    mesh,
    floor,
    setSimple(on) {
      current = on ? matSimple : mat;
      mesh.material = current;
    },
    update(dt, px, pz) {
      // Dịch từng bước đúng bằng 1 ô texture => texture đứng yên theo thế giới, không "trượt"
      mesh.position.set(Math.round(px / tile) * tile, level, Math.round(pz / tile) * tile);
      floor.position.set(px, SEA_FLOOR - 0.5, pz);
      const tex = current === mat ? (mat.normalMap ?? mat.map) : null;
      if (tex) {
        tex.offset.x = (tex.offset.x + dt * 0.02) % 1; // nước chảy nhẹ
        tex.offset.y = (tex.offset.y + dt * 0.012) % 1;
      }
    },
  };
}
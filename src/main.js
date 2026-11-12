import * as THREE from 'three';
import { ChunkManager, TerrainGenerator, WATER_LEVEL } from './terrain';
import { Player } from './player';
import { PropScatter, loadFirstMaterial } from './props';
import { createWater, loadWaterNormal } from './water';

const SEED = 12345; // đổi seed = đổi cả thế giới; cùng seed = luôn cùng thế giới
const CHUNK_SIZE = 64;
const VIEW_RADIUS = 6; // chunk. Muốn nhẹ hơn thì giảm số này (số chunk ~ bình phương)

// Sương mù: tính theo tỉ lệ của tầm nhìn. NEAR càng lớn thì càng ít mờ.
const FOG_NEAR = 0.55;
const FOG_FAR = 0.95;

// Độ phân giải: không bao giờ hạ xuống dưới MIN (hạ thấp hơn 1 sẽ làm ảnh bị nhoè).
// Máy yếu thì có thể hạ MIN xuống 0.75.
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
const MIN_PIXEL_RATIO = 1;
// Màn hình thường (DPR 1) cần khử răng cưa; màn hình độ phân giải cao thì không cần
const ANTIALIAS = window.devicePixelRatio < 1.5;

// --- Nước ---------------------------------------------------------------
// KHÔNG cần model nước. Mặc định dùng normal map tự sinh bằng code.
// Muốn đẹp hơn: đặt ảnh normal map nước (tileable) vào public/textures/ rồi điền đường dẫn.
const WATER_NORMAL_MAP = null; // ví dụ '/textures/water_normal.jpg'
const WATER_MODEL = null; // nếu có water.glb thì chỉ lấy MATERIAL của nó, ví dụ '/models/water.glb'
const WATER_TILE = 12; // mét / 1 lần lặp texture nước

// --- Nhân vật -----------------------------------------------------------
const PLAYER_MODEL = '/models/mayn.glb';
const PLAYER_OPTS = {
  height: 1.75,
  facing: Math.PI, // nhân vật đi lùi / quay lưng thì đổi 0 <-> Math.PI
  // Tên clip tự nhận diện (idle/walk/run/jump). Tên lạ thì ghi đè ở đây, xem console để biết tên:
  clips: { idle: 'Walking', walk: 'Walking', run: 'Walking', jump: 'T-Pose.001', chill: 'Sleeping Idle', attack: 'T-Pose.001' },
};

// --- Renderer / Scene ---------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: ANTIALIAS, powerPreference: 'high-performance' });
let pixelRatio = Math.min(MAX_PIXEL_RATIO, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color(0x9ec9ee);
scene.background = sky;

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x4a5d3a, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(100, 200, 60);
scene.add(sun);

// --- HUD ----------------------------------------------------------------
const hud = document.createElement('div');
hud.id = 'hud';
hud.textContent = 'Đang tải model...';
document.body.appendChild(hud);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function start() {
  const terrain = new TerrainGenerator(SEED);
  const props = new PropScatter(terrain, CHUNK_SIZE); // danh sách model chỉnh trong props.js
  const player = new Player(camera, renderer.domElement, terrain);
  scene.add(player.body);

  // Tải model TRƯỚC khi tạo chunk đầu tiên (chunk cần model để rải)
  const [waterMat, waterNormal] = await Promise.all([
    WATER_MODEL ? loadFirstMaterial(WATER_MODEL) : null,
    WATER_NORMAL_MAP ? loadWaterNormal(WATER_NORMAL_MAP) : null,
    props.load(),
    player.loadModel(PLAYER_MODEL, PLAYER_OPTS),
  ]);

  const chunks = new ChunkManager(
    scene,
    terrain,
    { chunkSize: CHUNK_SIZE, resolution: 48, viewRadius: VIEW_RADIUS },
    props,
  );

  // Sương mù che chỗ chunk mới "mọc" ở rìa tầm nhìn
  scene.fog = new THREE.Fog(sky, chunks.viewDistance * FOG_NEAR, chunks.viewDistance * FOG_FAR);
  camera.far = chunks.viewDistance * 1.2;
  camera.updateProjectionMatrix();

  const water = createWater({
    size: chunks.viewDistance * 3,
    tile: WATER_TILE,
    level: WATER_LEVEL,
    material: waterMat,
    normalMap: waterNormal,
  });
  scene.add(water.mesh);

  // Tìm chỗ spawn trên cạn
  let sx = 0;
  for (let i = 0; i < 1000 && terrain.height(sx, 0) < WATER_LEVEL + 2; i++) sx += 8;
  player.position.set(sx, terrain.height(sx, 0), 0);

  // Chỉ build NGAY 9 chunk gần nhất cho khỏi đứng hình lúc khởi động; phần còn lại nạp dần mỗi frame
  chunks.update(player.position.x, player.position.z, Infinity, 9);

  // --- Loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  let hudTimer = 0;
  let fpsTime = 0;
  let fpsFrames = 0;
  let fps = 0;

  renderer.setAnimationLoop(() => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    player.update(dt);
    chunks.update(player.position.x, player.position.z, 4); // ngân sách ~4ms build chunk / frame
    water.update(dt, player.position.x, player.position.z);

    // Tự điều chỉnh độ phân giải theo FPS: tụt thì giảm (không dưới MIN), dư thì tăng lại
    fpsTime += rawDt;
    fpsFrames++;
    if (fpsTime >= 1) {
      fps = fpsFrames / fpsTime;
      fpsTime = 0;
      fpsFrames = 0;
      let next = pixelRatio;
      if (fps < 40) next = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.2);
      else if (fps > 58) next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.1);
      if (next !== pixelRatio) {
        pixelRatio = next;
        renderer.setPixelRatio(pixelRatio);
      }
    }

    hudTimer += dt;
    if (hudTimer > 0.2) {
      hudTimer = 0;
      const p = player.position;
      const info = renderer.info.render;
      hud.textContent =
        `Click: khoá chuột | WASD: di chuyển | Shift: chạy | Space: nhảy\n` +
        `V: đổi góc nhìn (${player.mode === 'first' ? 'thứ 1' : 'thứ 3'}) | Lăn chuột: zoom (góc nhìn thứ 3)\n` +
        `FPS: ${fps.toFixed(0)} | draw calls: ${info.calls} | tam giác: ${(info.triangles / 1000).toFixed(0)}k | ` +
        `độ phân giải: x${pixelRatio.toFixed(2)}\n` +
        `XYZ: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} | ` +
        `chunk: ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)} | ` +
        `đang load: ${chunks.loadedCount} (còn chờ: ${chunks.queue.length})`;
    }

    renderer.render(scene, camera);
  });
}

start().catch((err) => {
  console.error(err);
  hud.textContent = 'Lỗi khi khởi động, xem console (F12).';
});
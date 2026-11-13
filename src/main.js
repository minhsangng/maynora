import * as THREE from 'three';
import { ChunkManager, TerrainGenerator, WATER_LEVEL } from './terrain';
import { Player } from './player';
import { PropScatter, loadFirstMaterial } from './props';
import { createWater, loadWaterNormal } from './water';
import { ModLibrary, MOD_DEFS, Effects } from './mods';
import { WildSpawner } from './wild';
import { GameState, QuestManager } from './quests';
import { BattleSystem } from './battle';
import { ISLAND_DEFS, Landmarks } from './islands';
import { UI } from './ui';

// --- Đảo ----------------------------------------------------------------
// Danh sách đảo, kích thước, nhiệm vụ của từng đảo chỉnh trong islands.js.
// Chỉ ĐẢO HIỆN TẠI được nạp; sang đảo khác thì đảo cũ được dọn sạch hoàn toàn.
const ISLANDS = ISLAND_DEFS;
const TELEPORT_DELAY = 5; // giây chờ sau khi xong hết nhiệm vụ đảo rồi mới dịch chuyển

// --- Hiệu năng ----------------------------------------------------------
const CHUNK_SIZE = 64;
const CHUNK_RESOLUTION = 40; // số ô lưới / cạnh chunk (cao hơn = mịn hơn nhưng nặng hơn)
const VIEW_RADIUS = 5; // chunk. Giảm số này là cách giảm tải nhanh nhất (số chunk ~ bình phương)

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
const MAX_WADE_DEPTH = 1.0; // mét: biển sâu hơn mức này thì người chơi bị chặn lại

// --- Nhân vật -----------------------------------------------------------
const PLAYER_MODEL = '/models/mayn.glb';
const PLAYER_OPTS = {
  height: 1.75,
  facing: Math.PI, // nhân vật đi lùi / quay lưng thì đổi 0 <-> Math.PI
  // Tên clip tự nhận diện (idle/walk/run/jump). Tên lạ thì ghi đè ở đây, xem console để biết tên:
  clips: {
    idle: 'Walking',
    walk: 'Walking',
    run: 'Walking',
    jump: 'T-Pose.001',
    chill: 'Sleeping Idle',
    attack: 'T-Pose.001',
    summon: 'Tender Placement', // animation khi triệu hồi mod lúc thách đấu
  },
};

// --- Mod hoang dã & thách đấu -------------------------------------------
// Danh sách mod (model, chỉ số, chiêu) chỉnh trong mods.js; nhiệm vụ nhận mod chỉnh trong quests.js.
const CHALLENGE_RANGE = 9; // mét: lại gần mod trong phạm vi này mới nhấn J được
const WILD = {
  max: 6, // số mod hoang dã tối đa cùng lúc
  spawnMin: 18, // chỉ xuất hiện trong vòng từ 18 m ...
  spawnMax: 55, // ... đến 55 m quanh player
  despawn: 85, // đi xa hơn 85 m thì biến mất
  noticeDist: 12, // lại gần trong khoảng này thì mod đứng lại nhìn bạn
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

/** Chỗ xuất phát trên cạn, gần tâm đảo, không quá dốc. */
function findSpawn(terrain) {
  for (let r = 0; r <= 400; r += 10) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = terrain.height(x, z);
      const slope = Math.abs(terrain.height(x + 2, z) - h) + Math.abs(terrain.height(x, z + 2) - h);
      if (h > WATER_LEVEL + 3 && slope < 1.5) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
/** Mũi tên chỉ hướng tới (tx, tz) so với hướng player đang nhìn. */
function arrowTo(player, tx, tz) {
  const vx = tx - player.position.x;
  const vz = tz - player.position.z;
  const fx = -Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  const rx = Math.cos(player.yaw);
  const rz = -Math.sin(player.yaw);
  const rel = Math.atan2(vx * rx + vz * rz, vx * fx + vz * fz);
  return ARROWS[((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
}

async function start() {
  const ui = new UI();
  // Lỗi runtime hiện thẳng lên màn hình (đỡ phải mở console mới biết)
  let errorToasts = 0;
  const showError = (msg) => {
    console.error(msg);
    if (errorToasts++ < 4) ui.toast(`Lỗi: ${msg}`, 8000);
  };
  window.addEventListener('error', (e) => showError(e.message));
  window.addEventListener('unhandledrejection', (e) => showError(e.reason?.message ?? String(e.reason)));

  const state = new GameState(); // đội mod + tiến độ nhiệm vụ + đang ở đảo nào (lưu trong localStorage)
  if (!ISLANDS[state.islandIndex]) state.setIsland(0, true);

  const terrain = new TerrainGenerator(ISLANDS[state.islandIndex]);
  const props = new PropScatter(terrain, CHUNK_SIZE); // danh sách model chỉnh trong props.js
  const player = new Player(camera, renderer.domElement, terrain);
  scene.add(player.body);
  const library = new ModLibrary(MOD_DEFS);

  // Tải model TRƯỚC khi tạo chunk đầu tiên (chunk cần model để rải)
  const [waterMat, waterNormal] = await Promise.all([
    WATER_MODEL ? loadFirstMaterial(WATER_MODEL) : null,
    WATER_NORMAL_MAP ? loadWaterNormal(WATER_NORMAL_MAP) : null,
    props.load(),
    player.loadModel(PLAYER_MODEL, PLAYER_OPTS),
    library.load(),
  ]);

  const chunks = new ChunkManager(
    scene,
    terrain,
    { chunkSize: CHUNK_SIZE, resolution: CHUNK_RESOLUTION, viewRadius: VIEW_RADIUS },
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
  scene.add(water.mesh, water.floor);

  // Biển sâu thì không đi tiếp được: muốn sang đảo khác phải hoàn thành nhiệm vụ đảo
  player.walkable = (x, z) => terrain.height(x, z) > WATER_LEVEL - MAX_WADE_DEPTH;
  player.onBlocked = () => ui.toast('Biển quá sâu! Hoàn thành mọi nhiệm vụ của đảo để được dịch chuyển sang đảo khác.');

  // --- Mod / nhiệm vụ / thách đấu ---------------------------------------
  const effects = new Effects(scene);
  const wild = new WildSpawner({
    scene,
    terrain,
    library,
    camera,
    effects,
    config: WILD,
    levelProvider: () => state.maxLevel(), // mod hoang dã có level quanh level mod mạnh nhất của bạn
  });
  const landmarks = new Landmarks(scene, terrain);
  const quests = new QuestManager(state, {
    onComplete: (q, entry) =>
      ui.toast(`Hoàn thành "${q.title}"! Nhận mod tân thủ: ${library.def(entry.id)?.name ?? entry.id}`, 5000),
    onIslandQuest: (q, lead) =>
      ui.toast(`Nhiệm vụ đảo "${q.title}" hoàn thành!${lead ? ` ${library.def(lead.id)?.name ?? lead.id} lên Lv ${lead.level}` : ''}`, 5000),
  });
  const battle = new BattleSystem({ scene, camera, player, terrain, library, effects, ui, state, wild });
  const hasMod = () => !!state.lead((id) => library.def(id));

  /** Nạp đảo `index`: dọn sạch đảo cũ (chunk, mod hoang dã, hải đăng) rồi dựng đảo mới quanh điểm xuất phát. */
  function enterIsland(index) {
    const def = ISLANDS[index];
    const next = ISLANDS[(index + 1) % ISLANDS.length];
    terrain.setIsland(def); // đổi địa hình tại chỗ: player, chunks, props, wild... vẫn dùng chung đối tượng này
    chunks.reset();
    wild.clear();
    wild.setPool(def.wild);
    effects.clear();
    state.island.stats.landmarks = state.island.visited.length;
    landmarks.build(def, state.island.visited, (i) => {
      if (!state.island.visited.includes(i)) state.island.visited.push(i);
      state.island.stats.landmarks = state.island.visited.length;
      state.save();
      ui.toast(`Đã thắp sáng hải đăng (${state.island.visited.length}/${landmarks.count})`);
    });
    quests.setIsland(def, next);

    const sp = findSpawn(terrain);
    player.teleport(sp.x, terrain.height(sp.x, sp.z), sp.z);
    chunks.update(sp.x, sp.z, Infinity, 9); // build ngay vài chunk gần nhất; phần còn lại nạp dần
  }

  let transitioning = false;
  let teleportIn = null;
  async function teleportNext() {
    if (transitioning) return;
    transitioning = true;
    player.locked = true;
    ui.closeQuests();
    const nextIndex = (state.islandIndex + 1) % ISLANDS.length;
    await ui.fade(true, 900, `Đang dịch chuyển tới ${ISLANDS[nextIndex].name}...`);
    state.setIsland(nextIndex, true);
    enterIsland(nextIndex);
    await ui.fade(false, 900);
    ui.toast(`Chào mừng đến ${ISLANDS[nextIndex].name}!`, 4000);
    player.locked = false;
    transitioning = false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat || transitioning) return;
    if (battle.active) {
      battle.onKey(e.code); // 1..9: dùng chiêu, F: bỏ chạy
      return;
    }
    if (e.code === 'KeyJ') {
      const target = wild.nearest(player.position, CHALLENGE_RANGE);
      if (target) battle.start(target);
      else ui.toast('Không có mod hoang dã nào ở gần để thách đấu.');
    } else if (e.code === 'KeyQ') {
      ui.toggleQuests(quests.snapshot(library));
    }
  });
  window.addEventListener('beforeunload', () => state.save());

  // Tiện cho việc thử nghiệm: mở console (F12), ví dụ game.giveMod('hoa_ti') hoặc game.nextIsland()
  window.game = {
    state,
    quests,
    battle,
    wild,
    giveMod: (id) => {
      state.addMod(id);
      ui.toast(`Đã nhận ${library.def(id)?.name ?? id}`);
    },
    nextIsland: () => teleportNext(),
  };

  enterIsland(state.islandIndex);

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

    effects.update(dt);
    wild.update(dt, player.position);
    landmarks.update(dt, player.position);
    quests.update(player, dt);
    battle.update(dt); // phải gọi SAU player.update vì nó điều chỉnh camera
    ui.update(dt, () => quests.snapshot(library));

    // Xong hết nhiệm vụ đảo -> đếm ngược rồi dịch chuyển (chờ nếu đang đấu)
    if (quests.islandComplete && !battle.active && !transitioning) {
      if (teleportIn === null) {
        teleportIn = TELEPORT_DELAY;
        const next = ISLANDS[(state.islandIndex + 1) % ISLANDS.length];
        ui.toast(`Hoàn thành mọi nhiệm vụ đảo! Dịch chuyển sang ${next.name} sau ${TELEPORT_DELAY} giây...`, 5000);
      }
      teleportIn -= dt;
      if (teleportIn <= 0) {
        teleportIn = null;
        teleportNext();
      }
    }

    // Gợi ý thách đấu khi lại gần mod hoang dã
    const near = battle.active ? null : wild.nearest(player.position, CHALLENGE_RANGE);
    if (near && !near.met) {
      near.met = true;
      state.recordMeet(); // cho nhiệm vụ "Làm quen" (tân thủ) và "Nhà thám hiểm" (đảo)
    }
    ui.prompt(
      near
        ? hasMod()
          ? `[J] Thách đấu ${near.tag}`
          : `${near.tag} — bạn chưa có mod. Nhấn Q để xem nhiệm vụ nhận mod tân thủ`
        : null,
    );

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
      const beacon = landmarks.nearestUnvisited(p);
      const def = ISLANDS[state.islandIndex];
      hud.textContent =
        `Click: khoá chuột | WASD: di chuyển | Shift: chạy | Space: nhảy | V: đổi góc nhìn\n` +
        `J: thách đấu mod | Q: nhiệm vụ & mod của bạn | 1-9: chiêu, F: bỏ chạy (khi đang đấu)\n` +
        `${def.name} | hải đăng gần nhất: ${beacon ? `${arrowTo(player, beacon.x, beacon.z)} ${beacon.dist.toFixed(0)} m` : 'đã thắp hết'} | ` +
        `mod hoang dã: ${wild.list.length} | trận đấu: ${battle.phase}\n` +
        `FPS: ${fps.toFixed(0)} | draw calls: ${info.calls} | tam giác: ${(info.triangles / 1000).toFixed(0)}k | ` +
        `độ phân giải: x${pixelRatio.toFixed(2)} | chunk: ${chunks.loadedCount} (chờ: ${chunks.queue.length})\n` +
        `XYZ: ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`;
    }

    renderer.render(scene, camera);
  });
}

start().catch((err) => {
  console.error(err);
  hud.textContent = 'Lỗi khi khởi động, xem console (F12).';
});
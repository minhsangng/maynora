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
import { Survival } from './survival';
import { FOOD_INFO } from './fooddefs';
import { TIERS, loadTierIndex, saveTierIndex, chunkConfig } from './quality';
import { UI } from './ui';

// --- Đảo ----------------------------------------------------------------
// Danh sách đảo, kích thước, nhiệm vụ của từng đảo chỉnh trong islands.js.
// Chỉ ĐẢO HIỆN TẠI được nạp; sang đảo khác thì đảo cũ được dọn sạch hoàn toàn.
const ISLANDS = ISLAND_DEFS;
const TELEPORT_DELAY = 5; // giây chờ sau khi xong hết nhiệm vụ đảo rồi mới dịch chuyển

// --- Hiệu năng ----------------------------------------------------------
// Chất lượng chỉnh trong quality.js (4 mức). Game tự hạ mức khi FPS thấp; bạn đổi tay bằng phím [ và ].
const CHUNK_SIZE = 64;
const FOG_NEAR = 0.55; // sương mù tính theo tỉ lệ tầm nhìn: NEAR càng lớn thì càng ít mờ
const FOG_FAR = 0.95;
const savedTier = loadTierIndex();
// Khử răng cưa chỉ bật ở mức Cao trở lên trên màn hình thường (màn hình độ phân giải cao không cần)
const ANTIALIAS = window.devicePixelRatio < 1.5 && savedTier >= 2;

// --- Nước ---------------------------------------------------------------
// KHÔNG cần model nước. Mặc định dùng normal map tự sinh bằng code.
// Muốn đẹp hơn: đặt ảnh normal map nước (tileable) vào public/textures/ rồi điền đường dẫn.
const WATER_NORMAL_MAP = null; // ví dụ '/textures/water_normal.jpg'
const WATER_MODEL = null; // nếu có water.glb thì chỉ lấy MATERIAL của nó, ví dụ '/models/water.glb'
const WATER_TILE = 12; // mét / 1 lần lặp texture nước
const MAX_WADE_DEPTH = 1.0; // mét: biển sâu hơn mức này thì người chơi bị chặn lại

// --- Nhân vật -----------------------------------------------------------
const PLAYER_MODEL = '/models/mayn.glb';
const PLAYER_RADIUS = 0.4; // bán kính va chạm với cây, đá
const PICKUP_RADIUS = 2.4; // lại gần thực phẩm trong phạm vi này thì tự nhặt
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
// Danh sách mod (model, chỉ số, chiêu, animation) chỉnh trong mods.js; nhiệm vụ nhận mod chỉnh trong quests.js.
const CHALLENGE_RANGE = 9; // mét: lại gần mod trong phạm vi này mới nhấn J được
const WILD = {
  max: 6, // số mod hoang dã tối đa cùng lúc (mức chất lượng sẽ ghi đè)
  spawnMin: 18, // chỉ xuất hiện trong vòng từ 18 m ...
  spawnMax: 55, // ... đến 55 m quanh player
  despawn: 85, // đi xa hơn 85 m thì biến mất
  noticeDist: 12, // lại gần trong khoảng này thì mod đứng lại nhìn bạn
};

// --- Renderer / Scene ---------------------------------------------------
// stencil / alpha tắt: không dùng tới nên khỏi tốn bộ nhớ và công ghép lớp
const renderer = new THREE.WebGLRenderer({
  antialias: ANTIALIAS,
  powerPreference: 'high-performance',
  stencil: false,
  alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sky = new THREE.Color(0x9ec9ee);
scene.background = sky;
scene.fog = new THREE.Fog(sky, 100, 300); // khoảng cách thật được đặt theo mức chất lượng

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

  const state = new GameState(); // đội mod, túi đồ, tiến độ nhiệm vụ, đảo hiện tại (lưu trong localStorage)
  if (!ISLANDS[state.islandIndex]) state.setIsland(0, true);

  const terrain = new TerrainGenerator(ISLANDS[state.islandIndex]);
  const props = new PropScatter(terrain, CHUNK_SIZE); // danh sách model cây/đá/cỏ chỉnh trong propDefs.js
  const player = new Player(camera, renderer.domElement, terrain);
  scene.add(player.body);
  const survival = new Survival(state); // thể lực + độ đói
  survival.onMessage = (text) => ui.toast(text, 4000);
  player.survival = survival;
  const library = new ModLibrary(MOD_DEFS);

  // Tải model TRƯỚC khi tạo chunk đầu tiên (chunk cần model để rải)
  const [waterMat, waterNormal] = await Promise.all([
    WATER_MODEL ? loadFirstMaterial(WATER_MODEL) : null,
    WATER_NORMAL_MAP ? loadWaterNormal(WATER_NORMAL_MAP) : null,
    props.load(),
    player.loadModel(PLAYER_MODEL, PLAYER_OPTS),
    library.load(),
  ]);

  let tierIndex = savedTier;
  let tier = TIERS[tierIndex];
  // Chunk được dựng trong Web Worker; cây/đá/cỏ gộp thành vài InstancedMesh dùng chung (ít draw call)
  const chunks = new ChunkManager(scene, terrain, props, { chunkSize: CHUNK_SIZE, ...chunkConfig(tier) });

  // Mặt nước phủ được tầm nhìn xa nhất của mọi mức chất lượng
  const maxView = Math.max(...TIERS.map((t) => t.viewRadius)) * CHUNK_SIZE;
  const water = createWater({
    size: maxView * 3,
    tile: WATER_TILE,
    level: WATER_LEVEL,
    material: waterMat,
    normalMap: waterNormal,
  });
  scene.add(water.mesh, water.floor);

  // Va chạm: không đi xuyên cây, đá; không leo dốc quá đứng; không xuống biển sâu
  player.resolve = (pos) => chunks.resolve(pos, PLAYER_RADIUS);
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

  // --- Mức chất lượng + tự điều chỉnh -------------------------------------
  let pixelRatio = 1;
  let ratioMax = 1;
  let ratioMin = 1;
  let graceUntil = performance.now() + 10000; // bỏ qua FPS lúc mới vào (biên dịch shader, nạp chunk đầu)
  function applyTier(i, opts = {}) {
    tierIndex = Math.max(0, Math.min(TIERS.length - 1, i));
    tier = TIERS[tierIndex];
    ratioMax = Math.min(tier.pixelRatio, window.devicePixelRatio);
    ratioMin = Math.max(0.7, ratioMax * 0.8);
    pixelRatio = ratioMax;
    renderer.setPixelRatio(pixelRatio);
    chunks.configure(chunkConfig(tier)); // đổi cấu hình thì dựng lại chunk (tự động)
    scene.fog.near = chunks.viewDistance * FOG_NEAR;
    scene.fog.far = chunks.viewDistance * FOG_FAR;
    camera.far = chunks.viewDistance * 1.2 + 50;
    camera.updateProjectionMatrix();
    water.setSimple(tier.simpleWater);
    wild.cfg.max = tier.wildMax;
    saveTierIndex(tierIndex);
    graceUntil = performance.now() + 8000;
    if (!opts.silent) ui.toast(`Chất lượng: ${tier.name}${opts.auto ? ' (tự hạ vì FPS thấp)' : ''}`, 3000);
  }
  applyTier(tierIndex, { silent: true });

  // --- Đảo ---------------------------------------------------------------
  /** Nạp đảo `index`: dọn sạch đảo cũ (chunk, mod hoang dã, hải đăng) rồi dựng đảo mới quanh điểm xuất phát. */
  async function enterIsland(index) {
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
    await chunks.waitInitial(sp.x, sp.z, camera, 9); // chờ vài chunk gần nhất (lúc này màn hình đang tối / đang tải)
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
    await enterIsland(nextIndex);
    survival.stamina = 100; // sang đảo mới: hồi đầy thể lực
    await ui.fade(false, 900);
    ui.toast(`Chào mừng đến ${ISLANDS[nextIndex].name}!`, 4000);
    player.locked = false;
    transitioning = false;
    graceUntil = performance.now() + 6000;
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'BracketRight') return applyTier(tierIndex + 1); // tăng chất lượng
    if (e.code === 'BracketLeft') return applyTier(tierIndex - 1); // giảm chất lượng
    if (transitioning) return;
    if (battle.active) {
      battle.onKey(e.code); // trận đấu tự động; chỉ có F: rút lui
      return;
    }
    if (e.code === 'KeyJ') {
      const target = wild.nearest(player.position, CHALLENGE_RANGE);
      if (target) battle.start(target);
      else ui.toast('Không có mod hoang dã nào ở gần để thách đấu.');
    } else if (e.code === 'KeyQ') {
      ui.toggleQuests(quests.snapshot(library));
    } else if (e.code === 'KeyE') {
      ui.toast(survival.eat().message, 2000);
    }
  });
  window.addEventListener('beforeunload', () => state.save());

  // Tiện cho việc thử nghiệm: mở console (F12), ví dụ game.giveMod('hoa_ti'), game.nextIsland(), game.setTier(0)
  window.game = {
    state,
    quests,
    battle,
    wild,
    chunks,
    survival,
    player,
    giveMod: (id) => {
      state.addMod(id);
      ui.toast(`Đã nhận ${library.def(id)?.name ?? id}`);
    },
    giveFood: (id, n = 3) => state.addFood(id, n),
    nextIsland: () => teleportNext(),
    setTier: (i) => applyTier(i),
  };

  await enterIsland(state.islandIndex);

  // --- Loop -------------------------------------------------------------
  const clock = new THREE.Clock();
  let hudTimer = 0;
  let vitalsTimer = 0;
  let fpsTime = 0;
  let fpsFrames = 0;
  let fps = 0;
  let lowSecs = 0;
  let highSecs = 0;
  let jsMs = 0;
  let renderMs = 0;
  let frameMs = 16;

  renderer.setAnimationLoop(() => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const t0 = performance.now();

    player.update(dt);
    chunks.update(player.position.x, player.position.z, camera);
    water.update(dt, player.position.x, player.position.z);

    effects.update(dt);
    wild.update(dt, player.position);
    landmarks.update(dt, player.position);
    quests.update(player, dt);
    battle.update(dt); // phải gọi SAU player.update vì nó điều chỉnh camera
    ui.update(dt, () => quests.snapshot(library));

    // Nhặt thực phẩm khi đi tới gần
    const picked = chunks.collectFood(player.position.x, player.position.y, player.position.z, PICKUP_RADIUS);
    if (picked.length > 0) {
      const counts = {};
      for (const id of picked) counts[id] = (counts[id] ?? 0) + 1;
      for (const [id, n] of Object.entries(counts)) {
        state.addFood(id, n);
        ui.toast(`+${n} ${FOOD_INFO[id].name}`, 1500);
      }
    }

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
          ? `[J] Thách đấu ${near.tag} (trận đấu tự động)`
          : `${near.tag} — bạn chưa có mod. Nhấn Q để xem nhiệm vụ nhận mod tân thủ`
        : null,
    );

    const t1 = performance.now();
    renderer.render(scene, camera);
    const t2 = performance.now();
    jsMs += (t1 - t0 - jsMs) * 0.1;
    renderMs += (t2 - t1 - renderMs) * 0.1;
    frameMs += (rawDt * 1000 - frameMs) * 0.1;

    // Tự điều chỉnh: FPS thấp kéo dài -> nếu nghẽn GPU thì giảm độ phân giải trước, hết cách thì hạ mức chất lượng.
    fpsTime += rawDt;
    fpsFrames++;
    if (fpsTime >= 1) {
      fps = fpsFrames / fpsTime;
      fpsTime = 0;
      fpsFrames = 0;
      if (performance.now() > graceUntil && !transitioning) {
        lowSecs = fps < 38 ? lowSecs + 1 : Math.max(0, lowSecs - 1);
        highSecs = fps > 57 ? highSecs + 1 : 0;
        if (lowSecs >= 4) {
          lowSecs = 0;
          const cpuBound = jsMs + renderMs > frameMs * 0.7; // CPU bận suốt khung hình => đổi độ phân giải không giúp được
          if (!cpuBound && pixelRatio > ratioMin + 0.01) {
            pixelRatio = Math.max(ratioMin, pixelRatio - 0.15);
            renderer.setPixelRatio(pixelRatio);
          } else if (tierIndex > 0) {
            applyTier(tierIndex - 1, { auto: true });
          }
        } else if (highSecs >= 6 && pixelRatio < ratioMax - 0.01) {
          pixelRatio = Math.min(ratioMax, pixelRatio + 0.05);
          renderer.setPixelRatio(pixelRatio);
        }
      }
    }

    vitalsTimer += dt;
    if (vitalsTimer > 0.1) {
      vitalsTimer = 0;
      ui.updateVitals(survival, state.inv, FOOD_INFO);
    }

    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const p = player.position;
      const info = renderer.info.render;
      const beacon = landmarks.nearestUnvisited(p);
      const def = ISLANDS[state.islandIndex];
      const bound = frameMs > (jsMs + renderMs) * 1.5 + 3 ? 'GPU / vsync' : 'CPU';
      hud.textContent =
        `Click: khoá chuột | WASD | Shift: chạy (tốn thể lực + đói) | Space: nhảy | V: góc nhìn | E: ăn\n` +
        `J: thách đấu (trận tự động) | Q: nhiệm vụ & mod | F: rút lui khi đang đấu | [ ]: chất lượng\n` +
        `${def.name} | hải đăng: ${beacon ? `${arrowTo(player, beacon.x, beacon.z)} ${beacon.dist.toFixed(0)} m` : 'đã thắp hết'} | ` +
        `mod hoang dã: ${wild.list.length} | trận đấu: ${battle.phase}\n` +
        `Chất lượng: ${tier.name} | FPS ${fps.toFixed(0)} | khung ${frameMs.toFixed(1)} ms (JS ${jsMs.toFixed(1)} + render ${renderMs.toFixed(1)}) | nghẽn: ${bound}\n` +
        `draw calls ${info.calls} | tam giác ${(info.triangles / 1000).toFixed(0)}k | phân giải x${pixelRatio.toFixed(2)} | ` +
        `chunk ${chunks.loadedCount} (chờ ${chunks.pendingCount}${chunks.worker ? '' : ', không có Worker!'}) | XYZ ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`;
    }
  });
}

start().catch((err) => {
  console.error(err);
  hud.textContent = 'Lỗi khi khởi động, xem console (F12).';
});
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
import { TIERS, chunkConfig } from './quality';
import { ItemLibrary } from './items';
import { Drops } from './drops';
import { Menus } from './menus';
import { UI } from './ui';
import { Screens } from './screens';
import { CloudClient } from './cloud';
import { SaveManager } from './store';
import { loadSettings, saveSettings } from './settings';
import './touch';

const GAME_TITLE = 'MAYNORA'; // tên game hiện ở màn hình tải và menu chính
const GAME_VERSION = 'v0.3';

// --- Đảo ----------------------------------------------------------------
// Danh sách đảo, kích thước, nhiệm vụ của từng đảo chỉnh trong islands.js.
// Chỉ ĐẢO HIỆN TẠI được nạp; sang đảo khác thì đảo cũ được dọn sạch hoàn toàn.
const ISLANDS = ISLAND_DEFS;
const TELEPORT_DELAY = 5; // giây chờ sau khi xong hết nhiệm vụ đảo rồi mới dịch chuyển

// --- Hiệu năng ----------------------------------------------------------
// Chất lượng chỉnh trong quality.js (4 mức). Game tự hạ mức khi FPS thấp; đổi tay bằng phím [ ] hoặc menu Cài đặt.
const CHUNK_SIZE = 64;
const FOG_NEAR = 0.55; // sương mù tính theo tỉ lệ tầm nhìn: NEAR càng lớn thì càng ít mờ
const FOG_FAR = 0.95;
const settings = loadSettings(globalThis.localStorage, TIERS.length - 1); // cài đặt RIÊNG của máy này
let tierIndex = settings.tier;
// Khử răng cưa chỉ bật ở mức Cao trở lên trên màn hình thường (màn hình độ phân giải cao không cần)
const ANTIALIAS = window.devicePixelRatio < 1.5 && tierIndex >= 2;

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
  ui.setDebugVisible(settings.debug);
  ui.setHudVisible(false); // HUD chỉ hiện khi đã vào game
  const screens = new Screens(ui, { title: GAME_TITLE, version: GAME_VERSION });
  screens.showLoading([
    { id: 'save', label: 'Dữ liệu người chơi' },
    { id: 'props', label: 'Cây, đá, cỏ' },
    { id: 'items', label: 'Vật phẩm' },
    { id: 'mods', label: 'Mod' },
    { id: 'player', label: 'Nhân vật' },
    { id: 'island', label: 'Dựng đảo' },
  ]);

  // Lỗi runtime hiện thẳng lên màn hình (đỡ phải mở console mới biết)
  let errorToasts = 0;
  const showError = (msg) => {
    console.error(msg);
    if (errorToasts++ < 4) ui.toast(`Lỗi: ${msg}`, 8000);
  };
  window.addEventListener('error', (e) => showError(e.message));
  window.addEventListener('unhandledrejection', (e) => showError(e.reason?.message ?? String(e.reason)));

  // trạng thái: 'loading' | 'title' | 'playing' | 'paused'
  let status = 'loading';
  let starting = false;
  let transitioning = false;
  let teleportIn = null;

  const requestLock = () => {
    try {
      renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      /* không khoá được: nhấp vào màn hình để khoá */
    }
  };
  const releaseLock = () => document.exitPointerLock?.();

  // --- Dữ liệu người chơi: đọc bản trong máy ngay; chế độ server chọn ở menu chính ---
  const summary = (d) => {
    const t = d?.savedAt > 1 ? new Date(d.savedAt).toLocaleString('vi-VN') : 'không rõ';
    return `${d?.party?.length ?? 0} mod · ${ISLANDS[d?.islandIndex ?? 0]?.name ?? 'đảo ?'} · ${t}`;
  };
  const askConflict = (local, remote) => {
    releaseLock(); // cần chuột để bấm nút
    return screens.confirm({
      title: 'DỮ LIỆU KHÁC NHAU',
      message: `<b>Máy này:</b> ${summary(local)}<br><b>Server:</b> ${summary(remote)}<br>Bạn muốn giữ bản nào?`,
      buttons: [
        { label: 'DÙNG BẢN SERVER', value: 'remote', primary: true },
        { label: 'GIỮ BẢN TRONG MÁY', value: 'local' },
      ],
      cancelValue: 'remote',
    });
  };
  const cloud = new CloudClient();
  const state = new GameState();
  const store = new SaveManager({ state, cloud, askConflict });
  const local = store.readLocal();
  if (local) state.hydrate(local);
  if (!ISLANDS[state.islandIndex]) state.setIsland(0, true);
  screens.stepDone('save');
  let cloudInfo = 'checking'; // 'checking' | 'ready' | 'nodb' | 'none'
  const cloudText = () =>
    ({ checking: '☁ Server: đang kiểm tra...', ready: '☁ Server: sẵn sàng', nodb: '☁ Server: chưa cấu hình CSDL', none: '☁ Server: không có máy chủ (chơi offline)' })[cloudInfo];
  cloud
    .ping()
    .then((r) => (cloudInfo = r.db ? 'ready' : 'nodb'))
    .catch(() => (cloudInfo = 'none'))
    .finally(() => screens.setTitleStatus(cloudText()));

  const terrain = new TerrainGenerator(ISLANDS[state.islandIndex]);
  const props = new PropScatter(terrain, CHUNK_SIZE); // danh sách model cây/đá/cỏ chỉnh trong propdefs.js
  const player = new Player(camera, renderer.domElement, terrain);
  player.sensitivity = settings.sens;
  scene.add(player.body);
  const survival = new Survival(state); // thể lực + độ đói
  survival.onMessage = (text) => ui.toast(text, 4000);
  player.survival = survival;
  const library = new ModLibrary(MOD_DEFS);
  const items = new ItemLibrary(); // model trái cây + chiến lợi phẩm (fooddefs.js)

  // Tải model TRƯỚC khi tạo chunk đầu tiên (chunk cần model để rải); mỗi xong 1 bước thì tick trên màn hình tải
  const step = (id, p) => p.then((r) => (screens.stepDone(id), r));
  const [waterMat, waterNormal] = await Promise.all([
    WATER_MODEL ? loadFirstMaterial(WATER_MODEL) : null,
    WATER_NORMAL_MAP ? loadWaterNormal(WATER_NORMAL_MAP) : null,
    step('props', props.load()),
    step('player', player.loadModel(PLAYER_MODEL, PLAYER_OPTS)),
    step('mods', library.load()),
    step('items', items.load()),
  ]);

  let tier = TIERS[tierIndex];
  // Chunk được dựng trong Web Worker; cây/đá/cỏ gộp thành vài InstancedMesh dùng chung (ít draw call)
  const chunks = new ChunkManager(scene, terrain, props, { chunkSize: CHUNK_SIZE, ...chunkConfig(tier) }, items);

  // Mặt nước phủ được tầm nhìn xa nhất của mọi mức chất lượng
  const maxView = Math.max(...TIERS.map((t) => t.viewRadius)) * CHUNK_SIZE;
  const water = createWater({ size: maxView * 3, tile: WATER_TILE, level: WATER_LEVEL, material: waterMat, normalMap: waterNormal });
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
  const drops = new Drops(scene, items, terrain); // vật phẩm rơi sau khi thắng
  const quests = new QuestManager(state, {
    onComplete: (q, entry) =>
      ui.toast(`Hoàn thành "${q.title}"! Nhận mod tân thủ: ${library.def(entry.id)?.name ?? entry.id}`, 5000),
    onIslandQuest: (q, lead) =>
      ui.toast(`Nhiệm vụ đảo "${q.title}" hoàn thành!${lead ? ` ${library.def(lead.id)?.name ?? lead.id} lên Lv ${lead.level}` : ''}`, 5000),
  });
  const battle = new BattleSystem({ scene, camera, player, terrain, library, effects, ui, state, wild, drops });

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
    settings.tier = tierIndex;
    saveSettings(settings);
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
    drops.clear();
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

  async function teleportNext() {
    if (transitioning) return;
    transitioning = true;
    player.locked = true;
    menus.close();
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

  // --- Hành trang (mod + vật phẩm) và hộp chọn mod ra trận ------------------
  const menus = new Menus({
    ui,
    state,
    library,
    survival,
    canOpen: () => status === 'playing' && !battle.active && !transitioning,
    setLock: (on) => {
      if (on) player.locked = true;
      else if (!battle.active && !transitioning) player.locked = false;
    },
  });
  ui.modalEl.onclick = (e) => menus.click(e.target); // chuột: click thẻ mod / vật phẩm / nút
  menus.onClose = () => {
    if (status === 'paused') openPauseMenu(); // mở hành trang từ menu tạm dừng thì đóng xong quay lại menu đó
  };

  /** Nhấn J: chọn mod trong đội (luôn hiện hộp chọn, kể cả chỉ có 1 mod) rồi vào trận. */
  function challenge() {
    const target = wild.nearest(player.position, CHALLENGE_RANGE);
    if (!target) return ui.toast('Không có mod hoang dã nào ở gần để thách đấu.');
    if (menus.party().length === 0) return ui.toast('Bạn chưa có mod nào! Hoàn thành nhiệm vụ tân thủ để nhận mod.');
    target.engaged = true; // đứng yên tại chỗ trong lúc bạn chọn
    target.moving = false;
    menus.openSelect(
      `Chọn mod trong Hành trang để đấu với ${target.tag}. Trận đấu diễn ra tự động.`,
      (entry) => battle.start(target, entry),
      () => {
        target.engaged = false;
      },
    );
  }

  // --- Menu chính / tạm dừng / cài đặt -------------------------------------
  function openSettings() {
    screens.open({
      kind: 'panel',
      title: 'CÀI ĐẶT',
      controls: [
        { type: 'choice', label: 'Chất lượng đồ hoạ', options: TIERS.map((t) => t.name), index: tierIndex, onChange: (i) => applyTier(i) },
        {
          type: 'slider',
          label: 'Độ nhạy chuột',
          min: 0.3,
          max: 2.5,
          step: 0.1,
          value: settings.sens,
          format: (v) => `${v.toFixed(1)}x`,
          onChange: (v) => {
            settings.sens = v;
            player.sensitivity = v;
            saveSettings(settings);
          },
        },
        {
          type: 'toggle',
          label: 'Bảng thông số hiệu năng (F3)',
          value: settings.debug,
          onChange: (b) => {
            settings.debug = b;
            ui.setDebugVisible(b);
            saveSettings(settings);
          },
        },
        { type: 'text', html: 'Chất lượng tự hạ khi FPS thấp. Khi đang chơi, nhấn <kbd>[</kbd> <kbd>]</kbd> để đổi nhanh.' },
        { type: 'button', label: 'XONG', primary: true, onClick: () => screens.closeTop() },
      ],
    });
  }

  function openTitle() {
    screens.closeAll();
    if (menus.active) menus.close();
    status = 'title';
    player.locked = true;
    ui.setHudVisible(false);
    releaseLock();
    const hasSave = state.hasProgress();
    screens.open({
      kind: 'title',
      status: cloudText(),
      controls: [
        { type: 'button', label: hasSave ? 'TIẾP TỤC' : 'CHƠI', primary: true, hint: 'Lưu trong máy này', onClick: () => beginSession('local') },
        { type: 'button', label: 'CHƠI ONLINE', hint: 'Lưu lên server', onClick: () => beginSession('cloud') },
        { type: 'button', label: 'CÀI ĐẶT', onClick: openSettings },
        { type: 'button', label: 'HƯỚNG DẪN', onClick: () => screens.showHelp() },
      ],
    });
  }

  async function beginSession(mode) {
    if (starting) return;
    starting = true;
    if (mode === 'local') requestLock(); // phải gọi ngay trong lúc còn "thao tác người dùng"
    screens.closeAll();
    await ui.fade(true, 350, mode === 'cloud' ? 'Đang kết nối server...' : 'Đang vào đảo...');
    if (mode === 'cloud') {
      const r = await store.connect();
      if (r.error) ui.toast('Không kết nối được server — chơi offline, dữ liệu vẫn lưu trong máy.', 5000);
      else if (r.data) {
        state.hydrate(r.data); // dùng dữ liệu của server
        store.writeLocal(r.data);
        survival.sync();
        await enterIsland(state.islandIndex);
      }
    } else {
      store.disconnect();
    }
    status = 'playing';
    player.locked = false;
    ui.setHudVisible(true);
    starting = false; // từ giờ Esc / tạm dừng dùng được ngay, không cần chờ hiệu ứng sáng dần
    await ui.fade(false, 450);
    if (status === 'playing' && !document.pointerLockElement) requestLock();
  }

  function openPauseMenu() {
    screens.closeAll();
    screens.open({
      kind: 'panel',
      title: 'TẠM DỪNG',
      sub: `${ISLANDS[state.islandIndex].name} · ${store.statusText()}`,
      controls: [
        { type: 'button', label: 'TIẾP TỤC', primary: true, onClick: resumeGame },
        {
          type: 'button',
          label: 'HÀNH TRANG',
          hint: `${menus.party().length} mod · vật phẩm`,
          onClick: () => {
            screens.closeAll();
            menus.openBag();
          },
        },
        { type: 'button', label: 'NHIỆM VỤ', onClick: () => screens.showQuests(quests.snapshot(library)) },
        { type: 'button', label: 'CÀI ĐẶT', onClick: openSettings },
        {
          type: 'button',
          label: 'LƯU NGAY',
          hint: store.mode === 'cloud' ? 'Lưu trong máy và lên server' : 'Lưu trong máy này',
          onClick: async () => {
            await store.flush(true);
            ui.toast(store.statusText(), 3000);
            openPauseMenu();
          },
        },
        { type: 'button', label: 'VỀ MENU CHÍNH', danger: true, onClick: quitToTitle },
      ],
      onBack: resumeGame,
    });
  }

  function pauseGame() {
    if (status !== 'playing' || transitioning || starting) return;
    status = 'paused';
    releaseLock(); // thả chuột để bấm được nút
    openPauseMenu();
  }

  function resumeGame() {
    screens.closeAll();
    if (menus.active) menus.close();
    status = 'playing';
    requestLock();
  }

  async function quitToTitle() {
    const yes = await screens.confirm({
      title: 'VỀ MENU CHÍNH?',
      message: 'Tiến trình sẽ được lưu trước khi thoát.',
      buttons: [
        { label: 'Ở LẠI', value: false, primary: true },
        { label: 'VỀ MENU', value: true, danger: true },
      ],
      cancelValue: false,
    });
    if (!yes) return;
    battle.cancel();
    await store.flush(true);
    openTitle();
  }

  // --- Phím, chuột, tiêu điểm ------------------------------------------------
  ui.onHotbar = (a) => {
    if (status !== 'playing' || transitioning || menus.active) return;
    if (a === 'bag') menus.toggleBag();
    else if (a === 'quests') ui.toggleTrackerExpanded();
    else if (a === 'pause') pauseGame();
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      settings.debug = !settings.debug;
      ui.setDebugVisible(settings.debug);
      saveSettings(settings);
      return;
    }
    if (screens.active) {
      screens.handleKey(e.code, e); // màn hình tải / menu chính / tạm dừng / cài đặt: nuốt phím
      return;
    }
    if (menus.active) {
      menus.handleKey(e.code, e); // hành trang / chọn mod: nuốt mọi phím
      return;
    }
    if (status !== 'playing' || e.repeat) return;
    if (e.code === 'BracketRight') return applyTier(tierIndex + 1); // tăng chất lượng
    if (e.code === 'BracketLeft') return applyTier(tierIndex - 1); // giảm chất lượng
    if (transitioning) return;
    if (e.code === 'Escape' || e.code === 'KeyP') return pauseGame();
    if (battle.active) {
      battle.onKey(e.code); // trận đấu tự động; chỉ có F: rút lui
      return;
    }
    if (e.code === 'KeyJ') challenge();
    else if (e.code === 'KeyI') menus.toggleBag();
    else if (e.code === 'KeyQ') ui.toggleTrackerExpanded(); // thanh nhiệm vụ: gọn <-> chi tiết
    else if (e.code === 'KeyE') ui.toast(survival.eat().message, 2000);
  });

  // Nhấn Esc khi đang khoá chuột: trình duyệt nhả chuột trước (không gửi phím Esc) -> coi như yêu cầu tạm dừng
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;
    if (status !== 'playing' || transitioning || starting || screens.active) return;
    if (menus.active) {
      menus.close();
      return;
    }
    pauseGame();
  });
  window.addEventListener('blur', () => pauseGame()); // chuyển cửa sổ khác thì tự tạm dừng

  const saveNow = () => store.beacon();
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  store.onRemoteApplied = () => {
    survival.sync();
    enterIsland(state.islandIndex); // bản của server khác bản đang chơi: dựng lại đảo theo bản đó
  };

  // Tiện cho việc thử nghiệm: mở console (F12), ví dụ game.giveMod('quy_ti'), game.nextIsland(), game.setTier(0)
  window.game = {
    state,
    quests,
    battle,
    wild,
    chunks,
    survival,
    player,
    menus,
    drops,
    screens,
    store,
    cloud,
    get status() {
      return status;
    },
    pause: pauseGame,
    resume: resumeGame,
    giveMod: (id) => {
      state.addMod(id);
      ui.toast(`Đã nhận ${library.def(id)?.name ?? id}`);
    },
    giveFood: (id, n = 3) => state.addFood(id, n),
    nextIsland: () => teleportNext(),
    setTier: (i) => applyTier(i),
  };

  // --- Dựng đảo (làm nền cho menu chính), rồi bắt đầu vòng lặp ---------------
  screens.setStep('island', 'doing');
  await enterIsland(state.islandIndex);
  screens.stepDone('island');
  await new Promise((r) => setTimeout(r, 450)); // cho người dùng kịp thấy "Sẵn sàng!"
  screens.hideLoading();
  openTitle();

  const clock = new THREE.Clock();
  let hudTimer = 0;
  let vitalsTimer = 0;
  let trackerTimer = 0;
  let fpsTime = 0;
  let fpsFrames = 0;
  let fps = 0;
  let lowSecs = 0;
  let highSecs = 0;
  let jsMs = 0;
  let renderMs = 0;
  let frameMs = 16;
  let orbit = Math.random() * Math.PI * 2;

  renderer.setAnimationLoop(() => {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const t0 = performance.now();
    // Game chỉ chạy khi đang chơi và không có màn hình / cửa sổ nào che; còn lại thì đứng yên
    const running = status === 'playing' && !screens.active && !menus.active;

    if (running) {
      state.playtime += dt;
      player.update(dt);
      effects.update(dt);
      wild.update(dt, player.position);
      landmarks.update(dt, player.position);
      quests.update(player, dt);
      battle.update(dt); // phải gọi SAU player.update vì nó điều chỉnh camera
      drops.update(dt, player.position);
      store.tick(dt);
    } else if (status === 'title') {
      // Menu chính: camera bay vòng quanh đảo làm nền
      orbit += dt * 0.08;
      const c = player.position;
      camera.position.set(c.x + Math.cos(orbit) * 42, c.y + 20, c.z + Math.sin(orbit) * 42);
      camera.lookAt(c.x, c.y + 2, c.z);
    }
    chunks.update(player.position.x, player.position.z, camera);
    water.update(dt, player.position.x, player.position.z);

    if (running) {
      // Nhặt thực phẩm (mọc tự nhiên + chiến lợi phẩm rơi ra) khi đi tới gần
      const picked = chunks
        .collectFood(player.position.x, player.position.y, player.position.z, PICKUP_RADIUS)
        .concat(drops.collect(player.position, PICKUP_RADIUS));
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
          ? menus.party().length > 0
            ? `[J] Thách đấu ${near.tag} (chọn mod ra trận, trận đấu tự động)`
            : `${near.tag} — bạn chưa có mod. Hoàn thành nhiệm vụ tân thủ (khung bên phải) để nhận mod`
          : null,
      );
    } else if (status !== 'playing') {
      ui.prompt(null);
    }

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
      ui.setFps(`${fps.toFixed(0)} FPS`);
      if (running && performance.now() > graceUntil && !transitioning) {
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

    vitalsTimer += rawDt;
    if (vitalsTimer > 0.1) {
      vitalsTimer = 0;
      ui.updateVitals(survival, state.inv, FOOD_INFO);
    }
    trackerTimer += rawDt;
    if (trackerTimer > 0.25) {
      trackerTimer = 0;
      ui.updateTracker(quests.snapshot(library)); // thanh nhiệm vụ luôn hiện ở góc phải
      ui.setTrackerVisible(status !== 'title' && !battle.active && !transitioning);
    }

    hudTimer += rawDt;
    if (hudTimer > 0.25 && settings.debug) {
      hudTimer = 0;
      const p = player.position;
      const info = renderer.info.render;
      const beacon = landmarks.nearestUnvisited(p);
      const def = ISLANDS[state.islandIndex];
      const bound = frameMs > (jsMs + renderMs) * 1.5 + 3 ? 'GPU / vsync' : 'CPU';
      ui.setDebug(
        `${def.name} | hải đăng: ${beacon ? `${arrowTo(player, beacon.x, beacon.z)} ${beacon.dist.toFixed(0)} m` : 'đã thắp hết'} | ` +
          `mod hoang dã: ${wild.list.length} | trận đấu: ${battle.phase} | ${store.statusText()}\n` +
          `Chất lượng: ${tier.name} | FPS ${fps.toFixed(0)} | khung ${frameMs.toFixed(1)} ms (JS ${jsMs.toFixed(1)} + render ${renderMs.toFixed(1)}) | nghẽn: ${bound}\n` +
          `draw calls ${info.calls} | tam giác ${(info.triangles / 1000).toFixed(0)}k | phân giải x${pixelRatio.toFixed(2)} | ` +
          `chunk ${chunks.loadedCount} (chờ ${chunks.pendingCount}${chunks.worker ? '' : ', không có Worker!'}) | XYZ ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`,
      );
    }
  });
}

start().catch((err) => {
  console.error(err);
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#3a2412;color:#fff3d6;font:700 20px system-ui;text-align:center;padding:24px';
  msg.textContent = `Lỗi khi khởi động: ${err?.message ?? err}. Mở console (F12) để xem chi tiết.`;
  document.body.appendChild(msg);
});
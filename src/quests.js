const MAX_LEVEL = 30;

/**
 * Nhiệm vụ TÂN THỦ: nhận mod. stat = chỉ số theo dõi, goal = mục tiêu, reward = id mod trong MOD_DEFS.
 * (Nhiệm vụ của từng đảo - để được dịch chuyển sang đảo khác - nằm trong islands.js)
 */
export const QUEST_DEFS = [
  { id: 'walk', title: 'Bước chân đầu tiên', desc: 'Đi bộ tổng cộng 150 m', stat: 'distance', goal: 150, reward: 'quy_ti' },
  { id: 'jump', title: 'Nhảy cẫng lên', desc: 'Nhảy 5 lần', stat: 'jumps', goal: 5, reward: 'nhat_long' },
  { id: 'climb', title: 'Leo đồi', desc: 'Leo cao hơn điểm xuất phát 15 m', stat: 'maxClimb', goal: 15, reward: 'quy_su' },
  { id: 'meet', title: 'Làm quen', desc: 'Lại gần 3 mod hoang dã', stat: 'meets', goal: 3, reward: 'ca_sau' },
];

const DEFAULT_STATS = { distance: 0, jumps: 0, maxClimb: 0, meets: 0, wins: 0 };
const newIsland = () => ({ stats: { landmarks: 0, wins: 0, meets: 0 }, done: {}, visited: [] });

export const SAVE_VERSION = 2;
const MAX_EVENTS = 40; // số sự kiện gần nhất giữ trong bản lưu

/** Id mod cũ (trước khi đổi danh sách mod) -> id mới, để bản lưu cũ vẫn dùng được. */
export const LEGACY_MOD_IDS = {
  hoa_ti: 'quy_ti',
  moc_ti: 'nhat_long',
  thuy_ti: 'quy_su',
  soi_da: 'ca_sau',
  cu_dem: 'quy_su',
  rua_co: 'ca_sau',
};

const num = (v, def = 0) => (Number.isFinite(v) ? v : def);

/**
 * Toàn bộ dữ liệu người chơi (đội mod, hành trang, nhiệm vụ, đảo hiện tại, sự kiện...).
 * Lớp này CHỈ giữ dữ liệu trong bộ nhớ; việc lưu / nạp (máy này hoặc server) do SaveManager (store.js) lo:
 *  - serialize() / hydrate(data): xuất / nạp dữ liệu
 *  - save(): báo "có thay đổi" cho SaveManager (nó tự gom lại và lưu sau vài giây)
 *  - logEvent(): ghi nhật ký sự kiện (nhiệm vụ xong, trận đấu, nhận mod...), gửi kèm khi lưu lên server
 */
export class GameState {
  constructor(data = null) {
    this.onChange = null; // SaveManager gắn vào
    this.reset();
    if (data) this.hydrate(data);
  }

  reset() {
    this.party = []; // [{ uid, id, level }]
    this.stats = { ...DEFAULT_STATS }; // chỉ số toàn cục (nhiệm vụ tân thủ)
    this.done = {};
    this.islandIndex = 0;
    this.island = newIsland(); // tiến độ riêng của đảo hiện tại (reset khi sang đảo mới)
    this.inv = { bread: 3, apple: 2 }; // hành trang đồ ăn: { id: số lượng }. Quà khởi đầu để không bị đói ngay
    this.vitals = { hunger: 100, stamina: 100 };
    this.events = []; // nhật ký gần đây (lưu kèm bản lưu)
    this.pending = []; // sự kiện chưa gửi lên server
    this.playtime = 0; // giây đã chơi
  }

  /** Nạp dữ liệu (từ máy hoặc server) vào chính đối tượng này, các nơi đang tham chiếu vẫn dùng được. */
  hydrate(d) {
    const keepHandler = this.onChange;
    this.reset();
    this.onChange = keepHandler;
    if (!d || typeof d !== 'object') return this;
    if (Array.isArray(d.party)) {
      this.party = d.party
        .filter((e) => e && typeof e.id === 'string')
        .map((e) => ({
          uid: e.uid ?? `${e.id}-${Math.random().toString(36).slice(2, 8)}`,
          id: LEGACY_MOD_IDS[e.id] ?? e.id,
          level: Math.min(30, Math.max(1, Math.floor(num(e.level, 1)))),
        }));
    }
    if (d.stats) this.stats = { ...DEFAULT_STATS, ...d.stats };
    if (d.done) this.done = { ...d.done };
    if (Number.isInteger(d.islandIndex)) this.islandIndex = d.islandIndex;
    if (d.island) {
      const base = newIsland();
      this.island = {
        stats: { ...base.stats, ...(d.island.stats ?? {}) },
        done: { ...(d.island.done ?? {}) },
        visited: Array.isArray(d.island.visited) ? [...d.island.visited] : [],
      };
    }
    if (d.inv && typeof d.inv === 'object') {
      this.inv = {};
      for (const [id, n] of Object.entries(d.inv)) if (num(n) > 0) this.inv[id] = Math.floor(n);
    }
    if (d.vitals) this.vitals = { hunger: num(d.vitals.hunger, 100), stamina: num(d.vitals.stamina, 100) };
    if (Array.isArray(d.events)) this.events = d.events.slice(-MAX_EVENTS);
    this.playtime = num(d.playtime, 0);
    return this;
  }

  serialize() {
    return JSON.parse(
      JSON.stringify({
        v: SAVE_VERSION,
        savedAt: Date.now(),
        party: this.party,
        stats: this.stats,
        done: this.done,
        islandIndex: this.islandIndex,
        island: this.island,
        inv: this.inv,
        vitals: this.vitals,
        events: this.events,
        playtime: Math.round(this.playtime),
      }),
    );
  }

  /** Báo có thay đổi cần lưu (SaveManager tự gom và lưu sau vài giây). */
  save() {
    this.onChange?.();
  }

  /** Đã có tiến trình đáng kể chưa (để menu chính hiện "Tiếp tục" thay vì "Chơi"). */
  hasProgress() {
    return this.party.length > 0 || Object.keys(this.done).length > 0 || this.stats.distance > 5;
  }

  logEvent(type, payload = {}) {
    const ev = { t: Date.now(), type, ...payload };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.pending.push({ type, payload, t: ev.t });
    this.save();
  }

  takeEvents() {
    const e = this.pending;
    this.pending = [];
    return e;
  }

  requeueEvents(list) {
    this.pending = list.concat(this.pending).slice(-200);
  }

  addMod(id, level = 1) {
    const entry = { uid: `${id}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`, id, level };
    this.party.push(entry);
    this.logEvent('mod_obtained', { mod: id });
    return entry;
  }

  /** Mod đầu tiên còn hợp lệ trong đội (isValid(id) kiểm tra id còn tồn tại trong MOD_DEFS). */
  lead(isValid = () => true) {
    return this.party.find((e) => isValid(e.id)) ?? null;
  }

  maxLevel() {
    return Math.max(1, ...this.party.map((e) => e.level));
  }

  addFood(id, n = 1) {
    this.inv[id] = (this.inv[id] ?? 0) + n;
    this.save();
  }

  recordWin() {
    this.stats.wins += 1;
    this.island.stats.wins += 1;
    this.save();
  }

  recordMeet() {
    this.stats.meets += 1;
    this.island.stats.meets += 1;
    this.save();
  }

  /** Chuyển sang đảo `index`; reset = true thì xoá tiến độ nhiệm vụ đảo. */
  setIsland(index, reset = true) {
    this.islandIndex = index;
    if (reset) this.island = newIsland();
    this.logEvent('island_enter', { island: index });
  }
}

export class QuestManager {
  constructor(state, { onComplete, onIslandQuest } = {}) {
    this.state = state;
    this.onComplete = onComplete;
    this.onIslandQuest = onIslandQuest;
    this.last = null;
    this.startY = 0;
    this.lastJumps = 0;
    this.lastSavedDistance = 0;
    this.island = null;
    this.nextName = '';
    this.islandComplete = false; // true khi đã xong HẾT nhiệm vụ của đảo hiện tại
  }

  /** Báo cho QuestManager biết đảo hiện tại (đảo mới -> theo dõi lại từ đầu). */
  setIsland(def, nextDef) {
    this.island = def;
    this.nextName = nextDef?.name ?? '';
    this.last = null; // tránh tính quãng đường "dịch chuyển" vào số mét đã đi
    this.checkIsland();
  }

  update(player, dt) {
    const s = this.state.stats;
    const p = player.position;
    if (!this.last) {
      this.last = { x: p.x, z: p.z };
      this.startY = p.y;
      this.lastJumps = player.jumpCount;
    }
    const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
    if (d < 5) s.distance += d; // bỏ qua các bước nhảy vọt (dịch chuyển)
    this.last.x = p.x;
    this.last.z = p.z;
    s.maxClimb = Math.max(s.maxClimb, p.y - this.startY);
    s.jumps += player.jumpCount - this.lastJumps;
    this.lastJumps = player.jumpCount;

    this.check();
    this.checkIsland();

    if (s.distance - this.lastSavedDistance > 25) {
      this.lastSavedDistance = s.distance; // đi thêm ~25 m thì báo có thay đổi (SaveManager tự gom lại)
      this.state.save();
    }
  }

  check() {
    for (const q of QUEST_DEFS) {
      if (this.state.done[q.id]) continue;
      if ((this.state.stats[q.stat] ?? 0) >= q.goal) {
        this.state.done[q.id] = true;
        const entry = this.state.addMod(q.reward);
        this.state.logEvent('quest_done', { quest: q.id, reward: q.reward });
        this.onComplete?.(q, entry);
      }
    }
  }

  checkIsland() {
    const def = this.island;
    if (!def) return;
    const st = this.state.island;
    for (const q of def.quests) {
      if (st.done[q.id]) continue;
      if ((st.stats[q.stat] ?? 0) >= q.goal) {
        st.done[q.id] = true;
        const lead = this.state.lead();
        if (lead && lead.level < MAX_LEVEL) lead.level += 1; // thưởng: +1 Lv cho mod dẫn đầu
        this.state.logEvent('island_quest_done', { quest: q.id, island: this.state.islandIndex });
        this.onIslandQuest?.(q, lead);
      }
    }
    this.islandComplete = def.quests.every((q) => st.done[q.id]);
  }

  snapshot(library) {
    const st = this.state.island;
    return {
      starter: QUEST_DEFS.map((q) => ({
        title: q.title,
        desc: q.desc,
        goal: q.goal,
        value: Math.min(q.goal, this.state.stats[q.stat] ?? 0),
        done: !!this.state.done[q.id],
        rewardName: library.def(q.reward)?.name ?? q.reward,
      })),
      island: {
        name: this.island?.name ?? '',
        next: this.nextName,
        quests: (this.island?.quests ?? []).map((q) => ({
          title: q.title,
          desc: q.desc,
          goal: q.goal,
          value: Math.min(q.goal, st.stats[q.stat] ?? 0),
          done: !!st.done[q.id],
          rewardName: '+1 Lv cho mod dẫn đầu',
        })),
      },
      party: this.state.party.map((e) => ({ name: library.def(e.id)?.name ?? e.id, level: e.level })),
    };
  }
}
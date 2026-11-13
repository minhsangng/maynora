const SAVE_KEY = 'infinite-terrain-save-v1';
const MAX_LEVEL = 30;

/**
 * Nhiệm vụ TÂN THỦ: nhận mod. stat = chỉ số theo dõi, goal = mục tiêu, reward = id mod trong MOD_DEFS.
 * (Nhiệm vụ của từng đảo - để được dịch chuyển sang đảo khác - nằm trong islands.js)
 */
export const QUEST_DEFS = [
  { id: 'walk', title: 'Bước chân đầu tiên', desc: 'Đi bộ tổng cộng 150 m', stat: 'distance', goal: 150, reward: 'quy_ti' },
  { id: 'jump', title: 'Nhảy cẫng lên', desc: 'Nhảy 5 lần', stat: 'jumps', goal: 5, reward: 'ca_sau' },
  { id: 'climb', title: 'Leo đồi', desc: 'Leo cao hơn điểm xuất phát 15 m', stat: 'maxClimb', goal: 15, reward: 'nhat_long' },
  { id: 'meet', title: 'Làm quen', desc: 'Lại gần 3 mod hoang dã', stat: 'meets', goal: 3, reward: 'quy_su' },
];

const DEFAULT_STATS = { distance: 0, jumps: 0, maxClimb: 0, meets: 0, wins: 0 };
const newIsland = () => ({ stats: { landmarks: 0, wins: 0, meets: 0 }, done: {}, visited: [] });

/** Dữ liệu người chơi: đội mod + tiến độ nhiệm vụ + đang ở đảo nào. Lưu vào localStorage. */
export class GameState {
  constructor() {
    this.party = []; // [{ uid, id, level }]
    this.stats = { ...DEFAULT_STATS }; // chỉ số toàn cục (nhiệm vụ tân thủ)
    this.done = {};
    this.islandIndex = 0;
    this.island = newIsland(); // tiến độ riêng của đảo hiện tại (reset khi sang đảo mới)
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.party)) this.party = d.party;
      if (d.stats) this.stats = { ...DEFAULT_STATS, ...d.stats };
      if (d.done) this.done = d.done;
      if (Number.isInteger(d.islandIndex)) this.islandIndex = d.islandIndex;
      if (d.island) {
        const base = newIsland();
        this.island = {
          stats: { ...base.stats, ...(d.island.stats ?? {}) },
          done: d.island.done ?? {},
          visited: Array.isArray(d.island.visited) ? d.island.visited : [],
        };
      }
    } catch {
      /* bỏ qua */
    }
  }

  save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ party: this.party, stats: this.stats, done: this.done, islandIndex: this.islandIndex, island: this.island }),
      );
    } catch {
      /* bỏ qua */
    }
  }

  addMod(id, level = 1) {
    const entry = { uid: `${id}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`, id, level };
    this.party.push(entry);
    this.save();
    return entry;
  }

  /** Mod đầu tiên còn hợp lệ trong đội (isValid(id) kiểm tra id còn tồn tại trong MOD_DEFS). */
  lead(isValid = () => true) {
    return this.party.find((e) => isValid(e.id)) ?? null;
  }

  maxLevel() {
    return Math.max(1, ...this.party.map((e) => e.level));
  }

  recordWin() {
    this.stats.wins += 1;
    this.island.stats.wins += 1;
  }

  recordMeet() {
    this.stats.meets += 1;
    this.island.stats.meets += 1;
  }

  /** Chuyển sang đảo `index`; reset = true thì xoá tiến độ nhiệm vụ đảo. */
  setIsland(index, reset = true) {
    this.islandIndex = index;
    if (reset) this.island = newIsland();
    this.save();
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
    this.saveTimer = 0;
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

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.state.save();
    }
  }

  check() {
    for (const q of QUEST_DEFS) {
      if (this.state.done[q.id]) continue;
      if ((this.state.stats[q.stat] ?? 0) >= q.goal) {
        this.state.done[q.id] = true;
        const entry = this.state.addMod(q.reward); // addMod đã lưu
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
        this.state.save();
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
import * as THREE from 'three';

const ARENA_GAP = 9; // khoảng cách giữa 2 mod (mét) = "không gian chiến đấu"
const PLAYER_TO_MOD = 2.5; // mod của bạn đứng cách player bao xa
const CAM_SIDE = 12; // camera dịch sang bên bao xa
const CAM_UP = 5.5; // ... và lên cao bao nhiêu
const CAM_LOOK_UP = 1.2;
const CAM_BLEND = 0.9; // giây chuyển camera vào / ra trận đấu
const SUMMON_AT = 0.55; // mod xuất hiện ở % nào của clip triệu hồi
const SUMMON_FALLBACK = 1.4; // giây chờ nếu model không có clip triệu hồi
const MAX_LEVEL = 30;

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);

/** Sát thương 1 đòn. rng để test. */
export function calcDamage(att, tgt, move, rng = Math.random) {
  const base = (att.stats.atk * move.power) / 8;
  const mitigation = 30 / (30 + tgt.stats.defense);
  return Math.max(1, Math.round(base * mitigation * (0.88 + rng() * 0.24)));
}

/**
 * Thách đấu theo lượt:
 *  intro  -> player làm animation triệu hồi, camera dịch sang bên, mod xuất hiện
 *  choose -> chọn chiêu (phím 1..9) hoặc bỏ chạy (F)
 *  turn   -> 2 bên lần lượt ra đòn (bên nhanh hơn đi trước)
 *  outro  -> thu mod về, camera quay lại
 */
export class BattleSystem {
  constructor({ scene, camera, player, terrain, library, effects, ui, state, wild }) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.terrain = terrain;
    this.library = library;
    this.effects = effects;
    this.ui = ui;
    this.state = state;
    this.wild = wild;

    this.phase = 'none';
    this.lastPhase = 'none';
    this.phaseTime = 0;
    this.time = 0;
    this.queue = [];
    this.camOn = false;
    this.camW = 0;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.A = new THREE.Vector3(); // chỗ mod của bạn đứng
    this.B = new THREE.Vector3(); // chỗ mod hoang dã đứng
    this.mine = null;
    this.foe = null;
    this.entry = null;
    this.foeMove = null;
  }

  get active() {
    return this.phase !== 'none';
  }

  later(delay, fn) {
    this.queue.push({ at: this.time + delay, fn });
  }

  start(foe) {
    if (this.active) return;
    try {
      this.begin(foe);
    } catch (err) {
      this.abort(err);
    }
  }

  begin(foe) {
    const entry = this.state.lead((id) => this.library.def(id));
    if (!entry) {
      this.ui.toast('Bạn chưa có mod nào! Nhấn Q để xem nhiệm vụ nhận mod tân thủ.');
      return;
    }
    this.phase = 'intro';
    this.entry = entry;
    this.foe = foe;
    foe.engaged = true;
    foe.moving = false;

    // Hình học khu đấu: player -> A (mod bạn) -> B (mod hoang dã) nằm trên 1 đường thẳng
    const P = this.player.position;
    const d = new THREE.Vector3(foe.group.position.x - P.x, 0, foe.group.position.z - P.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.normalize();
    this.A.set(P.x + d.x * PLAYER_TO_MOD, 0, P.z + d.z * PLAYER_TO_MOD);
    this.A.y = this.terrain.height(this.A.x, this.A.z);
    this.B.copy(this.A).addScaledVector(d, ARENA_GAP);
    this.B.y = this.terrain.height(this.B.x, this.B.z);

    // Camera: dịch sang 1 bên + lên cao, nhìn vào giữa 2 mod
    const C = this.A.clone().add(this.B).multiplyScalar(0.5);
    const side = new THREE.Vector3(d.z, 0, -d.x);
    if (this.camera.position.clone().sub(C).dot(side) < 0) side.negate(); // chọn bên gần camera hiện tại
    this.camPos.copy(C).addScaledVector(side, CAM_SIDE);
    this.camPos.y = Math.max(C.y + CAM_UP, this.terrain.height(this.camPos.x, this.camPos.z) + 2.5);
    const look = new THREE.Vector3(C.x, C.y + CAM_LOOK_UP, C.z);
    this.camQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.camPos, look, UP));
    this.camOn = true;

    // Khoá player, quay mặt về phía khu đấu, làm animation triệu hồi
    this.player.locked = true;
    this.player.forceBody = true;
    this.player.faceYaw = Math.atan2(-d.x, -d.z);
    const clip = Math.min(this.player.playOnce('summon'), 5);
    const total = clip > 0 ? clip : SUMMON_FALLBACK;
    this.later(clip > 0 ? clip * SUMMON_AT : SUMMON_FALLBACK * 0.5, () => this.summonMod());
    this.later(total + 0.2, () => {
      this.player.endOnce();
      this.enterChoose();
    });

    // Mod hoang dã chạy về vị trí đấu, quay mặt vào đối thủ
    this.foeMove = { from: foe.group.position.clone(), t: 0, dur: 1.0 };
    this.ui.battleShow();
    this.ui.say(`Bạn thách đấu ${foe.tag}!`);
  }

  /** Gặp lỗi giữa chừng: hiện lỗi lên màn hình, dọn sạch và trả điều khiển cho người chơi. */
  abort(err) {
    console.error('[battle]', err);
    this.ui.toast(`Lỗi trận đấu: ${err?.message ?? err}`, 8000);
    this.queue = [];
    this.ui.battleHide();
    if (this.mine) {
      this.mine.vanish(0.3);
      this.effects.adopt(this.mine);
    }
    if (this.foe && !this.foe.fainted) {
      this.foe.engaged = false;
      this.foe.moving = false;
    }
    this.mine = null;
    this.foe = null;
    this.foeMove = null;
    this.camOn = false;
    this.player.endOnce();
    this.player.locked = false;
    this.player.forceBody = false;
    this.player.faceYaw = null;
    this.phase = 'none';
  }

  /** Bộ giám sát: 1 pha kéo dài bất thường thì tự cứu. */
  watchdog() {
    if (this.phase === 'intro' && this.phaseTime > 12) {
      console.warn('[battle] pha intro quá lâu -> ép sang chọn chiêu');
      if (this.mine) {
        this.player.endOnce();
        this.enterChoose();
      } else this.abort(new Error('không triệu hồi được mod'));
    } else if (this.phase === 'turn' && this.phaseTime > 25) {
      this.abort(new Error('lượt đấu bị treo'));
    } else if (this.phase === 'outro' && this.phaseTime > 4) {
      this.abort(new Error('kết thúc trận bị treo'));
    }
  }

  summonMod() {
    const entry = this.entry;
    this.mine = this.library.spawn(entry.id, { level: entry.level, owner: 'player' });
    this.mine.group.position.copy(this.A);
    this.mine.faceDir(this.B.x - this.A.x, this.B.z - this.A.z, true);
    this.mine.spawnIn(0.6);
    this.scene.add(this.mine.group);
    this.effects.ring(this.A, this.mine.def.color ?? 0xffffff, 2.5);
    this.ui.say(`${this.mine.name}, ra đây!`);
  }

  enterChoose() {
    if (this.phase !== 'intro') return;
    this.phase = 'choose';
    this.ui.battleMoves(this.mine.def.moves);
    this.ui.say(`Chọn chiêu cho ${this.mine.name}!`);
  }

  onKey(code) {
    if (this.phase !== 'choose') return;
    const moves = this.mine.def.moves;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m && Number(m[1]) <= moves.length) this.useMove(Number(m[1]) - 1);
    else if (code === 'KeyF') this.flee();
  }

  useMove(i) {
    this.phase = 'turn';
    this.ui.battleHideMoves();
    const { mine, foe } = this;
    const mMove = mine.def.moves[i];
    const fMove = foe.def.moves[Math.floor(Math.random() * foe.def.moves.length)];
    const order =
      mine.stats.spd >= foe.stats.spd
        ? [[mine, foe, mMove], [foe, mine, fMove]]
        : [[foe, mine, fMove], [mine, foe, mMove]];
    this.step(order, 0);
  }

  step(order, idx) {
    if (idx >= order.length) return this.afterTurn();
    const [att, tgt, move] = order[idx];
    if (att.hp <= 0 || tgt.hp <= 0) return this.afterTurn(); // 1 bên đã gục giữa lượt
    this.ui.say(`${att.name} dùng ${move.name}!`);
    const dx = tgt.group.position.x - att.group.position.x;
    const dz = tgt.group.position.z - att.group.position.z;
    att.faceDir(dx, dz);
    att.attack(Math.max(0, Math.hypot(dx, dz) - 1.8)); // lao tới sát đối thủ rồi lùi lại
    this.later(0.35, () => {
      if (Math.random() * 100 >= (move.accuracy ?? 100)) {
        this.ui.say(`${att.name} đánh trượt!`);
        return;
      }
      const dmg = calcDamage(att, tgt, move);
      tgt.takeDamage(dmg);
      tgt.hit();
      this.ui.say(`${tgt.name} mất ${dmg} HP!`);
    });
    this.later(1.3, () => this.step(order, idx + 1));
  }

  afterTurn() {
    if (this.foe.hp <= 0) this.victory();
    else if (this.mine.hp <= 0) this.defeat();
    else {
      this.phase = 'choose';
      this.ui.battleMoves(this.mine.def.moves);
      this.ui.say(`Chọn chiêu cho ${this.mine.name}!`);
    }
  }

  victory() {
    const { foe, mine, entry } = this;
    foe.faint();
    this.wild.release(foe); // không còn là mod hoang dã; Effects dọn khi đã mờ hẳn
    this.effects.adopt(foe);
    this.ui.say(`${foe.name} đã gục. Bạn thắng!`);
    if (entry.level < MAX_LEVEL) {
      entry.level += 1;
      this.ui.toast(`${mine.name} lên Lv ${entry.level}!`);
    }
    this.state.recordWin();
    this.state.save();
    this.later(1.8, () => this.finish());
  }

  defeat() {
    this.mine.faint();
    this.ui.say(`${this.mine.name} đã gục... Bạn thua trận này.`);
    this.later(1.8, () => this.finish());
  }

  flee() {
    this.phase = 'turn';
    this.ui.battleHideMoves();
    this.ui.say('Bạn rút lui!');
    this.later(0.6, () => this.finish());
  }

  finish() {
    this.phase = 'outro';
    this.camOn = false;
    this.ui.battleHide();
    if (this.mine) {
      if (!this.mine.fainted) {
        this.effects.ring(this.mine.group.position, this.mine.def.color ?? 0xffffff, 2.2);
        this.mine.vanish(0.4);
      }
      this.effects.adopt(this.mine); // tự dọn khi đã biến mất / mờ hẳn
    }
    if (this.foe && !this.foe.fainted) {
      this.foe.engaged = false;
      this.foe.moving = false;
    }
    this.mine = null;
    this.foe = null;
    this.foeMove = null;
    this.later(CAM_BLEND, () => {
      this.phase = 'none';
      this.player.locked = false;
      this.player.forceBody = false;
      this.player.faceYaw = null;
    });
  }

  /** Gọi mỗi frame, SAU player.update (vì có chỉnh camera). */
  update(dt) {
    this.time += dt;
    if (this.phase !== this.lastPhase) {
      this.lastPhase = this.phase;
      this.phaseTime = 0;
    } else {
      this.phaseTime += dt;
    }
    if (this.active) this.watchdog(); // kiểm tra TRƯỚC khi chạy callback (lúc đó phase và phaseTime còn khớp nhau)

    if (this.queue.length > 0) {
      const due = this.queue.filter((q) => q.at <= this.time);
      if (due.length > 0) {
        this.queue = this.queue.filter((q) => q.at > this.time);
        try {
          due.sort((a, b) => a.at - b.at).forEach((q) => q.fn());
        } catch (err) {
          this.abort(err);
        }
      }
    }

    if (this.foeMove && this.foe) {
      const m = this.foeMove;
      m.t += dt;
      const u = ease(Math.min(1, m.t / m.dur));
      const p = this.foe.group.position;
      p.x = m.from.x + (this.B.x - m.from.x) * u;
      p.z = m.from.z + (this.B.z - m.from.z) * u;
      p.y = this.terrain.height(p.x, p.z);
      this.foe.moving = u < 1;
      this.foe.faceDir(this.A.x - p.x, this.A.z - p.z);
      if (u >= 1) this.foeMove = null;
    }

    this.mine?.update(dt);

    // Pha trộn camera: người chơi (đã được Player.update đặt) <-> camera trận đấu
    const rate = dt / CAM_BLEND;
    this.camW = this.camOn ? Math.min(1, this.camW + rate) : Math.max(0, this.camW - rate);
    if (this.camW > 0) {
      const e = ease(this.camW);
      this.camera.position.lerp(this.camPos, e);
      this.camera.quaternion.slerp(this.camQuat, e);
    }

    if (this.active) this.ui.battleUpdate(this.mine, this.foe);
  }
}
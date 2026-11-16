import * as THREE from 'three';
import { rollDrops } from './drops';
import { FOOD_INFO } from './fooddefs';

const ARENA_GAP = 10; // khoảng cách giữa 2 mod lúc đứng chờ (mét) = "không gian chiến đấu"
const PLAYER_TO_MOD = 2.5; // mod của bạn đứng cách player bao xa
const CAM_SIDE = 13; // camera dịch sang bên bao xa
const CAM_UP = 5.5; // ... và lên cao bao nhiêu
const CAM_LOOK_UP = 1.2;
const CAM_BLEND = 0.9; // giây chuyển camera vào / ra trận đấu
const SUMMON_AT = 0.55; // mod xuất hiện ở % nào của clip triệu hồi
const SUMMON_FALLBACK = 1.4; // giây chờ nếu model không có clip triệu hồi
const MAX_LEVEL = 30;
const RUN_SPEED = 9; // m/s: mod lao tới đối thủ
const BACK_SPEED = 6; // m/s: mod quay về chỗ cũ
const STRIKE_GAP = 1.9; // dừng cách đối thủ bao xa để ra đòn
const MAX_ROUNDS = 30; // quá số hiệp này thì hoà (trận thường chỉ 4-10 hiệp)

const UP = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);

/** Sát thương 1 đòn. rng để test. */
export function calcDamage(att, tgt, move, rng = Math.random) {
  const base = (att.stats.atk * move.power) / 8;
  const mitigation = 30 / (30 + tgt.stats.defense);
  return Math.max(1, Math.round(base * mitigation * (0.88 + rng() * 0.24)));
}

/**
 * AI chọn chiêu: chọn ngẫu nhiên có trọng số theo (sát thương kỳ vọng)². Chiêu mạnh được chọn nhiều nhất,
 * nhưng các chiêu khác vẫn thỉnh thoảng được dùng nên trận đấu và animation đa dạng. Đòn có thể kết liễu thì được ưu tiên hơn.
 */
export function chooseMove(att, tgt, rng = Math.random) {
  const moves = att.def.moves;
  const weights = moves.map((m) => {
    const expected = calcDamage(att, tgt, m, () => 0.5) * ((m.accuracy ?? 100) / 100);
    const w = expected * (expected >= tgt.hp ? 1.5 : 1);
    return w * w;
  });
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

/**
 * Thách đấu TỰ ĐỘNG (người chơi không điều khiển mod):
 *  intro -> player làm animation triệu hồi, camera dịch sang bên, mod xuất hiện
 *  fight -> mỗi hiệp 2 mod lần lượt (bên nhanh hơn đi trước): tự chọn chiêu, chạy tới, ra đòn bằng animation
 *           của chiêu, quay về chỗ. Lặp đến khi 1 bên gục. Nhấn F để rút lui.
 *  outro -> thu mod về, camera quay lại
 */
export class BattleSystem {
  constructor({ scene, camera, player, terrain, library, effects, ui, state, wild, drops = null }) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.terrain = terrain;
    this.library = library;
    this.effects = effects;
    this.ui = ui;
    this.state = state;
    this.wild = wild;
    this.drops = drops; // vật phẩm rơi trên đất (null = cộng thẳng vào túi)

    this.phase = 'none';
    this.lastPhase = 'none';
    this.phaseTime = 0;
    this.time = 0;
    this.queue = [];
    this.tweens = [];
    this.camOn = false;
    this.camW = 0;
    this.camPos = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.A = new THREE.Vector3(); // chỗ mod của bạn đứng
    this.B = new THREE.Vector3(); // chỗ mod hoang dã đứng
    this.mine = null;
    this.foe = null;
    this.entry = null;
    this.round = 0;
    this.fleeRequested = false;
  }

  get active() {
    return this.phase !== 'none';
  }

  later(delay, fn) {
    this.queue.push({ at: this.time + delay, fn });
  }

  /** Di chuyển mod tới `to` trong `dur` giây (bám địa hình), xong gọi onDone. */
  tween(actor, to, dur, onDone) {
    this.tweens.push({ actor, from: actor.group.position.clone(), to: to.clone(), t: 0, dur, onDone });
  }

  /** Bắt đầu trận với mod hoang dã `foe`. `entry` = mod người chơi CHỌN từ đội (không chọn thì lấy mod đầu tiên). */
  start(foe, entry = null) {
    if (this.active) return;
    try {
      this.begin(foe, entry);
    } catch (err) {
      this.abort(err);
    }
  }

  begin(foe, chosen) {
    const entry = chosen && this.library.def(chosen.id) ? chosen : this.state.lead((id) => this.library.def(id));
    if (!entry) {
      this.ui.toast('Bạn chưa có mod nào! Nhấn Q để xem nhiệm vụ nhận mod tân thủ.');
      return;
    }
    this.phase = 'intro';
    this.entry = entry;
    this.foe = foe;
    this.round = 0;
    this.fleeRequested = false;
    foe.engaged = true;

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
      this.enterFight();
    });

    // Mod hoang dã chạy về vị trí đấu, rồi quay mặt vào đối thủ
    foe.moving = true;
    foe.running = true;
    foe.faceDir(this.B.x - foe.group.position.x, this.B.z - foe.group.position.z);
    this.tween(foe, this.B, 1.0, () => {
      foe.moving = false;
      foe.running = false;
      foe.faceDir(this.A.x - this.B.x, this.A.z - this.B.z);
    });
    this.ui.battleShow();
    this.ui.say(`Bạn thách đấu ${foe.tag}!`);
  }

  /** Gặp lỗi giữa chừng: hiện lỗi lên màn hình, dọn sạch và trả điều khiển cho người chơi. */
  abort(err) {
    console.error('[battle]', err);
    this.ui.toast(`Lỗi trận đấu: ${err?.message ?? err}`, 8000);
    this.queue = [];
    this.tweens = [];
    this.ui.battleHide();
    if (this.mine) {
      this.mine.vanish(0.3);
      this.effects.adopt(this.mine);
    }
    if (this.foe && !this.foe.fainted) {
      this.foe.engaged = false;
      this.foe.moving = false;
      this.foe.running = false;
    }
    this.mine = null;
    this.foe = null;
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
      console.warn('[battle] pha intro quá lâu -> ép vào trận');
      if (this.mine) {
        this.player.endOnce();
        this.enterFight();
      } else this.abort(new Error('không triệu hồi được mod'));
    } else if (this.phase === 'fight' && this.phaseTime > 420) {
      this.abort(new Error('trận đấu kéo dài bất thường'));
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

  enterFight() {
    if (this.phase !== 'intro') return;
    this.phase = 'fight';
    this.ui.battleHint('Trận đấu tự động — nhấn F để rút lui');
    this.ui.say(`${this.mine.name} đối đầu ${this.foe.name}!`);
    this.later(0.7, () => this.nextRound());
  }

  onKey(code) {
    if (code === 'KeyF' && this.phase === 'fight' && !this.fleeRequested) {
      this.fleeRequested = true;
      this.ui.say('Bạn ra lệnh rút lui...');
    }
  }

  nextRound() {
    if (this.phase !== 'fight') return;
    const { mine, foe } = this;
    if (mine.hp <= 0 || foe.hp <= 0) return this.endFight();
    if (this.fleeRequested) return this.flee();
    if (++this.round > MAX_ROUNDS) return this.draw();
    const order = mine.stats.spd >= foe.stats.spd ? [mine, foe] : [foe, mine]; // bên nhanh hơn đánh trước
    this.step(order, 0);
  }

  step(order, idx) {
    if (this.phase !== 'fight') return;
    if (idx >= order.length) {
      this.later(0.4, () => this.nextRound());
      return;
    }
    const att = order[idx];
    const tgt = att === this.mine ? this.foe : this.mine;
    if (att.hp <= 0 || tgt.hp <= 0) return this.nextRound();
    const move = chooseMove(att, tgt);
    this.ui.say(`${att.name} dùng ${move.name}!`);
    this.strike(att, tgt, move, () => this.step(order, idx + 1));
  }

  /** Chạy tới sát đối thủ -> ra đòn bằng animation của chiêu -> đòn trúng -> quay về chỗ cũ. */
  strike(att, tgt, move, done) {
    const home = att === this.mine ? this.A : this.B;
    const from = att.group.position;
    const dx = tgt.group.position.x - from.x;
    const dz = tgt.group.position.z - from.z;
    const dist = Math.hypot(dx, dz) || 1;
    const stop = tgt.group.position.clone();
    stop.x -= (dx / dist) * STRIKE_GAP;
    stop.z -= (dz / dist) * STRIKE_GAP;

    att.faceDir(dx, dz);
    att.moving = true;
    att.running = true;
    this.tween(att, stop, Math.max(0.25, Math.max(0, dist - STRIKE_GAP) / RUN_SPEED), () => {
      att.moving = false;
      att.running = false;
      att.faceDir(tgt.group.position.x - att.group.position.x, tgt.group.position.z - att.group.position.z);
      const dur = Math.min(att.attack(move.anim), 3);
      this.later(Math.min(dur * (move.impact ?? 0.45), 1.5), () => this.resolveHit(att, tgt, move));
      this.later(dur + 0.2, () => {
        att.moving = true;
        att.faceDir(home.x - att.group.position.x, home.z - att.group.position.z);
        const back = Math.max(0.25, att.group.position.distanceTo(home) / BACK_SPEED);
        this.tween(att, home, back, () => {
          att.moving = false;
          const o = att === this.mine ? this.B : this.A;
          att.faceDir(o.x - home.x, o.z - home.z);
          done();
        });
      });
    });
  }

  resolveHit(att, tgt, move) {
    if (this.phase !== 'fight' || tgt.hp <= 0) return;
    if (Math.random() * 100 >= (move.accuracy ?? 100)) {
      this.ui.say(`${att.name} đánh trượt!`);
      return;
    }
    const dmg = calcDamage(att, tgt, move);
    tgt.takeDamage(dmg);
    tgt.hit();
    this.ui.say(`${tgt.name} mất ${dmg} HP!`);
    if (tgt.hp <= 0) tgt.faint(); // gục ngay tại chỗ
  }

  endFight() {
    if (this.foe.hp <= 0) this.victory();
    else this.defeat();
  }

  victory() {
    const { foe, mine, entry } = this;
    foe.faint();
    this.wild.release(foe); // không còn là mod hoang dã; Effects dọn khi đã mờ hẳn
    this.effects.adopt(foe);
    const d = mine.win();
    this.ui.say(`${foe.name} đã gục. ${mine.name} chiến thắng!`);
    if (entry.level < MAX_LEVEL) {
      entry.level += 1;
      this.ui.toast(`${mine.name} lên Lv ${entry.level}!`);
    }
    this.dropLoot(foe);
    this.state.recordWin();
    this.state.save();
    this.later(Math.max(2, d + 0.5), () => this.finish());
  }

  /** Chiến lợi phẩm rơi xuống đất tại chỗ mod hoang dã gục; lại gần là nhặt (có model riêng, xem foodDefs.js). */
  dropLoot(foe) {
    const ids = rollDrops(foe.def);
    if (ids.length === 0) return;
    const p = foe.group.position;
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2 + 0.7;
      const r = ids.length > 1 ? 1.3 : 0;
      if (this.drops) this.drops.spawn(id, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
      else this.state.addFood?.(id, 1);
    });
    this.effects.ring(p, 0xffd54a, 1.6);
    const counts = {};
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    const text = Object.entries(counts).map(([id, n]) => `${FOOD_INFO[id]?.name ?? id} ×${n}`).join(', ');
    this.ui.toast(`Chiến lợi phẩm rơi ra: ${text} — lại gần để nhặt`, 4500);
  }

  defeat() {
    const { foe, mine } = this;
    mine.faint();
    foe.win();
    this.ui.say(`${mine.name} đã gục... Bạn thua trận này.`);
    this.later(2.2, () => this.finish());
  }

  draw() {
    this.ui.say('Hai bên đều kiệt sức — hoà!');
    this.later(1.5, () => this.finish());
  }

  flee() {
    this.phase = 'outro';
    this.ui.say('Bạn rút lui!');
    this.later(0.6, () => this.finish());
  }

  finish() {
    this.phase = 'outro';
    this.camOn = false;
    this.tweens = [];
    this.ui.battleHide();
    if (this.mine) {
      if (!this.mine.fainted) {
        this.effects.ring(this.mine.group.position, this.mine.def.color ?? 0xffffff, 2.2);
        this.mine.vanish(0.4);
      }
      this.mine.moving = false;
      this.effects.adopt(this.mine); // tự dọn khi đã biến mất / mờ hẳn
    }
    if (this.foe && !this.foe.fainted) {
      this.foe.engaged = false;
      this.foe.moving = false;
      this.foe.running = false;
    }
    this.mine = null;
    this.foe = null;
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

    try {
      if (this.queue.length > 0) {
        const due = this.queue.filter((q) => q.at <= this.time);
        if (due.length > 0) {
          this.queue = this.queue.filter((q) => q.at > this.time);
          due.sort((a, b) => a.at - b.at).forEach((q) => q.fn());
        }
      }

      if (this.tweens.length > 0) {
        const finished = [];
        for (const tw of this.tweens) {
          tw.t += dt;
          const u = ease(Math.min(1, tw.t / tw.dur));
          const p = tw.actor.group.position;
          p.x = tw.from.x + (tw.to.x - tw.from.x) * u;
          p.z = tw.from.z + (tw.to.z - tw.from.z) * u;
          p.y = this.terrain.height(p.x, p.z);
          if (tw.t >= tw.dur) finished.push(tw);
        }
        if (finished.length > 0) {
          this.tweens = this.tweens.filter((tw) => !finished.includes(tw));
          finished.forEach((tw) => tw.onDone?.());
        }
      }
    } catch (err) {
      this.abort(err);
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
import { FOOD_INFO } from './fooddefs';

// --- Cân bằng (chỉnh ở đây) ---------------------------------------------
// effort = tốc độ hiện tại / tốc độ đi bộ: 0 đứng yên, 1 đi bộ, ~2.3 chạy nhanh (chạy 28 m/s / đi 12 m/s)
const STAMINA_REGEN = 18; // thể lực hồi / giây khi đứng yên (giảm dần về 0 khi tăng tốc tới mức đi bộ)
const STAMINA_DRAIN = 7; // tốn / giây cho mỗi 1.0 effort VƯỢT mức đi bộ => chạy càng nhanh càng tốn
const JUMP_COST = 10;
const HUNGER_BASE = 0.08; // độ đói giảm / giây khi đứng yên
const HUNGER_MOVE = 0.12; // thêm theo effort (đi bộ)
const HUNGER_RUN = 0.12; // thêm theo effort² phần vượt mức đi bộ (chạy càng nhanh càng đói)
const EXHAUST_RECOVER = 25; // kiệt sức xong phải hồi tới mức này mới chạy / nhảy lại được

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Thể lực + độ đói của người chơi.
 *  - Chạy nhanh: tốn thể lực và đói nhanh hơn; hết thể lực -> kiệt sức (không chạy / nhảy được, đi chậm).
 *  - Đói (<25): thể lực hồi chậm; đói hẳn (0): thể lực tối đa chỉ còn 50%, đi chậm, không chạy được.
 *  - Ăn thực phẩm trong túi bằng phím E.
 */
export class Survival {
  constructor(state) {
    this.state = state; // GameState: lưu inv (túi đồ) và vitals
    this.stamina = state.vitals.stamina;
    this.hunger = state.vitals.hunger;
    this.exhausted = false;
    this.onMessage = null; // (text) => void: cảnh báo hiện lên màn hình
    this.warnedHungry = false;
    this.warnedExhausted = false;
  }

  get canSprint() {
    return !this.exhausted && this.stamina > 6 && this.hunger > 0;
  }

  get canJump() {
    return !this.exhausted && this.stamina >= JUMP_COST;
  }

  /** Hệ số nhân tốc độ theo tình trạng cơ thể. */
  get speedMul() {
    let m = 1;
    if (this.exhausted) m *= 0.7;
    if (this.hunger <= 0) m *= 0.6;
    else if (this.hunger < 15) m *= 0.85;
    return m;
  }

  spendJump() {
    this.stamina = Math.max(0, this.stamina - JUMP_COST);
  }

  update(dt, effort) {
    const hungerFactor = this.hunger <= 0 ? 0.25 : this.hunger < 25 ? 0.5 : 1;
    const net = effort <= 1 ? STAMINA_REGEN * (1 - effort) * hungerFactor : -STAMINA_DRAIN * (effort - 1);
    const cap = this.hunger <= 0 ? 50 : 100;
    this.stamina = clamp(this.stamina + net * dt, 0, 100);
    if (this.stamina > cap) this.stamina = Math.max(cap, this.stamina - 20 * dt); // đói hẳn: tụt dần về mức tối đa mới

    if (this.stamina <= 0) {
      if (!this.exhausted) this.say('Kiệt sức! Hãy dừng lại nghỉ một chút.');
      this.exhausted = true;
    } else if (this.exhausted && this.stamina >= EXHAUST_RECOVER) {
      this.exhausted = false;
    }

    const over = Math.max(0, effort - 1);
    const drain = HUNGER_BASE + HUNGER_MOVE * effort + HUNGER_RUN * over * effort;
    this.hunger = Math.max(0, this.hunger - drain * dt);

    if (this.hunger < 20 && !this.warnedHungry) {
      this.warnedHungry = true;
      this.say('Bạn đang đói! Nhặt thực phẩm và nhấn E để ăn.');
    } else if (this.hunger > 35) {
      this.warnedHungry = false;
    }

    this.state.vitals.hunger = this.hunger;
    this.state.vitals.stamina = this.stamina;
  }

  say(text) {
    this.onMessage?.(text);
  }

  /**
   * Ăn 1 món trong túi. Ưu tiên món vừa đủ lấp phần đói còn thiếu (đỡ lãng phí);
   * không có món nào vừa thì ăn món nhỏ nhất.
   */
  eat() {
    const inv = this.state.inv;
    const items = Object.keys(inv).filter((id) => inv[id] > 0 && FOOD_INFO[id]);
    if (items.length === 0) return { ok: false, message: 'Túi đồ trống! Hãy tìm thực phẩm trên đảo.' };
    if (this.hunger > 92 && this.stamina > 92) return { ok: false, message: 'Bạn đang no, chưa cần ăn.' };

    const deficit = 100 - this.hunger;
    const fit = items.filter((id) => FOOD_INFO[id].hunger <= deficit).sort((a, b) => FOOD_INFO[b].hunger - FOOD_INFO[a].hunger);
    const id = fit[0] ?? items.sort((a, b) => FOOD_INFO[a].hunger - FOOD_INFO[b].hunger)[0];
    const info = FOOD_INFO[id];
    inv[id] -= 1;
    this.hunger = Math.min(100, this.hunger + info.hunger);
    this.stamina = Math.min(100, this.stamina + info.stamina);
    if (this.exhausted && this.stamina >= EXHAUST_RECOVER) this.exhausted = false;
    this.state.vitals.hunger = this.hunger;
    this.state.vitals.stamina = this.stamina;
    this.state.save();
    return { ok: true, id, message: `Đã ăn ${info.name} (+${info.hunger} đói${info.stamina ? `, +${info.stamina} thể lực` : ''})` };
  }
}
import { FOOD_INFO } from './fooddefs';
import { modStats } from './mods';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (n) => `#${(n ?? 0x88aaff).toString(16).padStart(6, '0')}`;

/**
 * Hai cửa sổ điều khiển bằng bàn phím (con trỏ chuột đang bị khoá nên không dùng chuột):
 *  - Túi đồ (phím I): danh sách mod đang có + vật phẩm ăn được. ↑↓ chọn, Tab đổi cột, Enter ăn món đang chọn.
 *  - Chọn mod ra trận (khi nhấn J gần mod hoang dã): luôn hiện, kể cả khi chỉ có 1 mod.
 *    ↑↓ hoặc 1-9 để chọn, Enter để ra trận, Esc để huỷ.
 * Khi cửa sổ mở, người chơi bị khoá không đi được (setLock).
 */
export class Menus {
  constructor({ ui, state, library, survival, canOpen, setLock }) {
    this.ui = ui;
    this.state = state;
    this.library = library;
    this.survival = survival;
    this.canOpen = canOpen; // () => boolean: có được mở túi đồ lúc này không (không mở khi đang đấu / dịch chuyển)
    this.setLock = setLock; // (bool) => void
    this.mode = 'none'; // 'none' | 'bag' | 'select'
    this.sel = 0; // mod đang chọn
    this.itemSel = 0; // vật phẩm đang chọn
    this.focus = 'mods'; // cột đang điều khiển trong túi đồ: 'mods' | 'items'
    this.title = '';
    this.onPick = null;
    this.onCancel = null;
  }

  get active() {
    return this.mode !== 'none';
  }

  /** Mod hợp lệ trong đội (bỏ qua id không còn tồn tại trong MOD_DEFS). */
  party() {
    return this.state.party.filter((e) => this.library.def(e.id));
  }

  items() {
    const inv = this.state.inv;
    return Object.keys(inv).filter((id) => inv[id] > 0 && FOOD_INFO[id]);
  }

  toggleBag() {
    if (this.mode === 'bag') this.close();
    else if (this.mode === 'none' && this.canOpen()) this.openBag();
  }

  openBag() {
    this.mode = 'bag';
    this.focus = 'mods';
    this.sel = 0;
    this.itemSel = 0;
    this.setLock(true);
    this.render();
  }

  /** Mở hộp chọn mod ra trận. onPick(entry) khi chọn xong, onCancel() khi huỷ. */
  openSelect(title, onPick, onCancel) {
    this.mode = 'select';
    this.title = title;
    this.sel = 0;
    this.onPick = onPick;
    this.onCancel = onCancel;
    this.setLock(true);
    this.render();
  }

  close() {
    this.mode = 'none';
    this.onPick = null;
    this.onCancel = null;
    this.ui.setModal(null);
    this.setLock(false);
  }

  /** Trả true nếu phím đã được cửa sổ xử lý (luôn true khi đang mở, để không lọt xuống điều khiển nhân vật). */
  handleKey(code, ev) {
    if (this.mode === 'none') return false;
    ev?.preventDefault?.();
    return this.mode === 'select' ? this.selectKey(code) : this.bagKey(code);
  }

  move(delta) {
    if (this.mode === 'bag' && this.focus === 'items') {
      const n = this.items().length;
      if (n > 0) this.itemSel = (this.itemSel + delta + n) % n;
    } else {
      const n = this.party().length;
      if (n > 0) this.sel = (this.sel + delta + n) % n;
    }
    this.render();
  }

  selectKey(code) {
    if (code === 'Escape' || code === 'KeyJ') {
      const cb = this.onCancel;
      this.close();
      cb?.();
      return true;
    }
    if (code === 'ArrowUp' || code === 'KeyW') this.move(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.move(1);
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') this.confirm();
    else {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m && Number(m[1]) <= this.party().length) {
        this.sel = Number(m[1]) - 1;
        this.confirm();
      }
    }
    return true;
  }

  confirm() {
    const entry = this.party()[this.sel];
    const cb = this.onPick;
    this.close(); // mở khoá người chơi trước; BattleSystem.start sẽ khoá lại ngay sau đó
    if (entry) cb?.(entry);
  }

  bagKey(code) {
    if (code === 'KeyI' || code === 'Escape') {
      this.close();
      return true;
    }
    if (code === 'ArrowUp' || code === 'KeyW') this.move(-1);
    else if (code === 'ArrowDown' || code === 'KeyS') this.move(1);
    else if (code === 'Tab') {
      this.focus = this.focus === 'mods' && this.items().length > 0 ? 'items' : 'mods';
      this.render();
    } else if (code === 'KeyE') {
      this.ui.toast(this.survival.eat().message, 2000);
      this.render();
    } else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      if (this.focus === 'items') {
        const id = this.items()[this.itemSel];
        if (id) this.ui.toast(this.survival.eat(id).message, 2000);
        this.render();
      }
    } else if (this.focus === 'mods') {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m && Number(m[1]) <= this.party().length) {
        this.sel = Number(m[1]) - 1;
        this.render();
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- hiển thị

  modRow(entry, i, selected, dim) {
    const def = this.library.def(entry.id);
    return `<div class="mm-row ${selected ? 'sel' : ''} ${dim ? 'dim' : ''}"><span class="nm"><span class="dot" style="background:${hex(def.color)}"></span>${i + 1}. ${def.name}</span><small>Lv ${entry.level}</small></div>`;
  }

  detail(entry) {
    if (!entry) return '';
    const def = this.library.def(entry.id);
    const st = modStats(def, entry.level);
    const moves = def.moves.map((m) => `${m.name} (${m.power})`).join(', ');
    return `<div class="mm-detail"><b>${def.name}</b> · Lv ${entry.level}<br>HP <b>${st.maxHp}</b> · Công <b>${st.atk.toFixed(0)}</b> · Thủ <b>${st.defense.toFixed(0)}</b> · Tốc <b>${st.spd.toFixed(0)}</b><br>Chiêu: ${moves}</div>`;
  }

  render() {
    const party = this.party();
    this.sel = clamp(this.sel, 0, Math.max(0, party.length - 1));
    const modsHtml = party.length
      ? party.map((e, i) => this.modRow(e, i, i === this.sel, this.mode === 'bag' && this.focus !== 'mods')).join('')
      : '<div class="mm-empty">Chưa có mod nào — hoàn thành nhiệm vụ tân thủ để nhận mod.</div>';

    if (this.mode === 'select') {
      this.ui.setModal(
        `<div class="mm-title">${this.title}</div><div class="mm-col">${modsHtml}${this.detail(party[this.sel])}</div>` +
          `<div class="mm-hint">↑↓ hoặc 1–9: chọn · Enter: ra trận (trận đấu tự động) · Esc: huỷ</div>`,
      );
      return;
    }

    const items = this.items();
    this.itemSel = clamp(this.itemSel, 0, Math.max(0, items.length - 1));
    const itemsHtml = items.length
      ? items
          .map((id, i) => {
            const f = FOOD_INFO[id];
            const sel = this.focus === 'items' && i === this.itemSel;
            return `<div class="mm-row ${sel ? 'sel' : ''}"><span class="nm">${f.name} ×${this.state.inv[id]}</span><small>+${f.hunger} đói${f.stamina ? `, +${f.stamina} thể lực` : ''}</small></div>`;
          })
          .join('')
      : '<div class="mm-empty">Túi trống — nhặt táo, quả mọng, nấm trên đảo hoặc đánh bại mod hoang dã.</div>';
    this.ui.setModal(
      `<div class="mm-title">Túi đồ <small>[I] đóng</small></div><div class="mm-cols">` +
        `<div class="mm-col"><h4>Mod của bạn (${party.length})</h4>${modsHtml}${this.detail(party[this.sel])}</div>` +
        `<div class="mm-col"><h4>Vật phẩm</h4>${itemsHtml}</div></div>` +
        `<div class="mm-hint">↑↓: chọn · Tab: đổi cột (Mod / Vật phẩm) · Enter: ăn món đang chọn · E: ăn nhanh · I hoặc Esc: đóng</div>`,
    );
  }
}
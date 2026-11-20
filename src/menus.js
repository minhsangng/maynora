import { FOOD_INFO } from './fooddefs';
import { modStats } from './mods';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (n) => `#${(n ?? 0x88aaff).toString(16).padStart(6, '0')}`;
const COLS = 2; // số cột của lưới thẻ mod

/**
 * Hành trang và hộp chọn mod ra trận, dùng chung 1 giao diện (xem theme.js: #m-modal).
 *  - Hành trang (phím I hoặc nút trong menu tạm dừng): tab MOD = mọi mod đang có (kèm level, chỉ số, chiêu, vật phẩm rơi),
 *    tab VẬT PHẨM = đồ ăn trong túi (ăn từng món).
 *  - Chọn mod ra trận (phím J gần mod hoang dã): luôn hiện, kể cả khi chỉ có 1 mod.
 * Điều khiển bằng bàn phím (↑↓←→ chọn, Tab đổi tab, Enter xác nhận, Esc đóng) và chuột (click thẻ / nút).
 * Khi cửa sổ mở, người chơi bị khoá không đi được (setLock).
 */
export class Menus {
  constructor({ ui, state, library, survival, canOpen, setLock }) {
    this.ui = ui;
    this.state = state;
    this.library = library;
    this.survival = survival;
    this.canOpen = canOpen; // () => boolean: có được mở hành trang lúc này không (không mở khi đang đấu / chuyển cảnh)
    this.setLock = setLock; // (bool) => void
    this.mode = 'none'; // 'none' | 'bag' | 'select'
    this.tab = 'mods'; // 'mods' | 'items' (chỉ trong hành trang)
    this.sel = 0; // mod đang chọn
    this.itemSel = 0; // vật phẩm đang chọn
    this.title = '';
    this.onPick = null;
    this.onCancel = null;
    this.onClose = null; // gọi khi HÀNH TRANG đóng (để menu tạm dừng mở lại)
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

  openBag(tab = 'mods') {
    if (this.mode !== 'none') return;
    this.mode = 'bag';
    this.tab = tab;
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
    const wasBag = this.mode === 'bag';
    this.mode = 'none';
    this.onPick = null;
    this.onCancel = null;
    this.ui.setModal(null);
    this.setLock(false);
    if (wasBag) this.onClose?.();
  }

  cancel() {
    const cb = this.onCancel;
    this.close();
    cb?.();
  }

  confirm() {
    const entry = this.party()[this.sel];
    const cb = this.onPick;
    this.close(); // mở khoá người chơi trước; BattleSystem.start sẽ khoá lại ngay sau đó
    if (entry) cb?.(entry);
  }

  eatItem(id = null) {
    this.ui.toast(this.survival.eat(id).message, 2000);
    this.render();
  }

  // ---------------------------------------------------------------- điều khiển

  /** Trả true nếu phím đã được xử lý (luôn true khi đang mở, để không lọt xuống điều khiển nhân vật). */
  handleKey(code, ev) {
    if (this.mode === 'none') return false;
    ev?.preventDefault?.();
    const inItems = this.mode === 'bag' && this.tab === 'items';

    if (this.mode === 'select' && (code === 'Escape' || code === 'KeyJ')) this.cancel();
    else if (this.mode === 'bag' && (code === 'Escape' || code === 'KeyI')) this.close();
    else if (this.mode === 'bag' && code === 'Tab') {
      this.tab = this.tab === 'mods' ? 'items' : 'mods';
      this.render();
    } else if (code === 'ArrowUp' || code === 'KeyW') this.move(0, -1, inItems);
    else if (code === 'ArrowDown' || code === 'KeyS') this.move(0, 1, inItems);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.move(-1, 0, inItems);
    else if (code === 'ArrowRight' || code === 'KeyD') this.move(1, 0, inItems);
    else if (this.mode === 'bag' && code === 'KeyE') this.eatItem();
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      if (this.mode === 'select') this.confirm();
      else if (inItems) this.eatItem(this.items()[this.itemSel]);
    } else {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m && !inItems && Number(m[1]) <= this.party().length) {
        this.sel = Number(m[1]) - 1;
        if (this.mode === 'select') this.confirm();
        else this.render();
      }
    }
    return true;
  }

  move(dx, dy, inItems) {
    if (inItems) {
      const n = this.items().length;
      if (n > 0) this.itemSel = clamp(this.itemSel + dx + dy, 0, n - 1);
    } else {
      const n = this.party().length;
      if (n > 0) this.sel = clamp(this.sel + dx + dy * COLS, 0, n - 1);
    }
    this.render();
  }

  /** Chuột: click vào phần tử có data-a (thẻ mod, vật phẩm, tab, nút). */
  click(target) {
    const t = target?.closest?.('[data-a]');
    if (!t || this.mode === 'none') return;
    const a = t.dataset.a;
    const i = Number(t.dataset.i);
    if (a === 'close') this.close();
    else if (a === 'tab') {
      this.tab = t.dataset.i;
      this.render();
    } else if (a === 'mod') {
      this.sel = i;
      this.render();
    } else if (a === 'item') {
      this.itemSel = i;
      this.render();
    } else if (a === 'eat') this.eatItem(this.items()[i]);
    else if (a === 'confirm') this.confirm();
    else if (a === 'cancel') this.cancel();
  }

  // ---------------------------------------------------------------- hiển thị

  card(entry, i, selected) {
    const def = this.library.def(entry.id);
    const st = modStats(def, entry.level);
    return `<div class="mm-card ${selected ? 'sel' : ''}" data-a="mod" data-i="${i}"><span class="emblem" style="background:${hex(def.color)}">${def.name.trim()[0] ?? '?'}</span>` +
      `<span class="cn"><b>${def.name}</b><small>Lv ${entry.level} · HP ${st.maxHp}</small></span></div>`;
  }

  detail(entry, party) {
    if (!entry) return '';
    const def = this.library.def(entry.id);
    const st = modStats(def, entry.level);
    // thanh chỉ số so với mod mạnh nhất trong đội ở từng chỉ số
    const all = party.map((e) => modStats(this.library.def(e.id), e.level));
    const mx = (k) => Math.max(1, ...all.map((s) => s[k]));
    const bar = (label, v, max) =>
      `<div class="st"><span>${label}</span><div class="m-bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><em>${Math.round(v)}</em></div>`;
    const moves = def.moves.map((m) => `<i>${m.name} · ${m.power}</i>`).join('');
    const drops = (def.drops ?? [{ item: 'meat' }]).map((d) => FOOD_INFO[d.item]?.name).filter(Boolean).join(', ');
    return `<div class="mm-detail"><div class="dh"><span class="emblem big" style="background:${hex(def.color)}">${def.name.trim()[0] ?? '?'}</span><div><b>${def.name}</b>Lv ${entry.level}</div></div>` +
      bar('HP', st.maxHp, mx('maxHp')) + bar('Công', st.atk, mx('atk')) + bar('Thủ', st.defense, mx('defense')) + bar('Tốc', st.spd, mx('spd')) +
      `<div class="mv"><b>Chiêu:</b> ${moves}</div>${drops ? `<div class="mv"><b>Rơi khi bị đánh bại:</b> ${drops}</div>` : ''}</div>`;
  }

  render() {
    const party = this.party();
    this.sel = clamp(this.sel, 0, Math.max(0, party.length - 1));
    const items = this.items();
    this.itemSel = clamp(this.itemSel, 0, Math.max(0, items.length - 1));

    const grid = party.length
      ? `<div class="mm-grid">${party.map((e, i) => this.card(e, i, i === this.sel)).join('')}</div>`
      : '<div class="mm-empty">Chưa có mod nào — hoàn thành nhiệm vụ tân thủ để nhận mod.</div>';

    if (this.mode === 'select') {
      this.ui.setModal(
        `<div class="mm-top"><div class="pk-head">RA TRẬN</div></div><div class="mm-sub">${this.title}</div>` +
          `<div class="mm-cols">${grid}${this.detail(party[this.sel], party)}</div>` +
          `<div class="mm-foot"><span class="mm-hint"><kbd>↑</kbd><kbd>↓</kbd> hoặc <kbd>1</kbd>–<kbd>9</kbd> chọn · <kbd>Enter</kbd> ra trận · <kbd>Esc</kbd> huỷ</span>` +
          `<span class="mm-act"><button class="pk-plank small primary" data-a="confirm">RA TRẬN</button><button class="pk-plank small danger" data-a="cancel">HUỶ</button></span></div>`,
      );
      return;
    }

    const itemsHtml = items.length
      ? `<div class="mm-list">${items
          .map((id, i) => {
            const f = FOOD_INFO[id];
            return `<div class="mm-row ${i === this.itemSel ? 'sel' : ''}" data-a="item" data-i="${i}"><span>${f.name} ×${this.state.inv[id]}<br><small>+${f.hunger} đói${f.stamina ? `, +${f.stamina} thể lực` : ''}</small></span><button class="pk-plank small primary" data-a="eat" data-i="${i}">ĂN</button></div>`;
          })
          .join('')}</div>`
      : '<div class="mm-empty">Túi trống — nhặt táo, quả mọng, nấm trên đảo hoặc đánh bại mod hoang dã.</div>';

    this.ui.setModal(
      `<div class="mm-top"><div class="pk-head">HÀNH TRANG</div><button class="mm-x" data-a="close">✕</button></div>` +
        `<div class="mm-tabs"><button class="mm-tab ${this.tab === 'mods' ? 'on' : ''}" data-a="tab" data-i="mods">MOD (${party.length})</button>` +
        `<button class="mm-tab ${this.tab === 'items' ? 'on' : ''}" data-a="tab" data-i="items">VẬT PHẨM (${items.length})</button></div>` +
        (this.tab === 'mods' ? `<div class="mm-cols">${grid}${this.detail(party[this.sel], party)}</div>` : itemsHtml) +
        `<div class="mm-foot"><span class="mm-hint"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> chọn · <kbd>Tab</kbd> đổi tab · <kbd>Enter</kbd> ăn · <kbd>E</kbd> ăn nhanh · <kbd>I</kbd> đóng</span></div>`,
    );
  }
}
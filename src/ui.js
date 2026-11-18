function el(tag, parent, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export class UI {
  constructor() {
    this.root = el('div', document.body, 'mod-ui');
    this.toasts = el('div', this.root);
    this.toasts.id = 'm-toasts';

    this.promptEl = el('div', this.root, 'hidden');
    this.promptEl.id = 'm-prompt';
    this.promptText = '';

    // --- giao diện trận đấu ---
    this.battleEl = el('div', this.root, 'hidden');
    this.battleEl.id = 'm-battle';
    this.mineBox = el('div', this.battleEl, 'm-side', '<div class="nm"></div><div class="m-bar"><i></i></div><div class="hp"></div>');
    el('div', this.battleEl, 'm-vs', 'VS');
    this.foeBox = el('div', this.battleEl, 'm-side', '<div class="nm"></div><div class="m-bar"><i></i></div><div class="hp"></div>');
    this.movesEl = el('div', this.root, 'hidden');
    this.movesEl.id = 'm-moves';
    this.msgEl = el('div', this.root);
    this.msgEl.id = 'm-msg';

    // --- thanh nhiệm vụ luôn hiện ---
    this.trackerEl = el('div', this.root);
    this.trackerEl.id = 'm-tracker';
    this.trackerExpanded = false;
    this.trackerHtml = '';
    this.lastSnapshot = null;

    // --- thanh thể lực / độ đói / túi đồ ăn ---
    this.vitalsEl = el(
      'div',
      this.root,
      null,
      '<div class="row sta"><b>Thể lực</b><div class="m-bar"><i></i></div></div>' +
        '<div class="row hun"><b>Độ đói</b><div class="m-bar"><i></i></div></div><div class="inv"></div>',
    );
    this.vitalsEl.id = 'm-vitals';
    this.staRow = this.vitalsEl.querySelector('.sta');
    this.hunRow = this.vitalsEl.querySelector('.hun');
    this.invEl = this.vitalsEl.querySelector('.inv');
    this.lastVitals = '';

    // --- cửa sổ chung (túi đồ, chọn mod) ---
    this.modalEl = el('div', this.root, 'hidden');
    this.modalEl.id = 'm-modal';

    this.fadeEl = el('div', this.root);
    this.fadeEl.id = 'm-fade';
  }

  /** Cập nhật thanh thể lực / độ đói / túi đồ ăn (chỉ chạm DOM khi giá trị thay đổi). foodInfo: { id: { name } } */
  updateVitals(surv, inv, foodInfo) {
    const items = Object.keys(inv).filter((id) => inv[id] > 0 && foodInfo[id]);
    const sig = `${Math.round(surv.stamina)}|${Math.round(surv.hunger)}|${surv.exhausted}|${items.map((id) => id + inv[id]).join(',')}`;
    if (sig === this.lastVitals) return;
    this.lastVitals = sig;
    this.staRow.querySelector('i').style.width = `${surv.stamina}%`;
    this.hunRow.querySelector('i').style.width = `${surv.hunger}%`;
    this.staRow.classList.toggle('ex', surv.exhausted);
    this.staRow.classList.toggle('low', !surv.exhausted && surv.stamina < 25);
    this.hunRow.classList.toggle('low', surv.hunger < 25);
    this.invEl.innerHTML = items.length
      ? items.map((id) => `${foodInfo[id].name} <b>${inv[id]}</b>`).join(' · ') + ' <u>— [E] ăn · [I] túi đồ</u>'
      : '<u>Hết đồ ăn — nhặt táo, quả mọng, nấm trên đảo</u>';
  }

  toast(text, ms = 3500) {
    const t = el('div', this.toasts, 'm-toast', text);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, ms);
  }

  prompt(text) {
    if (text === this.promptText) return;
    this.promptText = text;
    this.promptEl.classList.toggle('hidden', !text);
    if (text) this.promptEl.textContent = text;
  }

  say(text) {
    this.msgEl.textContent = text;
  }

  // ---- trận đấu ----
  battleShow() {
    this.battleEl.classList.remove('hidden');
    this.prompt(null);
  }

  battleHide() {
    this.battleEl.classList.add('hidden');
    this.movesEl.classList.add('hidden');
    this.msgEl.textContent = '';
  }

  battleUpdate(mine, foe) {
    this.fillSide(this.mineBox, mine);
    this.fillSide(this.foeBox, foe);
  }

  fillSide(box, a) {
    box.style.visibility = a ? 'visible' : 'hidden';
    if (!a) return;
    const pct = Math.max(0, (a.hp / a.maxHp) * 100);
    box.querySelector('.nm').textContent = a.tag;
    const bar = box.querySelector('i');
    bar.style.width = pct + '%';
    bar.style.background = pct > 50 ? '#4cd964' : pct > 20 ? '#ffcc00' : '#ff453a';
    box.querySelector('.hp').textContent = `${a.hp} / ${a.maxHp}`;
  }

  /** Dòng gợi ý nhỏ phía dưới khi đang đấu (trận đấu tự động nên không còn danh sách chiêu). */
  battleHint(text) {
    this.movesEl.innerHTML = `<div class="m-mv">${text}</div>`;
    this.movesEl.classList.remove('hidden');
  }

  battleHideMoves() {
    this.movesEl.classList.add('hidden');
  }

  // ---- thanh nhiệm vụ ----
  /** snap = quests.snapshot(): { starter, island: { name, next, quests } }. Chỉ cập nhật DOM khi nội dung đổi. */
  updateTracker(snap) {
    this.lastSnapshot = snap;
    const ex = this.trackerExpanded;
    const row = (q) => {
      const pct = Math.min(100, (q.value / q.goal) * 100);
      const val = q.done ? 'Xong' : `${Math.floor(q.value)}/${q.goal}`;
      return `<div class="tq ${q.done ? 'done' : ''}"><div class="t"><span>${q.done ? '✔ ' : ''}${q.title}</span><small>${val}</small></div>${
        ex ? `<small class="d">${q.desc} — thưởng: ${q.rewardName}</small>` : ''
      }<div class="m-bar"><i style="width:${pct}%"></i></div></div>`;
    };
    const pending = snap.starter.filter((q) => !q.done); // nhiệm vụ tân thủ đã xong thì ẩn cho gọn
    const html =
      `<div class="th">NHIỆM VỤ <small>[Q] ${ex ? 'thu gọn' : 'chi tiết'}</small></div>` +
      `<div class="ts">${snap.island.name}</div>${snap.island.quests.map(row).join('')}` +
      (snap.island.next ? `<small class="hint">Xong hết để dịch chuyển sang ${snap.island.next}</small>` : '') +
      (pending.length ? `<div class="ts">Tân thủ — nhận mod</div>${pending.map(row).join('')}` : '');
    if (html === this.trackerHtml) return;
    this.trackerHtml = html;
    this.trackerEl.innerHTML = html;
  }

  toggleTrackerExpanded() {
    this.trackerExpanded = !this.trackerExpanded;
    if (this.lastSnapshot) this.updateTracker(this.lastSnapshot);
  }

  setTrackerVisible(on) {
    this.trackerEl.classList.toggle('hidden', !on);
  }

  // ---- cửa sổ chung ----
  /** html = nội dung cửa sổ; null = đóng. */
  setModal(html) {
    this.modalEl.classList.toggle('hidden', html === null);
    if (html !== null) this.modalEl.innerHTML = html;
  }

  /** Làm tối / sáng lại toàn màn hình (khi dịch chuyển). Trả về Promise xong khi hiệu ứng kết thúc. */
  fade(toBlack, ms = 800, text = '') {
    this.fadeEl.textContent = text;
    this.fadeEl.style.transition = `opacity ${ms}ms`;
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
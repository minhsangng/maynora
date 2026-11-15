function el(tag, parent, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export class UI {
  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

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

    // --- bảng nhiệm vụ ---
    this.questsEl = el('div', this.root, 'hidden');
    this.questsEl.id = 'm-quests';
    this.questsOpen = false;
    this.qTimer = 0;

    // --- thanh thể lực / độ đói / túi đồ ---
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

    this.fadeEl = el('div', this.root);
    this.fadeEl.id = 'm-fade';
  }

  /** Cập nhật thanh thể lực / độ đói / túi đồ (chỉ chạm DOM khi giá trị thay đổi). foodInfo: { id: { name } } */
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
      ? items.map((id) => `${foodInfo[id].name} <b>${inv[id]}</b>`).join(' · ') + ' <u>— [E] ăn</u>'
      : '<u>Túi trống — nhặt táo, quả mọng, nấm trên đảo</u>';
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

  battleMoves(moves) {
    this.movesEl.innerHTML =
      moves.map((m, i) => `<div class="m-mv"><b>${i + 1}</b>${m.name}<small>⚔${m.power}</small></div>`).join('') +
      `<div class="m-mv"><b>F</b>Bỏ chạy</div>`;
    this.movesEl.classList.remove('hidden');
  }

  /** Dòng gợi ý nhỏ phía dưới khi đang đấu (trận đấu tự động nên không còn danh sách chiêu). */
  battleHint(text) {
    this.movesEl.innerHTML = `<div class="m-mv">${text}</div>`;
    this.movesEl.classList.remove('hidden');
  }

  battleHideMoves() {
    this.movesEl.classList.add('hidden');
  }

  // ---- nhiệm vụ ----
  toggleQuests(snapshot) {
    this.questsOpen = !this.questsOpen;
    this.questsEl.classList.toggle('hidden', !this.questsOpen);
    if (this.questsOpen) this.renderQuests(snapshot);
  }

  closeQuests() {
    this.questsOpen = false;
    this.questsEl.classList.add('hidden');
  }

  /** Gọi mỗi frame: làm mới bảng nhiệm vụ 2 lần/giây khi đang mở. */
  update(dt, getSnapshot) {
    if (!this.questsOpen) return;
    this.qTimer += dt;
    if (this.qTimer > 0.5) {
      this.qTimer = 0;
      this.renderQuests(getSnapshot());
    }
  }

  renderQuests({ starter, island, party }) {
    const row = (q) => {
      const pct = Math.min(100, (q.value / q.goal) * 100);
      const val = q.done ? '✔ Hoàn thành' : `${Math.floor(q.value)} / ${q.goal}`;
      return `<div class="m-q ${q.done ? 'done' : ''}">
        <div class="t"><span>${q.title}</span><small>${val}</small></div>
        <small>${q.desc} — thưởng: <b>${q.rewardName}</b></small>
        <div class="m-bar"><i style="width:${pct}%"></i></div></div>`;
    };
    const mods = party.length
      ? party.map((p, i) => `${i + 1}. ${p.name} <small>Lv ${p.level}</small>`).join('<br>')
      : '<small>Chưa có mod nào — hoàn thành nhiệm vụ tân thủ để nhận mod.</small>';
    const next = island.next ? `Hoàn thành hết để được dịch chuyển sang <b>${island.next}</b>` : '';
    this.questsEl.innerHTML = `<h3>Nhiệm vụ <small style="opacity:.6">(Q để đóng)</small></h3>
      <h4>${island.name} <span style="text-transform:none;opacity:.8">— ${next}</span></h4>${island.quests.map(row).join('')}
      <h4>Nhiệm vụ tân thủ (nhận mod)</h4>${starter.map(row).join('')}
      <h4>Mod của bạn</h4><div class="m-party">${mods}</div>`;
  }

  /** Làm tối / sáng lại toàn màn hình (khi dịch chuyển). Trả về Promise xong khi hiệu ứng kết thúc. */
  fade(toBlack, ms = 800, text = '') {
    this.fadeEl.textContent = text;
    this.fadeEl.style.transition = `opacity ${ms}ms`;
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
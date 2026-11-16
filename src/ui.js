const CSS = `
.mod-ui{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;pointer-events:none;user-select:none}
.mod-ui .hidden{display:none!important}
#m-toasts{position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:30}
.m-toast{background:rgba(20,24,32,.88);border:1px solid rgba(255,255,255,.2);padding:8px 16px;border-radius:10px;font-size:14px;opacity:0;transform:translateY(-6px);transition:opacity .25s,transform .25s}
.m-toast.show{opacity:1;transform:none}
#m-prompt{position:fixed;bottom:22%;left:50%;transform:translateX(-50%);background:rgba(20,24,32,.85);border:1px solid rgba(255,255,255,.25);padding:8px 18px;border-radius:999px;font-size:15px;z-index:20}
#m-battle{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;z-index:25}
.m-side{width:240px;background:rgba(15,18,26,.85);border:1px solid rgba(255,255,255,.18);padding:8px 12px;border-radius:10px}
.m-side .nm{font-size:14px;font-weight:600;margin-bottom:5px}
.m-bar{height:10px;background:#333;border-radius:6px;overflow:hidden}
.m-bar i{display:block;height:100%;width:100%;background:#4cd964;transition:width .35s,background .3s}
.m-side .hp{font-size:12px;opacity:.8;margin-top:3px;text-align:right}
.m-vs{font-weight:800;color:#ffd54a;font-size:18px}
#m-moves{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:25}
.m-mv{background:rgba(15,18,26,.9);border:1px solid rgba(255,255,255,.25);border-radius:10px;padding:8px 14px;font-size:14px}
#m-msg{position:fixed;bottom:104px;left:50%;transform:translateX(-50%);font-size:18px;font-weight:600;text-shadow:0 2px 5px #000;z-index:25;text-align:center}
/* thanh nhiệm vụ luôn hiện (góc phải) */
#m-tracker{position:fixed;right:14px;top:14px;width:272px;background:rgba(15,18,26,.74);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;z-index:12;font-size:12px}
#m-tracker .th{display:flex;justify-content:space-between;align-items:baseline;font-weight:700;letter-spacing:.06em;font-size:12px;margin-bottom:4px}
#m-tracker .th small{font-weight:400;opacity:.55;letter-spacing:0}
#m-tracker .ts{margin:8px 0 3px;color:#ffd54a;font-weight:600;font-size:12px}
#m-tracker .tq{margin:5px 0}#m-tracker .tq .t{display:flex;justify-content:space-between;gap:8px}
#m-tracker .tq .d{display:block;opacity:.6;margin-top:1px}
#m-tracker .tq .m-bar{height:6px;margin-top:3px}#m-tracker .tq .m-bar i{background:#4aa8ff}
#m-tracker .tq.done{opacity:.55}#m-tracker .tq.done .m-bar i{background:#4cd964}
#m-tracker .hint{display:block;margin-top:6px;opacity:.6}
#m-vitals{position:fixed;left:14px;bottom:14px;width:230px;background:rgba(15,18,26,.78);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:8px 12px;z-index:15;font-size:12px}
#m-vitals .row{display:flex;align-items:center;gap:8px;margin:3px 0}#m-vitals .row b{width:52px;font-weight:600}
#m-vitals .m-bar{flex:1;height:9px}#m-vitals .sta i{background:#ffd54a}#m-vitals .hun i{background:#ff8a3d}
#m-vitals .sta.low i,#m-vitals .hun.low i{background:#ff453a}#m-vitals .sta.ex i{background:#8e8e93}
#m-vitals .inv{margin-top:6px;opacity:.85;line-height:1.5}#m-vitals .inv u{text-decoration:none;opacity:.6}
/* cửa sổ chung: túi đồ + chọn mod ra trận */
#m-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(700px,94vw);background:rgba(15,18,26,.96);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:16px 20px;z-index:40}
#m-modal .mm-title{font-size:17px;font-weight:700;margin-bottom:10px}#m-modal .mm-title small{font-weight:400;opacity:.6;font-size:13px}
#m-modal .mm-cols{display:flex;gap:20px}#m-modal .mm-col{flex:1;min-width:0}
#m-modal h4{margin:0 0 6px;font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:.06em}
#m-modal .mm-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;margin:2px 0;font-size:14px;border:1px solid transparent}
#m-modal .mm-row .nm{display:flex;align-items:center;gap:8px}
#m-modal .mm-row .dot{width:11px;height:11px;border-radius:50%;display:inline-block}
#m-modal .mm-row small{opacity:.7}
#m-modal .mm-row.sel{background:rgba(255,213,74,.16);border-color:rgba(255,213,74,.7)}
#m-modal .mm-row.sel.dim{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.3)}
#m-modal .mm-detail{margin-top:10px;padding:9px 11px;background:rgba(255,255,255,.06);border-radius:8px;font-size:13px;line-height:1.7}
#m-modal .mm-detail b{color:#ffd54a;font-weight:600}
#m-modal .mm-empty{opacity:.6;font-size:13px;padding:6px 2px}
#m-modal .mm-hint{margin-top:12px;font-size:12px;opacity:.6}
#m-fade{position:fixed;inset:0;background:#000;opacity:0;z-index:100;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600}
`;

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
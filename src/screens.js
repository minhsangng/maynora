const TIPS = [
  'Giữ Shift để chạy, nhưng chạy nhanh tốn thể lực và làm bạn đói nhanh hơn.',
  'Nhặt táo, quả mọng, nấm trên đảo rồi nhấn E để ăn.',
  'Nhấn I mở Hành trang: xem các mod bạn đang có và vật phẩm trong túi.',
  'Nhấn J khi đứng gần mod hoang dã để thách đấu, bạn sẽ được chọn mod ra trận.',
  'Đánh bại mod hoang dã để nhận chiến lợi phẩm rơi xuống đất.',
  'Hoàn thành mọi nhiệm vụ của đảo để được dịch chuyển sang đảo mới.',
  'Biển sâu không đi được. Hãy khám phá hết đảo và thắp sáng các hải đăng.',
  'Nhấn Esc bất cứ lúc nào để tạm dừng và lưu game.',
];

const BG_SVG = `<svg class="pk-bg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<circle cx="1230" cy="250" r="95" fill="#ffe9a8" opacity=".9"/>
<ellipse cx="300" cy="170" rx="120" ry="30" fill="#fff" opacity=".7"/><ellipse cx="420" cy="150" rx="90" ry="26" fill="#fff" opacity=".7"/>
<ellipse cx="900" cy="120" rx="110" ry="26" fill="#fff" opacity=".6"/>
<path d="M0 560 L140 470 L260 540 L390 440 L520 545 L640 500 L760 560 L1600 560 L1600 900 L0 900Z" fill="#c9a06b" opacity=".55"/>
<path d="M0 640 C250 570 420 630 640 600 S1000 530 1200 610 S1500 630 1600 590 L1600 900 L0 900Z" fill="#e9c27e"/>
<path d="M0 730 C300 660 500 750 800 710 S1300 660 1600 740 L1600 900 L0 900Z" fill="#d79a52"/>
<path d="M0 820 C400 780 700 850 1100 810 S1450 790 1600 820 L1600 900 L0 900Z" fill="#a8683a"/>
<g fill="#4d8f3a" stroke="#2e5a22" stroke-width="5"><path d="M1600 0 C1500 40 1420 120 1380 220 C1450 160 1540 120 1600 110Z"/><path d="M1600 40 C1560 120 1540 200 1550 300 C1580 220 1600 160 1600 160Z"/><path d="M1600 0 L1250 0 C1340 30 1440 60 1520 120Z"/></g></svg>`;

const KEYS = [
  ['W A S D', 'Di chuyển'],
  ['Shift', 'Chạy (tốn thể lực, đói nhanh hơn)'],
  ['Space', 'Nhảy'],
  ['Chuột', 'Nhìn xung quanh (nhấp vào màn hình để khoá chuột)'],
  ['V', 'Đổi góc nhìn thứ nhất / thứ ba'],
  ['J', 'Thách đấu mod hoang dã đang ở gần (chọn mod ra trận)'],
  ['F', 'Rút lui khi đang đấu'],
  ['I', 'Hành trang: mod đang có và vật phẩm'],
  ['E', 'Ăn nhanh món phù hợp nhất'],
  ['Q', 'Thanh nhiệm vụ: gọn / chi tiết'],
  ['Esc', 'Tạm dừng'],
  ['F3', 'Bảng thông số hiệu năng'],
  ['[  ]', 'Giảm / tăng chất lượng đồ hoạ'],
];

function mk(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * Các màn hình lớn theo phong cách PEAK: màn hình tải, menu chính, tạm dừng, cài đặt, hướng dẫn, hộp thoại.
 * Panel xếp chồng (stack): panel trên cùng nhận phím, các panel bên dưới tạm ẩn.
 * Mỗi panel có danh sách điều khiển: button | choice | slider | toggle | text. Dùng được bằng chuột lẫn bàn phím
 * (↑↓ chọn, ←→ chỉnh, Enter kích hoạt, Esc quay lại).
 */
export class Screens {
  constructor(ui, { title = 'MAYNORA', version = '' } = {}) {
    this.ui = ui;
    this.root = ui.root;
    this.title = title;
    this.version = version;
    this.stack = [];
    this.loading = null;
    this.tipTimer = null;
    this.tipIdx = Math.floor(Math.random() * TIPS.length);
  }

  /** Đang có màn hình nào che game không (tải hoặc panel). Khi true, game đứng yên. */
  get active() {
    return this.stack.length > 0 || this.loading !== null;
  }

  get top() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  nextTip() {
    this.tipIdx = (this.tipIdx + 1) % TIPS.length;
    return TIPS[this.tipIdx];
  }

  // ---------------------------------------------------------------- màn hình tải

  /** steps = [{ id, label }]: các bước tải, đánh dấu xong bằng stepDone(id). */
  showLoading(steps) {
    this.hideLoading();
    const el = mk(
      'div',
      'pk-screen pk-loading',
      `${BG_SVG}<div class="pk-tag pk-ver">${this.version}</div><div class="pk-logo">${this.title}</div>` +
        `<div class="pk-loadbox pk-panel"><div class="pk-loadtext"><span class="lt-label">Đang tải model...</span><b class="lt-pct">0%</b></div>` +
        `<div class="pk-bar big"><i style="width:0%"></i></div>` +
        `<ul class="pk-steps">${steps.map((s) => `<li data-id="${s.id}">${s.label}</li>`).join('')}</ul></div>` +
        `<div class="pk-note"><b>MẸO</b><span class="tip">${TIPS[this.tipIdx]}</span></div>`,
    );
    this.root.appendChild(el);
    this.loading = {
      el,
      steps: new Map(steps.map((s) => [s.id, { label: s.label, state: 'wait' }])),
      bar: el.querySelector('.pk-bar i'),
      label: el.querySelector('.lt-label'),
      pct: el.querySelector('.lt-pct'),
      tip: el.querySelector('.tip'),
    };
    this.tipTimer = setInterval(() => {
      if (this.loading) this.loading.tip.textContent = this.nextTip();
    }, 4500);
  }

  setStep(id, state) {
    const L = this.loading;
    const s = L?.steps.get(id);
    if (!s) return;
    s.state = state;
    const li = L.el.querySelector(`li[data-id="${id}"]`);
    if (li) li.className = state;
    if (state === 'doing') L.label.textContent = `Đang tải ${s.label.toLowerCase()}...`;
    const done = [...L.steps.values()].filter((v) => v.state === 'done').length;
    const p = Math.round((done / L.steps.size) * 100);
    L.bar.style.width = `${p}%`;
    L.pct.textContent = `${p}%`;
    if (done === L.steps.size) L.label.textContent = 'Sẵn sàng!';
  }

  stepDone(id) {
    this.setStep(id, 'done');
  }

  hideLoading() {
    clearInterval(this.tipTimer);
    this.tipTimer = null;
    const L = this.loading;
    if (!L) return;
    this.loading = null;
    L.el.classList.add('leaving');
    setTimeout(() => L.el.remove(), 380);
  }

  // ---------------------------------------------------------------- panel

  /**
   * spec: { kind: 'title' | 'panel', title, sub, status, wide, controls, onBack }
   * Trả về panel; đóng bằng close(panel) / closeTop() / closeAll().
   */
  open(spec) {
    const p = {
      spec,
      kind: spec.kind ?? 'panel',
      controls: (spec.controls ?? []).map((c) => ({ ...c })),
      focusables: [],
      idx: 0,
      el: null,
      statusEl: null,
      onBack: spec.onBack ?? null,
    };
    this.build(p);
    this.root.appendChild(p.el);
    this.stack.push(p);
    this.syncVisibility();
    return p;
  }

  build(p) {
    const s = p.spec;
    const holder = mk('div', p.kind === 'title' ? 'pk-signs' : 'pk-body');
    for (const c of p.controls) {
      const node = this.buildControl(p, c);
      holder.appendChild(node);
    }
    // Ô chọn sẵn: nút nổi bật (primary) nếu panel mở đầu bằng các nút (menu, hộp thoại); còn panel có hàng chỉnh
    // (cài đặt) thì chọn hàng đầu tiên để dùng phím mũi tên chỉnh được ngay.
    const first = p.focusables.findIndex((c) => c.primary);
    this.setIdx(p, p.focusables[0]?.type === 'button' && first >= 0 ? first : 0);

    if (p.kind === 'title') {
      p.el = mk('div', 'pk-screen pk-titlescreen', `<div class="pk-logo">${this.title}</div>`);
      p.statusEl = mk('div', 'pk-tag pk-status', s.status ?? '');
      p.el.appendChild(p.statusEl);
      p.el.appendChild(holder);
      p.el.appendChild(mk('div', 'pk-note', `<b>MẸO</b>${TIPS[this.tipIdx]}`));
    } else {
      p.el = mk('div', 'pk-dim');
      const dialog = mk('div', `pk-dialog pk-panel${s.wide ? ' wide' : ''}`);
      dialog.appendChild(mk('div', 'pk-head', s.title ?? ''));
      if (s.sub) dialog.appendChild(mk('div', 'pk-sub', s.sub));
      dialog.appendChild(holder);
      p.el.appendChild(dialog);
    }
  }

  buildControl(p, c) {
    const register = (node) => {
      c.el = node;
      c.fi = p.focusables.length;
      p.focusables.push(c);
      node.onmouseenter = () => this.setIdx(p, c.fi);
    };
    if (c.type === 'text') return mk('div', 'pk-text', c.html);

    if (c.type === 'button') {
      const b = mk('button', `pk-plank${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}`, `${c.label}${c.hint ? `<small>${c.hint}</small>` : ''}`);
      b.onclick = () => c.onClick?.();
      register(b);
      return b;
    }

    const row = mk('div', 'pk-row', `<span class="lbl">${c.label}</span>`);
    register(row);
    if (c.type === 'choice') {
      const seg = mk('div', 'pk-seg');
      c.btns = c.options.map((o, k) => {
        const b = mk('button', k === c.index ? 'on' : '', o);
        b.onclick = () => this.setChoice(c, k);
        seg.appendChild(b);
        return b;
      });
      row.appendChild(seg);
    } else if (c.type === 'slider') {
      const fmt = c.format ?? ((v) => String(v));
      c.input = mk('input');
      c.input.type = 'range';
      c.input.min = c.min;
      c.input.max = c.max;
      c.input.step = c.step;
      c.input.value = c.value;
      c.valEl = mk('b', 'val', fmt(c.value));
      c.input.oninput = () => {
        c.value = Number(c.input.value);
        c.valEl.textContent = fmt(c.value);
        c.onChange?.(c.value);
      };
      row.appendChild(c.input);
      row.appendChild(c.valEl);
    } else if (c.type === 'toggle') {
      c.btn = mk('button', `pk-switch${c.value ? ' on' : ''}`, c.value ? 'BẬT' : 'TẮT');
      c.btn.onclick = () => this.setToggle(c, !c.value);
      row.appendChild(c.btn);
    }
    return row;
  }

  setIdx(p, i) {
    p.idx = i;
    p.focusables.forEach((c, k) => c.el.classList.toggle('sel', k === i));
  }

  setChoice(c, k) {
    c.index = Math.max(0, Math.min(c.options.length - 1, k));
    c.btns.forEach((b, j) => (b.className = j === c.index ? 'on' : ''));
    c.onChange?.(c.index);
  }

  setToggle(c, v) {
    c.value = v;
    c.btn.className = `pk-switch${v ? ' on' : ''}`;
    c.btn.textContent = v ? 'BẬT' : 'TẮT';
    c.onChange?.(v);
  }

  adjust(c, d) {
    if (c.type === 'choice') this.setChoice(c, c.index + d);
    else if (c.type === 'toggle') this.setToggle(c, d > 0);
    else if (c.type === 'slider') {
      const v = Math.max(c.min, Math.min(c.max, Math.round((c.value + d * c.step) * 1000) / 1000));
      c.value = v;
      c.input.value = v;
      c.valEl.textContent = (c.format ?? String)(v);
      c.onChange?.(v);
    }
  }

  activate(c) {
    if (c.type === 'button') c.onClick?.();
    else if (c.type === 'toggle') this.setToggle(c, !c.value);
    else if (c.type === 'choice') this.setChoice(c, (c.index + 1) % c.options.length);
  }

  syncVisibility() {
    this.stack.forEach((p, i) => p.el.classList.toggle('hidden', i < this.stack.length - 1));
  }

  close(p) {
    const i = this.stack.indexOf(p);
    if (i < 0) return;
    this.stack.splice(i, 1);
    p.el.remove();
    this.syncVisibility();
  }

  closeTop() {
    if (this.top) this.close(this.top);
  }

  closeAll() {
    while (this.stack.length > 0) this.close(this.stack[this.stack.length - 1]);
  }

  setTitleStatus(text) {
    for (const p of this.stack) if (p.statusEl) p.statusEl.textContent = text;
  }

  /** Trả true nếu phím đã được màn hình xử lý (đang tải thì nuốt hết phím). */
  handleKey(code, ev) {
    const p = this.top;
    if (!p) return this.loading !== null;
    ev?.preventDefault?.();
    if (code === 'Escape') {
      if (p.onBack) p.onBack();
      else if (p.kind !== 'title') this.close(p);
      return true;
    }
    const n = p.focusables.length;
    if (n === 0) return true;
    const cur = p.focusables[p.idx];
    if (code === 'ArrowUp' || code === 'KeyW') this.setIdx(p, (p.idx - 1 + n) % n);
    else if (code === 'ArrowDown' || code === 'KeyS') this.setIdx(p, (p.idx + 1) % n);
    else if (code === 'ArrowLeft' || code === 'KeyA') this.adjust(cur, -1);
    else if (code === 'ArrowRight' || code === 'KeyD') this.adjust(cur, 1);
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') this.activate(cur);
    return true;
  }

  // ---------------------------------------------------------------- các panel dựng sẵn

  /** Hộp thoại có nút. Trả Promise<value của nút được chọn>. Esc = cancelValue (mặc định nút cuối). */
  confirm({ title, message, buttons, cancelValue }) {
    return new Promise((resolve) => {
      let p = null;
      const done = (v) => {
        this.close(p);
        resolve(v);
      };
      p = this.open({
        kind: 'panel',
        title,
        sub: message,
        controls: buttons.map((b) => ({ type: 'button', label: b.label, primary: b.primary, danger: b.danger, onClick: () => done(b.value) })),
        onBack: () => done(cancelValue ?? buttons[buttons.length - 1].value),
      });
    });
  }

  showHelp(onBack = null) {
    const rows = KEYS.map(([k, d]) => `<span>${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join('')}</span><span>${d}</span>`).join('');
    const p = this.open({
      kind: 'panel',
      title: 'HƯỚNG DẪN',
      wide: true,
      controls: [
        { type: 'text', html: `<div class="pk-keys">${rows}</div>` },
        { type: 'button', label: 'XONG', primary: true, onClick: () => (onBack ? onBack() : this.close(p)) },
      ],
      onBack: () => (onBack ? onBack() : this.close(p)),
    });
    return p;
  }

  /** Danh sách nhiệm vụ đầy đủ. snap = quests.snapshot(). */
  showQuests(snap, onBack) {
    const line = (q) =>
      `<div class="pk-text"><b>${q.done ? '✔ ' : ''}${q.title}</b> — ${q.done ? 'Xong' : `${Math.floor(q.value)}/${q.goal}`}<br><small>${q.desc} · thưởng: ${q.rewardName}</small></div>`;
    const p = this.open({
      kind: 'panel',
      title: 'NHIỆM VỤ',
      wide: true,
      sub: snap.island.next ? `${snap.island.name} — hoàn thành hết để sang ${snap.island.next}` : snap.island.name,
      controls: [
        ...snap.island.quests.map((q) => ({ type: 'text', html: line(q) })),
        { type: 'text', html: '<b>Nhiệm vụ tân thủ (nhận mod)</b>' },
        ...snap.starter.map((q) => ({ type: 'text', html: line(q) })),
        { type: 'button', label: 'XONG', primary: true, onClick: () => (onBack ? onBack() : this.close(p)) },
      ],
      onBack: () => (onBack ? onBack() : this.close(p)),
    });
    return p;
  }
}
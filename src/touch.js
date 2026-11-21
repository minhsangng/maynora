/**
 * Điều khiển cảm ứng cho điện thoại / máy tính bảng.
 *  - Cần gạt ảo (nửa trái màn hình): chạm ở đâu cần gạt hiện ở đó. Đi theo hướng nhìn, mọi hướng 360°.
 *  - Vuốt nửa phải màn hình: xoay camera. Chụm 2 ngón: zoom camera (góc nhìn thứ 3).
 *  - Nút: NHẢY (giữ), CHẠY (bật/tắt), ĂN [E], THÁCH ĐẤU [J], ĐỔI GÓC NHÌN [V], RÚT LUI [F] (khi đang đánh).
 *  - Hành trang / Nhiệm vụ / Tạm dừng dùng lại các nút có sẵn ở thanh trên cùng.
 * Các nút gửi sự kiện bàn phím giả lên window nên mọi logic hiện có (main.js, player.js, menus) chạy y như bàn phím.
 * Chỉ bật khi thiết bị là cảm ứng chính (pointer: coarse). Thử trên máy tính: thêm ?touch=1 vào URL.
 */
import './touch.css';

const forced = new URLSearchParams(location.search).get('touch');
const isTouch = forced === '1' || (forced !== '0' && !!window.matchMedia?.('(pointer: coarse)').matches);
if (isTouch) boot();

function boot() {
  const LOOK_SENS = 0.0045; // rad / px (chuột là 0.0022; cảm ứng cần nhạy hơn)
  const MAX_PITCH = Math.PI / 2 - 0.05;
  const STICK_R = 56; // px: quãng đường tối đa của núm gạt
  const DEADZONE = 0.16;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const game = () => window.game;

  document.body.classList.add('touch');

  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };
  const root = h('div', 'tc-root hidden');
  document.body.appendChild(root);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS: không zoom cả trang bằng 2 ngón

  // --- phím giả ---------------------------------------------------------------
  const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  const tapKey = (code) => {
    fire('keydown', code);
    fire('keyup', code);
  };

  // --- cần gạt (nửa trái) -----------------------------------------------------
  const left = h('div', 'tc-zone tc-left');
  const right = h('div', 'tc-zone tc-right');
  const hint = h('div', 'tc-hint');
  const base = h('div', 'tc-base', '<div class="tc-knob"></div>');
  const knob = base.firstChild;
  root.append(left, right, hint, base);

  const setAxis = (x, y) => {
    const p = game()?.player;
    if (p) {
      p.moveAxis.x = x;
      p.moveAxis.y = y;
    }
  };
  let movePid = null;
  let ox = 0;
  let oy = 0;
  left.addEventListener('pointerdown', (e) => {
    if (movePid !== null) return;
    e.preventDefault();
    movePid = e.pointerId;
    left.setPointerCapture(e.pointerId);
    ox = e.clientX;
    oy = e.clientY;
    base.style.left = `${ox}px`;
    base.style.top = `${oy}px`;
    knob.style.transform = 'translate(0, 0)';
    base.classList.add('on');
  });
  left.addEventListener('pointermove', (e) => {
    if (e.pointerId !== movePid) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      dx *= STICK_R / d;
      dy *= STICK_R / d;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (Math.hypot(dx, dy) / STICK_R < DEADZONE) setAxis(0, 0);
    else setAxis(dx / STICK_R, -dy / STICK_R); // kéo lên = đi tới
  });
  const endMove = (e) => {
    if (e.pointerId !== movePid) return;
    movePid = null;
    base.classList.remove('on');
    setAxis(0, 0);
  };
  left.addEventListener('pointerup', endMove);
  left.addEventListener('pointercancel', endMove);

  // --- xoay camera (nửa phải) + chụm 2 ngón để zoom ---------------------------
  const looks = new Map(); // pointerId -> { x, y }
  let pinch = 0;
  const pinchDist = () => {
    const [a, b] = [...looks.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  right.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    right.setPointerCapture(e.pointerId);
    looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (looks.size === 2) pinch = pinchDist();
  });
  right.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const pl = game()?.player;
    if (!pl || pl.locked) return;
    if (looks.size >= 2) {
      const d = pinchDist();
      if (pinch) pl.armLength = clamp(pl.armLength - (d - pinch) * 0.02, 2, 15); // giang tay ra = zoom vào
      pinch = d;
      return;
    }
    pl.yaw -= dx * LOOK_SENS * pl.sensitivity;
    pl.pitch = clamp(pl.pitch - dy * LOOK_SENS * pl.sensitivity, -MAX_PITCH, MAX_PITCH);
  });
  const endLook = (e) => {
    looks.delete(e.pointerId);
    pinch = 0;
  };
  right.addEventListener('pointerup', endLook);
  right.addEventListener('pointercancel', endLook);

  // --- nút bấm ----------------------------------------------------------------
  const btn = (cls, html) => {
    const b = h('button', `tc-btn ${cls}`, html);
    b.type = 'button';
    root.appendChild(b);
    return b;
  };
  const press = (b, onDown, onUp) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      onDown?.();
    });
    const up = () => {
      if (!b.classList.contains('down')) return;
      b.classList.remove('down');
      onUp?.();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  };

  const jump = btn('tc-jump', '<b>⬆</b>NHẢY');
  const run = btn('tc-run', '<b>»</b>CHẠY');
  const eat = btn('tc-eat', '<b>🍖</b>ĂN');
  const fight = btn('tc-fight', '<b>⚔</b>ĐẤU');
  const view = btn('tc-view', '<b>👁</b>');
  const retreat = btn('tc-retreat', 'RÚT LUI');

  press(jump, () => fire('keydown', 'Space'), () => fire('keyup', 'Space'));
  let running = false;
  press(run, () => {
    running = !running;
    run.classList.toggle('on', running);
    fire(running ? 'keydown' : 'keyup', 'ShiftLeft'); // chạy tốn thể lực: bật/tắt, không cần giữ
  });
  press(eat, () => tapKey('KeyE'));
  press(fight, () => tapKey('KeyJ'));
  press(view, () => tapKey('KeyV'));
  press(retreat, () => tapKey('KeyF'));

  const rotate = h('div', 'tc-rotate', '↻ Xoay ngang màn hình để chơi dễ hơn');
  root.appendChild(rotate);

  // --- thanh nhiệm vụ: mặc định thu gọn; chạm tiêu đề hoặc nút "Nhiệm vụ" để mở / đóng ---
  const TRACK_KEY = 'tc-tracker-open';
  let trackerOpen = false;
  try {
    trackerOpen = localStorage.getItem(TRACK_KEY) === '1';
  } catch {
    /* không đọc được localStorage: dùng mặc định */
  }
  const applyTracker = () => document.getElementById('m-tracker')?.classList.toggle('tc-min', !trackerOpen);
  document.addEventListener(
    'click',
    (e) => {
      if (!e.target.closest?.('#m-tracker .th, #m-hotbar [data-a="quests"]')) return;
      e.stopPropagation(); // chặn kiểu "chi tiết" cũ (quá to với màn hình điện thoại)
      trackerOpen = !trackerOpen;
      try {
        localStorage.setItem(TRACK_KEY, trackerOpen ? '1' : '0');
      } catch {
        /* bỏ qua */
      }
      applyTracker();
    },
    true,
  );

  // --- giữ màn hình sáng khi chơi ---------------------------------------------
  let wake = null;
  const keepAwake = async () => {
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {
      /* trình duyệt không hỗ trợ / bị từ chối: bỏ qua */
    }
  };
  root.addEventListener('pointerdown', () => {
    if (!wake || wake.released) keepAwake();
  });

  // --- hiện / ẩn theo trạng thái game ----------------------------------------
  const releaseAll = () => {
    setAxis(0, 0);
    movePid = null;
    base.classList.remove('on');
    looks.clear();
    pinch = 0;
    if (running) {
      running = false;
      run.classList.remove('on');
      fire('keyup', 'ShiftLeft');
    }
    jump.classList.remove('down');
    fire('keyup', 'Space');
  };
  let wasLive = false;
  let shownRotate = false;
  setInterval(() => {
    const g = game();
    const playing = !!g && g.status === 'playing' && !g.menus?.active && !g.screens?.active;
    const battle = playing && !!g.battle?.active;
    root.classList.toggle('hidden', !playing);
    applyTracker();
    root.classList.toggle('battle', battle);
    document.body.classList.toggle('tc-battle', battle);
    const live = playing && !battle;
    if (wasLive && !live) releaseAll(); // vào menu / trận đấu: nhả hết phím đang giữ
    wasLive = live;
    if (playing && !shownRotate) {
      shownRotate = true;
      rotate.classList.add('show'); // chỉ thấy khi đang để dọc (xem touch.css)
      setTimeout(() => rotate.classList.remove('show'), 7000);
    }
  }, 100);
  window.addEventListener('blur', releaseAll);
}
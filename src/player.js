import * as THREE from 'three';
import { makeLoader } from './loader';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 6;
const RUN_SPEED = 14;
const GRAVITY = 30;
const JUMP_SPEED = 10;
const MOUSE_SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;
const FADE = 0.2; // giây chuyển mượt giữa 2 animation

// Tự nhận diện clip theo tên (không phân biệt hoa thường). Có thể ghi đè bằng tuỳ chọn `clips`.
const CLIP_PATTERNS = {
  idle: /idle|stand|breath/i,
  walk: /walk/i,
  run: /run|sprint|jog/i,
  jump: /jump|fall|air/i,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Nội suy góc theo đường ngắn nhất. */
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Player {
  constructor(camera, dom, terrain) {
    /** Vị trí CHÂN của player trong thế giới. */
    this.position = new THREE.Vector3();
    /** Nhân vật (chỉ hiện ở góc nhìn thứ 3). Nhớ scene.add(player.body). */
    this.body = new THREE.Group();
    this.mode = 'first';
    this.yaw = 0; // xoay trái/phải (quanh trục Y)
    this.pitch = 0; // ngẩng/cúi

    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.keys = new Set();
    this.vy = 0;
    this.bodyYaw = 0;
    this.armLength = 6; // khoảng cách cam ở góc nhìn thứ 3
    this.head = new THREE.Vector3();

    this.placeholder = null; // hình nhộng tạm, bị thay khi GLB tải xong
    this.mixer = null;
    this.actions = {}; // { idle, walk, run, jump } -> AnimationAction | null
    this.current = null;
    this.override = null; // animation 1 lần đang phát (vd 'summon'): tạm khoá việc tự chọn idle/walk
    // Dùng cho hệ thống thách đấu
    this.locked = false; // true: không điều khiển được (đang thách đấu)
    this.forceBody = false; // true: luôn hiện nhân vật, kể cả ở góc nhìn thứ 1
    this.faceYaw = null; // khác null: nhân vật xoay dần về hướng này
    this.jumpCount = 0; // số lần nhảy (cho nhiệm vụ)
    this.walkable = null; // (x, z) => boolean: có được bước vào chỗ đó không (chặn không cho đi xuống biển sâu)
    this.onBlocked = null; // gọi khi bị chặn (tối đa 1 lần / 3 giây)
    this.blockCd = 0;

    camera.rotation.order = 'YXZ'; // yaw trước, pitch sau -> kiểu FPS chuẩn, không bị nghiêng
    this.buildPlaceholder();
    this.bindInput();
  }

  /** Đặt người chơi vào vị trí mới (dịch chuyển). */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.vy = 0;
  }

  toggleMode() {
    this.mode = this.mode === 'first' ? 'third' : 'first';
  }

  buildPlaceholder() {
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.9, 4, 12),
      new THREE.MeshLambertMaterial({ color: 0xff7043 }),
    );
    torso.position.y = 0.8;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.15, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222222 }),
    );
    visor.position.set(0, 1.35, -0.3);
    this.placeholder = new THREE.Group();
    this.placeholder.add(torso, visor);
    this.body.add(this.placeholder);
    this.body.visible = false;
  }

  /**
   * Nạp nhân vật GLB kèm animation có sẵn trong file.
   *  height  chiều cao nhân vật (mét)
   *  facing  góc xoay model cho khớp hướng đi. Model glTF chuẩn nhìn về +Z nên mặc định = PI.
   *          Nếu nhân vật đi lùi thì đổi 0 <-> Math.PI.
   *  clips   ghi đè tên clip, ví dụ { idle: 'Idle_A', walk: 'Walk_Forward', run: 'Run', jump: 'Jump' }
   * Lỗi thì giữ hình nhộng, game vẫn chạy.
   */
  async loadModel(url, { height = 1.75, facing = Math.PI, clips = {} } = {}) {
    try {
      const gltf = await makeLoader().loadAsync(url);
      const model = gltf.scene;

      // Scale về đúng chiều cao, chân chạm y = 0, căn giữa X/Z
      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (size.y > 1e-6) model.scale.multiplyScalar(height / size.y);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;

      // Mesh có xương: bounding box lấy ở tư thế gốc nên dễ bị cắt nhầm khi đang animation -> tắt culling
      model.traverse((o) => {
        if (o.isMesh) o.frustumCulled = false;
      });

      const pivot = new THREE.Group();
      pivot.rotation.y = facing;
      pivot.add(model);

      if (this.placeholder) {
        this.body.remove(this.placeholder);
        this.placeholder.traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            o.material.dispose();
          }
        });
        this.placeholder = null;
      }
      this.body.add(pivot);

      this.setupAnimations(model, gltf.animations, clips);
    } catch (err) {
      console.warn(`[player] Không tải được "${url}" -> dùng hình nhộng`, err);
    }
  }

  setupAnimations(model, animations, overrides) {
    console.log('[player] animation có trong GLB:', animations.map((c) => c.name));
    if (animations.length === 0) return;

    const byName = (name) => animations.find((c) => c.name.toLowerCase() === String(name).toLowerCase()) ?? null;
    const find = (key) => {
      const o = overrides[key];
      if (o) {
        const clip = byName(o);
        if (!clip) console.warn(`[player] Không thấy clip "${o}" cho "${key}"`);
        return clip;
      }
      return animations.find((c) => CLIP_PATTERNS[key].test(c.name)) ?? null;
    };
    const idle = find('idle');
    const walk = find('walk');
    const run = find('run');
    const jump = find('jump');

    this.mixer = new THREE.AnimationMixer(model);
    const act = (clip, once = false) => {
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      if (once) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true; // giữ tư thế cuối khi còn đang trên không
      }
      return a;
    };
    this.actions = {
      idle: act(idle),
      walk: act(walk ?? run), // thiếu clip nào thì mượn clip còn lại
      run: act(run ?? walk),
      jump: act(jump, true),
    };
    // Clip bổ sung khai báo qua `clips` (vd summon: 'Tender Placement'): phát 1 lần bằng player.playOnce('summon')
    for (const [key, name] of Object.entries(overrides)) {
      if (key in this.actions || !name) continue;
      const clip = byName(name);
      if (clip) this.actions[key] = act(clip, true);
      else console.warn(`[player] Không thấy clip "${name}" cho "${key}"`);
    }
    console.log('[player] gán animation:', {
      idle: idle?.name ?? null,
      walk: (walk ?? run)?.name ?? null,
      run: (run ?? walk)?.name ?? null,
      jump: jump?.name ?? null,
    });
    this.setState('idle');
  }

  /** Chuyển sang animation theo trạng thái, có crossfade. Thiếu clip thì bỏ qua. */
  setState(state) {
    const next = this.actions[state] ?? null;
    if (next === this.current) return;
    if (next) next.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    if (this.current) this.current.fadeOut(FADE);
    this.current = next;
  }

  /** Phát 1 clip một lần (vd 'summon'). Trả về thời lượng (giây), 0 nếu model không có clip đó. */
  playOnce(key) {
    const a = this.actions[key];
    if (!a) return 0;
    if (this.current && this.current !== a) this.current.fadeOut(FADE);
    a.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    this.current = a;
    this.override = a;
    return a.getClip().duration;
  }

  /** Kết thúc clip 1 lần: nhân vật tự quay về idle / walk. */
  endOnce() {
    this.override = null;
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyV' && !e.repeat) this.toggleMode();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener('click', () => {
      void this.dom.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked || document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * MOUSE_SENS; // chuột sang phải -> quay phải (yaw giảm)
      this.pitch = clamp(this.pitch - e.movementY * MOUSE_SENS, -MAX_PITCH, MAX_PITCH);
    });
    this.dom.addEventListener(
      'wheel',
      (e) => {
        this.armLength = clamp(this.armLength + e.deltaY * 0.005, 2, 15);
      },
      { passive: true },
    );
  }

  update(dt) {
    this.blockCd -= dt;
    const k = this.keys;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);

    // Di chuyển theo hướng nhìn (chỉ trên mặt phẳng XZ)
    const f = this.locked ? 0 : (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = this.locked ? 0 : (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let dx = -sy * f + cy * r;
    let dz = -cy * f - sy * r;
    const len = Math.hypot(dx, dz);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    if (len > 0) {
      dx /= len;
      dz /= len;
      const speed = running ? RUN_SPEED : WALK_SPEED;
      const nx = this.position.x + dx * speed * dt;
      const nz = this.position.z + dz * speed * dt;
      if (!this.walkable || this.walkable(nx, nz)) {
        this.position.x = nx;
        this.position.z = nz;
      } else {
        // trượt dọc theo "bức tường" biển: thử đi riêng từng trục
        if (this.walkable(nx, this.position.z)) this.position.x = nx;
        else if (this.walkable(this.position.x, nz)) this.position.z = nz;
        if (this.blockCd <= 0) {
          this.blockCd = 3;
          this.onBlocked?.();
        }
      }
      // thân người xoay dần về hướng đang đi (thấy được ở góc nhìn thứ 3)
      this.bodyYaw = lerpAngle(this.bodyYaw, Math.atan2(-dx, -dz), 1 - Math.exp(-12 * dt));
    }

    if (this.faceYaw !== null) this.bodyYaw = lerpAngle(this.bodyYaw, this.faceYaw, 1 - Math.exp(-10 * dt));

    // Bám địa hình: lấy độ cao thẳng từ hàm height(), không cần raycast
    const ground = this.terrain.height(this.position.x, this.position.z);
    const onGround = this.position.y - ground < 0.1;
    if (onGround && !this.locked && k.has('Space')) {
      this.vy = JUMP_SPEED;
      this.jumpCount++;
    }
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.vy = 0;
    }

    // Chọn animation: trên không > chạy/đi > đứng yên
    if (this.mixer) {
      const airborne = this.position.y - ground > 0.4;
      const move = len > 0 ? (running ? 'run' : 'walk') : 'idle';
      if (!this.override) this.setState(airborne && this.actions.jump ? 'jump' : move);
      // Không có clip chạy riêng -> dùng clip đi bộ nhưng phát nhanh hơn
      if (this.actions.run && this.actions.run === this.actions.walk) {
        this.actions.walk.timeScale = running ? 1.6 : 1;
      }
      this.mixer.update(dt);
    }

    this.body.position.copy(this.position);
    this.body.rotation.y = this.bodyYaw;

    this.updateCamera();
  }

  updateCamera() {
    const p = this.position;
    this.head.set(p.x, p.y + EYE_HEIGHT, p.z);

    // Cam luôn có cùng yaw/pitch với player
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    if (this.mode === 'first') {
      this.camera.position.copy(this.head);
      this.body.visible = this.forceBody;
      return;
    }

    // Góc nhìn thứ 3: lùi ra sau theo hướng nhìn.
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;

    // "Spring arm": đi dần từ đầu ra sau, nếu chạm địa hình thì rút ngắn khoảng cách
    const STEPS = 12;
    let allowed = this.armLength;
    for (let i = 1; i <= STEPS; i++) {
      const t = (this.armLength * i) / STEPS;
      const x = this.head.x - fx * t;
      const y = this.head.y - fy * t;
      const z = this.head.z - fz * t;
      if (y < this.terrain.height(x, z) + 0.5) {
        allowed = (this.armLength * (i - 1)) / STEPS;
        break;
      }
    }
    allowed = Math.max(allowed, 0.3);

    this.camera.position.set(
      this.head.x - fx * allowed,
      this.head.y - fy * allowed,
      this.head.z - fz * allowed,
    );
    // cam nằm trên đường thẳng đi qua đầu theo hướng nhìn nên không cần lookAt()
    this.body.visible = this.forceBody || allowed > 1.2; // cam quá sát thì ẩn thân để khỏi che tầm nhìn
  }
}
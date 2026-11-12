import * as THREE from 'three';
import { makeLoader } from './loader';

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 6;
const RUN_SPEED = 14;
const GRAVITY = 30;
const JUMP_SPEED = 10;
const MOUSE_SENS = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;
const FADE = 0.2;

const CLIP_PATTERNS = {
  idle: /idle|stand|breath/i,
  walk: /walk/i,
  run: /run|sprint|jog/i,
  jump: /jump|fall|air/i,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Player {
  constructor(camera, dom, terrain) {
    this.position = new THREE.Vector3();
    this.body = new THREE.Group();
    this.mode = 'first';
    this.yaw = 0;
    this.pitch = 0;

    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.keys = new Set();
    this.vy = 0;
    this.bodyYaw = 0;
    this.armLength = 6;
    this.head = new THREE.Vector3();

    this.placeholder = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;

    camera.rotation.order = 'YXZ';
    this.buildPlaceholder();
    this.bindInput();
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

  async loadModel(url, { height = 1.75, facing = Math.PI, clips = {} } = {}) {
    try {
      const gltf = await makeLoader().loadAsync(url);
      const model = gltf.scene;

      model.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      if (size.y > 1e-6) model.scale.multiplyScalar(height / size.y);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      model.position.y -= box.min.y;

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

    const find = (key) => {
      const o = overrides[key];
      if (o) return animations.find((c) => c.name.toLowerCase() === String(o).toLowerCase()) ?? null;
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
        a.clampWhenFinished = true;
      }
      return a;
    };
    this.actions = {
      idle: act(idle),
      walk: act(walk ?? run),
      run: act(run ?? walk),
      jump: act(jump, true),
    };
    this.setState('idle');
  }

  setState(state) {
    const next = this.actions[state] ?? null;
    if (next === this.current) return;
    if (next) next.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    if (this.current) this.current.fadeOut(FADE);
    this.current = next;
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
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * MOUSE_SENS;
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
    const k = this.keys;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);

    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let dx = -sy * f + cy * r;
    let dz = -cy * f - sy * r;
    const len = Math.hypot(dx, dz);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    if (len > 0) {
      dx /= len;
      dz /= len;
      const speed = running ? RUN_SPEED : WALK_SPEED;
      this.position.x += dx * speed * dt;
      this.position.z += dz * speed * dt;
      this.bodyYaw = lerpAngle(this.bodyYaw, Math.atan2(-dx, -dz), 1 - Math.exp(-12 * dt));
    }

    const ground = this.terrain.height(this.position.x, this.position.z);
    const onGround = this.position.y - ground < 0.1;
    if (onGround && k.has('Space')) this.vy = JUMP_SPEED;
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.vy = 0;
    }

    if (this.mixer) {
      const airborne = this.position.y - ground > 0.4;
      const move = len > 0 ? (running ? 'run' : 'walk') : 'idle';
      this.setState(airborne && this.actions.jump ? 'jump' : move);
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

    this.camera.rotation.set(this.pitch, this.yaw, 0);

    if (this.mode === 'first') {
      this.camera.position.copy(this.head);
      this.body.visible = false;
      return;
    }

    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;

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
    this.body.visible = allowed > 1.2;
  }
}
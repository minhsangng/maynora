import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { makeLoader } from './loader';

export const MOD_DEFS = [
  {
    id: 'quy_ti', name: 'Quỷ Tí', url: '/models/mods/demon.glb', color: 0xff6a3d, height: 1.1,
    wildWeight: 2, hp: 48, atk: 11, defense: 6, spd: 9,
    moves: [
      { name: 'Cào', power: 10, accuracy: 100 },
      { name: 'Phun lửa', power: 16, accuracy: 90 },
      { name: 'Húc', power: 13, accuracy: 95 },
    ],
  },
  {
    id: 'moc_ti', name: 'Mộc Tí', url: '/models/mods/demon.glb', color: 0x5cc45a, height: 1.1,
    wildWeight: 2, hp: 54, atk: 10, defense: 7, spd: 8,
    moves: [
      { name: 'Quất dây', power: 11, accuracy: 100 },
      { name: 'Lá cắt', power: 15, accuracy: 92 },
      { name: 'Đâm gai', power: 14, accuracy: 95 },
    ],
  },
  {
    id: 'thuy_ti', name: 'Thủy Tí', url: '/models/mods/demon.glb', color: 0x4aa8ff, height: 1.1,
    wildWeight: 2, hp: 50, atk: 10, defense: 7, spd: 10,
    moves: [
      { name: 'Vỗ nước', power: 10, accuracy: 100 },
      { name: 'Bắn bọt', power: 15, accuracy: 95 },
      { name: 'Sóng lớn', power: 18, accuracy: 85 },
    ],
  },
  {
    id: 'soi_da', name: 'Sói Đá', url: '/models/mods/demon.glb', color: 0x8d8a85, height: 1.5,
    wildWeight: 3, hp: 62, atk: 13, defense: 9, spd: 11,
    moves: [
      { name: 'Cắn', power: 12, accuracy: 100 },
      { name: 'Ném đá', power: 17, accuracy: 88 },
      { name: 'Vồ', power: 14, accuracy: 95 },
    ],
  },
  {
    id: 'cu_dem', name: 'Cú Đêm', url: '/models/mods/demon.glb', color: 0x6b4fa0, height: 1.0,
    wildWeight: 2, hp: 44, atk: 14, defense: 5, spd: 14,
    moves: [
      { name: 'Mổ', power: 11, accuracy: 100 },
      { name: 'Lao xuống', power: 18, accuracy: 85 },
      { name: 'Vỗ cánh', power: 12, accuracy: 100 },
    ],
  },
  {
    id: 'rua_co', name: 'Rùa Cổ', url: '/models/mods/demon.glb', color: 0x4f8a6b, height: 1.3,
    wildWeight: 1, hp: 80, atk: 9, defense: 14, spd: 4,
    moves: [
      { name: 'Húc mai', power: 10, accuracy: 100 },
      { name: 'Dậm đất', power: 15, accuracy: 90 },
      { name: 'Cắn', power: 12, accuracy: 100 },
    ],
  },
];

const FADE = 0.2;
const CLIP_PATTERNS = {
  idle: /idle|stand|breath/i,
  walk: /walk|run|move/i,
  attack: /attack|bite|claw|strike|punch|slash/i,
  hit: /hit|hurt|damage|react/i,
  faint: /death|die|faint|dead/i,
};

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** Hình nhộng khi chưa có GLB: thân tròn, đầu, tai, mắt. Mặt nhìn về +Z. */
function makePlaceholder(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat);
  body.position.y = 0.42;
  body.scale.set(1, 0.95, 1.1);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat);
  head.position.set(0, 0.82, 0.25);
  g.add(body, head);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), mat);
    ear.position.set(sx * 0.17, 1.08, 0.2);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), white);
    eye.position.set(sx * 0.11, 0.86, 0.5);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), black);
    pupil.position.set(sx * 0.11, 0.86, 0.56);
    g.add(ear, eye, pupil);
  }
  return g;
}

/** Scale về đúng chiều cao, chân ở y = 0, căn giữa X/Z. */
function normalize(root, height) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.scale.setScalar(size.y > 1e-6 ? height / size.y : 1);
  return wrapper;
}

export class ModLibrary {
  constructor(defs = MOD_DEFS) {
    this.defs = defs;
    this.map = new Map(defs.map((d) => [d.id, d]));
    this.templates = new Map();
  }

  def(id) {
    return this.map.get(id);
  }

  async load() {
    const loader = makeLoader();
    await Promise.all(
      this.defs.map(async (def) => {
        let root = null;
        let animations = [];
        if (def.url) {
          try {
            const gltf = await loader.loadAsync(def.url);
            root = gltf.scene;
            animations = gltf.animations;
            console.log(`[mods] ${def.name} <- ${def.url}: clip =`, animations.map((c) => c.name));
          } catch {
            console.warn(`[mods] Chưa có "${def.url}" -> dùng hình nhộng cho "${def.name}"`);
          }
        }
        if (!root) root = makePlaceholder(def.color ?? 0x88aaff);
        this.templates.set(def.id, { root: normalize(root, def.height ?? 1.2), animations });
      }),
    );
  }

  spawn(id, opts) {
    const def = this.map.get(id);
    const t = this.templates.get(id);
    return new ModActor(def, cloneSkinned(t.root), t.animations, opts);
  }
}

/** 1 con mod đang có mặt trong thế giới (hoang dã hoặc do người chơi triệu hồi). */
export class ModActor {
  constructor(def, root, animations, { level = 1, owner = 'wild' } = {}) {
    this.def = def;
    this.level = level;
    this.owner = owner;
    const k = 1 + 0.12 * (level - 1);
    this.stats = { atk: def.atk * k, defense: def.defense * k, spd: def.spd * k };
    this.maxHp = Math.round(def.hp * k);
    this.hp = this.maxHp;

    // group (vị trí + quay mặt về mục tiêu) > model (hiệu ứng thủ tục) > pivot (bù hướng model) > root
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.rotation.y = def.facing ?? 0;
    pivot.add(root);
    this.model.add(pivot);
    this.group.add(this.model);

    this.moving = false;
    this.engaged = false;
    this.fainted = false;
    this.gone = false;
    this.met = false;
    this.ai = null;
    this.time = Math.random() * 10;
    this.targetYaw = 0;
    this.scale = 1;
    this.scaleAnim = null;
    this.fx = null;
    this.flashT = 0;
    this.mixer = null;
    this.actions = {};
    this.loopCurrent = null;
    this.once = null;
    this.label = null;

    // Mỗi con có material riêng để nhấp nháy đỏ / mờ dần mà không ảnh hưởng con khác
    this.materials = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const clone = (m) => {
        const c = m.clone();
        c.userData.e0 = c.emissive ? c.emissive.clone() : null;
        this.materials.push(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    });

    if (animations.length > 0) this.setupAnimations(root, animations);
    this.buildLabel();
  }

  get name() {
    return this.def.name;
  }

  get tag() {
    return `${this.def.name} Lv${this.level}`;
  }

  setupAnimations(root, animations) {
    const find = (key) => {
      const o = this.def.clips?.[key];
      if (o) return animations.find((c) => c.name.toLowerCase() === String(o).toLowerCase()) ?? null;
      return animations.find((c) => CLIP_PATTERNS[key].test(c.name)) ?? null;
    };
    this.mixer = new THREE.AnimationMixer(root);
    const act = (clip, mode) => {
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      if (mode) a.setLoop(THREE.LoopOnce, 1);
      if (mode === 'hold') a.clampWhenFinished = true;
      return a;
    };
    const idle = find('idle');
    const walk = find('walk');
    this.actions = {
      idle: act(idle ?? walk),
      walk: act(walk),
      attack: act(find('attack'), 'once'),
      hit: act(find('hit'), 'once'),
      faint: act(find('faint'), 'hold'),
    };
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.once) this.once = null;
    });
  }

  buildLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(4, 8, 248, 48, 14);
    ctx.fill();
    ctx.fillStyle = this.owner === 'player' ? '#9fffb0' : '#ffffff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.tag, 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.y = (this.def.height ?? 1.2) + 0.55;
    sprite.renderOrder = 5;
    this.group.add(sprite);
    this.label = sprite;
  }

  /** Quay mặt về hướng (dx, dz) trên mặt phẳng ngang. */
  faceDir(dx, dz, instant = false) {
    if (Math.hypot(dx, dz) < 1e-4) return;
    this.targetYaw = Math.atan2(dx, dz);
    if (instant) this.group.rotation.y = this.targetYaw;
  }

  spawnIn(dur = 0.5) {
    this.scale = 0;
    this.scaleAnim = { t: 0, dur, from: 0, to: 1, ease: easeOutBack };
  }

  vanish(dur = 0.35) {
    this.scaleAnim = { t: 0, dur, from: this.scale, to: 0, ease: (u) => u * u, onDone: () => (this.gone = true) };
  }

  takeDamage(n) {
    this.hp = Math.max(0, this.hp - n);
  }

  playOnce(key) {
    const a = this.actions[key];
    if (!a) return 0;
    a.reset().setEffectiveWeight(1).fadeIn(0.1).play();
    if (this.loopCurrent) {
      this.loopCurrent.fadeOut(0.1);
      this.loopCurrent = null;
    }
    this.once = key === 'faint' ? null : a;
    return a.getClip().duration;
  }

  setLoop(name) {
    const next = this.actions[name] ?? this.actions.idle ?? null;
    if (next === this.loopCurrent) return;
    next?.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    this.loopCurrent?.fadeOut(FADE);
    this.loopCurrent = next;
  }

  attack(reach = 2) {
    this.playOnce('attack');
    if (!this.actions.attack) this.fx = { type: 'lunge', t: 0, dur: 0.6, reach };
  }

  hit() {
    this.flashT = 0.3;
    this.playOnce('hit');
    if (!this.actions.hit) this.fx = { type: 'shake', t: 0, dur: 0.35 };
  }

  faint() {
    if (this.fainted) return;
    this.fainted = true;
    const d = this.playOnce('faint');
    this.fx = { type: 'faint', t: 0, tip: !this.actions.faint, hold: Math.max(d, 0.9), fade: 0.6 };
  }

  setOpacity(o) {
    for (const m of this.materials) {
      m.transparent = true;
      m.opacity = o;
    }
  }

  update(dt) {
    if (this.gone) return;
    this.time += dt;
    this.mixer?.update(dt);
    this.group.rotation.y = lerpAngle(this.group.rotation.y, this.targetYaw, 1 - Math.exp(-10 * dt));

    if (this.scaleAnim) {
      const a = this.scaleAnim;
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      this.scale = a.from + (a.to - a.from) * a.ease(u);
      if (u >= 1) {
        this.scaleAnim = null;
        a.onDone?.();
      }
    }
    this.group.scale.setScalar(Math.max(this.scale, 0.0001));

    if (this.mixer && !this.once && !this.fainted) this.setLoop(this.moving ? 'walk' : 'idle');

    // Hiệu ứng thủ tục: đặt lại rồi áp dụng mỗi frame
    const m = this.model;
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    if (!this.fainted) {
      if (!this.actions.idle) m.scale.y = 1 + Math.sin(this.time * 2.2) * 0.03; // thở nhẹ
      if (this.moving && !this.actions.walk) m.position.y = Math.abs(Math.sin(this.time * 9)) * 0.1; // nhún bước
    }

    const fx = this.fx;
    if (fx) {
      fx.t += dt;
      if (fx.type === 'lunge') {
        const u = Math.min(1, fx.t / fx.dur);
        m.position.z = Math.sin(Math.PI * u) * fx.reach;
        if (u >= 1) this.fx = null;
      } else if (fx.type === 'shake') {
        const u = Math.min(1, fx.t / fx.dur);
        m.position.x = Math.sin(fx.t * 50) * 0.22 * (1 - u);
        if (u >= 1) this.fx = null;
      } else if (fx.type === 'faint') {
        if (fx.tip) m.rotation.z = Math.min(1, fx.t / 0.6) * 1.45;
        if (fx.t > fx.hold) {
          const u = Math.min(1, (fx.t - fx.hold) / fx.fade);
          this.setOpacity(1 - u);
          if (u >= 1) this.gone = true;
        }
      }
    }

    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / 0.3;
      for (const mat of this.materials) {
        if (!mat.emissive) continue;
        if (k > 0) mat.emissive.setRGB(k, k * 0.1, k * 0.05);
        else if (mat.userData.e0) mat.emissive.copy(mat.userData.e0);
        else mat.emissive.setRGB(0, 0, 0);
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
  }
}

/** Hiệu ứng vòng sáng + nơi "nhận nuôi" các mod đang biến mất / gục để chúng tự dọn khi xong. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.actors = [];
    this.ringGeo = new THREE.RingGeometry(0.35, 0.5, 40).rotateX(-Math.PI / 2);
  }

  ring(pos, color = 0xffffff, size = 3) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(pos.x, pos.y + 0.15, pos.z);
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    this.rings.push({ mesh, t: 0, dur: 0.7, size });
  }

  adopt(actor) {
    this.actors.push(actor);
  }

  /** Dọn sạch hiệu ứng và các mod đang biến mất (khi chuyển đảo). */
  clear() {
    for (const r of this.rings) {
      r.mesh.removeFromParent();
      r.mesh.material.dispose();
    }
    this.rings = [];
    for (const a of this.actors) a.dispose();
    this.actors = [];
  }

  update(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const u = Math.min(1, r.t / r.dur);
      r.mesh.scale.setScalar(1 + u * r.size * 2);
      r.mesh.material.opacity = 0.9 * (1 - u);
      if (u >= 1) {
        r.mesh.removeFromParent();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      a.update(dt);
      if (a.gone) {
        a.dispose();
        this.actors.splice(i, 1);
      }
    }
  }
}
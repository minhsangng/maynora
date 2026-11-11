import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const gltfLoader = new GLTFLoader(), cache = new Map();

// Thư mục chứa texture, nằm CẠNH file .fbx (đặt '' nếu texture để chung thư mục với file fbx)
const TEXTURE_DIR = 'textures/';

export const preload = urls => Promise.all(urls.map(async u => {
  if (cache.has(u)) return;
  const head = await fetch(u, { method: 'HEAD' });
  if (!head.ok || (head.headers.get('content-type') || '').includes('text/html'))
    throw new Error(`Không tìm thấy file "${u}". Kiểm tra file có nằm ở public${u} không (đúng tên, đúng hoa/thường).`);
  const isFbx = u.toLowerCase().endsWith('.fbx');
  // FBX ghi sẵn đường dẫn texture theo máy tác giả; ta chỉ lấy TÊN file rồi tìm trong thư mục texture
  const loader = isFbx ? new FBXLoader().setResourcePath(u.slice(0, u.lastIndexOf('/') + 1) + TEXTURE_DIR) : gltfLoader;
  const src = await loader.loadAsync(u);
  cache.set(u, src);
  if (import.meta.env?.DEV) describe(u, src);   // in thông tin model ra console khi dev
}));

// In thông tin để biết model có gì: kích thước, animation, xương, texture
function describe(url, src) {
  const root = src.scene ?? src, bones = [], meshes = [];
  root.traverse(o => {
    if (o.isBone) bones.push(o.name);
    if (o.isMesh) meshes.push(`${o.name} | vật liệu: ${[].concat(o.material).map(m => `${m.name} (${m.map ? 'có' : 'KHÔNG'} texture)`).join(', ')}`);
  });
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  console.group(`[asset] ${url}`);
  console.log('kích thước:', size.toArray().map(n => +n.toFixed(2)));
  console.log('animation:', src.animations.map(a => `${a.name} (${a.duration.toFixed(1)}s)`));
  console.log(`xương (${bones.length}):`, bones.slice(0, 15).join(', '));
  console.log('mesh:', meshes);
  console.groupEnd();
}

// Bộ điều khiển animation dùng chung. sets = [{ mixer, actions }], mỗi phần của model có 1 set
function animated(content, sets, { scale, rotationY }) {
  content.scale.setScalar(scale); content.rotation.y = rotationY;
  content.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const root = new THREE.Group(); root.add(content);

  let current = null, busy = false, busyName = null;
  const go = (n, force) => {
    if ((!force && n === current) || !sets.some(s => s.actions[n])) return;
    for (const { actions } of sets) {
      const next = actions[n]; if (!next) continue;
      next.reset().fadeIn(0.15).play();
      if (current && current !== n) actions[current]?.fadeOut(0.15);
    }
    current = n;
  };
  for (const { mixer } of sets) mixer.addEventListener('finished', () => { busy = false; });
  go('idle');
  return {
    root,
    play(n) {
      if (!sets.some(s => s.actions[n])) return;
      for (const { actions } of sets) { const a = actions[n]; if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } }
      go(n, true); busy = true; busyName = n;
    },
    names: Object.keys(sets[0]?.actions ?? {}),
    animate(dt, e) {
      if (busy && busyName !== 'attack' && e.isMoving) busy = false;   // đi thì thoát animation đang diễn
      if (!busy) go(e.isMoving ? 'walk' : 'idle'); for (const { mixer } of sets) mixer.update(dt); },
  };
}

// Clip Mixamo tính bằng cm, model có thể tính bằng m: tự tìm tỉ lệ dựa trên xương Hips
function fitClip(clip, obj) {
  const hips = obj.getObjectByName('mixamorigHips');
  const track = clip.tracks.find(t => t.name === 'mixamorigHips.position');
  if (!hips || !track) return clip;
  const a = hips.position.length(), b = new THREE.Vector3().fromArray(track.values, 0).length();
  if (!a || !b) return clip;
  const k = 10 ** Math.round(Math.log10(a / b));
  if (k === 1) return clip;
  const c = clip.clone();
  c.tracks.forEach(t => { if (t.name.endsWith('.position')) t.values = t.values.map(v => v * k); });
  return c;
}

//   clips: { walk: 'Walking' }          animation nằm sẵn trong file .glb (tên xem ở console)
//   anims: { idle: '/models/idle.fbx' } animation ở file riêng (Mixamo "Without Skin")
//   height: chiều cao mong muốn (mét). Code tự đo model và tự tính scale. Đặt height: 0 để dùng scale thủ công.
export function glbModel(url, { height = 1.8, scale = 1, rotationY = 0, clips = {}, anims = {} } = {}) {
  const gltf = cache.get(url);
  if (!gltf) throw new Error(`Chưa preload ${url}`);
  const obj = SkeletonUtils.clone(gltf.scene), mixer = new THREE.AnimationMixer(obj), actions = {};
  for (const [k, name] of Object.entries(clips)) {
    const c = THREE.AnimationClip.findByName(gltf.animations, name);
    if (c) actions[k] = mixer.clipAction(c); else console.warn(`[glbModel] không có clip "${name}" trong ${url}`);
  }
  for (const c of gltf.animations) actions[c.name] ??= mixer.clipAction(c);   // gọi được bằng tên gốc: playAnim('Walking')
  for (const [k, a] of Object.entries(anims)) {
    const c = cache.get(a)?.animations[0];
    if (c) actions[k] = mixer.clipAction(fitClip(c, obj)); else console.warn(`[glbModel] không có animation trong ${a} (đã thêm vào assets chưa?)`);
  }
  const content = new THREE.Group(); content.add(obj);
  let sc = scale, dy = 0;
  if (height) {
    content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(content, true), size = box.getSize(new THREE.Vector3());
    if (!box.isEmpty() && size.y > 0) {
      sc = height / size.y; dy = -box.min.y * sc;
      console.log(`[glbModel] ${url}: cao ${size.y.toPrecision(4)} -> scale ${sc.toPrecision(4)}`);
    } else console.warn(`[glbModel] ${url}: không đo được kích thước (box rỗng)`);
  }
  const out = animated(content, [{ mixer, actions }], { scale: sc, rotationY });
  content.position.y = dy;   // đặt chân chạm đất
  return out;
}

// Model gồm NHIỀU file cùng bộ xương (body, áo, quần, giày, mũ...).
// Mỗi phần có mixer riêng nhưng chạy cùng 1 clip -> khớp nhau vì clip tìm xương theo TÊN.
//   anims: { idle: 'file.fbx', ... }  animation ở file riêng (lấy clip đầu tiên)
//   clips: { idle: 'tên clip' }       animation nằm sẵn trong file phần đó
export function fbxParts(urls, { scale = 0.01, rotationY = 0, anims = {}, clips = {} } = {}) {
  const content = new THREE.Group(), sets = [];
  for (const url of [].concat(urls)) {
    const src = cache.get(url);
    if (!src) throw new Error(`Chưa preload ${url} (thêm vào assets của prefab)`);
    const obj = SkeletonUtils.clone(src); content.add(obj);
    const mixer = new THREE.AnimationMixer(obj), actions = {};
    for (const [k, a] of Object.entries(anims)) { const c = cache.get(a)?.animations[0]; if (c) actions[k] = mixer.clipAction(c); }
    for (const [k, n] of Object.entries(clips)) { const c = THREE.AnimationClip.findByName(src.animations, n); if (c) actions[k] = mixer.clipAction(c); }
    sets.push({ mixer, actions });
  }
  return animated(content, sets, { scale, rotationY });
}
export const fbxModel = (url, opts) => fbxParts([url], opts);
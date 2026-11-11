import * as THREE from 'three';
export class CameraRig {
  constructor() {
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 200); this.persp.position.set(0, 6, 9);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera = this.persp; this.viewH = 10;
  }
  toggle() { this.camera = this.camera === this.persp ? this.ortho : this.persp; }
  resize(w, h) {
    const a = w / h, o = this.ortho;
    this.persp.aspect = a; this.persp.updateProjectionMatrix();
    o.left = -this.viewH * a / 2; o.right = this.viewH * a / 2; o.top = this.viewH / 2; o.bottom = -this.viewH / 2;
    o.updateProjectionMatrix();
  }
  follow(t) {
    if (!t) return;
    const p = t.position;
    if (this.camera === this.persp) { this.persp.position.lerp(new THREE.Vector3(p.x, p.y + 6, p.z + 9), 0.08); this.persp.lookAt(p.x, p.y + 1.5, p.z); }
    else { this.ortho.position.set(p.x, 3.5, 30); this.ortho.lookAt(p.x, 3.5, 0); }  // góc nhìn ngang kiểu 2D
  }
}

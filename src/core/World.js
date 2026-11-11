import * as THREE from 'three';
import { Entity } from './Entity.js';
import { getPrefab } from './Registry.js';
import { CameraRig } from './CameraRig.js';

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.rig = new CameraRig();
    this.entities = []; this.projectiles = []; this.player = null;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(6, 12, 8); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25 });
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x7fb88a }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    const grid = new THREE.GridHelper(200, 200, 0x000000, 0x000000);
    grid.material.transparent = true; grid.material.opacity = 0.1; grid.position.y = 0.01;
    this.scene.add(ground, grid);

    addEventListener('resize', () => this.resize()); this.resize();
  }
  resize() { this.renderer.setSize(innerWidth, innerHeight, false); this.rig.resize(innerWidth, innerHeight); }

  // "Instantiate" một prefab theo id
  spawn(id, pos = [0, 0, 0], overrides) {
    const e = new Entity(getPrefab(id), overrides);
    e.position.set(...pos); e.world = this;
    this.entities.push(e); this.scene.add(e.object, e.hpBar);
    if (e.type === 'player') this.player = e;
    return e;
  }
  addProjectile(p) { this.projectiles.push(p); this.scene.add(p.mesh); }

  update(dt) {
    for (const e of this.entities) e.update(dt, this);
    for (const p of this.projectiles) p.update(dt, this);
    this.entities = this.entities.filter(e => {
      if (e.removed) { this.scene.remove(e.object, e.hpBar); return false; } return true;
    });
    this.projectiles = this.projectiles.filter(p => {
      if (p.dead) { this.scene.remove(p.mesh); p.dispose(); return false; } return true;
    });
    this.rig.follow(this.player);
  }
  render() { this.renderer.render(this.scene, this.rig.camera); }
}

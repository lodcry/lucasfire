import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const cache = new Map();
export function loadModel(url, ext) {
  ext = (ext || (url.match(/\.(glb|gltf|fbx)(\?|$)/i) || [])[1] || 'glb').toLowerCase();
  const key = url;
  if (!cache.has(key)) {
    const p = ext === 'fbx'
      ? new FBXLoader().loadAsync(url).then((o) => ({ scene: o, animations: o.animations }))
      : new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    cache.set(key, p);
  }
  return cache.get(key);
}

const BASE = ['idle', 'walk', 'run', 'jump'];
const FALLBACK = { run: 'walk', walk: 'idle', jump: 'idle' };

export class Avatar {
  constructor(manifest) {
    this.root = new THREE.Group();
    this.actions = {};
    this.current = null;
    this.manifest = manifest || null;
    this.placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x4488ff }));
    this.placeholder.position.y = 0.85;
    this.root.add(this.placeholder);
    if (manifest?.url) this.load(manifest);
  }
  async load(m) {
    try {
      this.manifest = m;
      const g = await loadModel(m.url);
      const model = SkeletonUtils.clone(g.scene);
      model.scale.setScalar(m.scale || 1);
      this.root.add(model);
      this.root.remove(this.placeholder);
      this.mixer = new THREE.AnimationMixer(model);
      for (const [action, clipName] of Object.entries(m.clips || {})) {
        const clip = g.animations.find((c) => c.name === clipName);
        if (!clip) continue;
        const a = this.mixer.clipAction(clip);
        if (!BASE.includes(action)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        this.actions[action] = a;
      }
      this.current = null;
      this.play('idle');
    } catch (e) { console.warn('avatar', e); }
  }
  play(a) {
    while (a && !this.actions[a] && FALLBACK[a]) a = FALLBACK[a];
    if (!a || a === this.current || !this.actions[a]) return;
    const n = this.actions[a], o = this.actions[this.current];
    n.reset().play();
    if (o) o.crossFadeTo(n, 0.15, false);
    this.current = a;
  }
  duration(a) { return this.actions[a]?.getClip().duration || 1; }
  setYaw(y) { this.root.rotation.y = y + Math.PI + (this.manifest?.yawOffset || 0); }
  update(dt) { this.mixer?.update(dt); }
}

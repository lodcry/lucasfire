import * as THREE from 'three';
import { Net } from './net.js';
import { Avatar } from './avatar.js';
import { ModClient } from './modclient.js';
import { API } from '../config.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

// ---------- render ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 220);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(30, 60, 20);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4a7c3a }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground, new THREE.GridHelper(400, 100, 0x2f5a25, 0x3d6b30));
const world = new THREE.Group();
scene.add(world);
const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222 }));
gun.position.set(0.2, -0.2, -0.4);
camera.add(gun);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- estado ----------
let boxes = [];
function buildBoxes(list) {
  world.clear();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a });
  for (const b of list) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    m.position.set(b.x, b.h / 2, b.z);
    world.add(m);
  }
  boxes = list;
}
const me = { id: null, pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, ground: true, third: false, anim: 'idle', oneShot: null, binds: {}, avatar: new Avatar(null), k: 0, d: 0 };
scene.add(me.avatar.root);
const remotes = new Map();
const manifests = new Map();
const getManifest = (name) => {
  if (!manifests.has(name)) manifests.set(name, fetch(`${API}/api/assets/${encodeURIComponent(name)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return manifests.get(name);
};
getManifest('default').then((m) => { if (m) { me.avatar.load(m); me.binds = m.binds || {}; } });

// ---------- rede ----------
const net = new Net();
net.on('welcome', (m) => { me.id = m.id; buildBoxes(m.boxes); me.pos.set(m.spawn.x, 0, m.spawn.z); });
net.on('tp', (m) => { me.pos.set(m.x, m.y, m.z); me.vy = 0; });
net.on('snap', (m) => {
  const seen = new Set();
  const rows = [];
  for (const p of m.p) {
    rows.push(p);
    if (p.id === me.id) { me.hp = p.hp; continue; }
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) {
      const avatar = new Avatar(null);
      getManifest(p.c).then((mf) => mf && avatar.load(mf));
      scene.add(avatar.root);
      avatar.root.position.set(p.x, p.y, p.z);
      r = { avatar, target: new THREE.Vector3(), ty: 0, anim: 'idle' };
      remotes.set(p.id, r);
    }
    r.target.set(p.x, p.y, p.z); r.ty = p.r; r.anim = p.a;
  }
  for (const [id, r] of remotes) if (!seen.has(id)) { scene.remove(r.avatar.root); remotes.delete(id); }
  $('hp').textContent = '❤ ' + Math.round(me.hp);
  $('score').innerHTML = rows.sort((a, b) => b.k - a.k).slice(0, 8).map((p) => `${p.n} ${p.k}/${p.d}`).join('<br>');
});
const feed = (txt) => {
  const d = document.createElement('div');
  d.textContent = txt;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 5000);
};
net.on('kill', (m) => feed(`${m.bn} ➜ ${m.tn}`));
net.on('chat', (m) => feed(`${m.n}: ${m.m}`));
net.on('hit', (m) => {
  if (m.by === me.id) { $('hm').style.color = m.part === 'head' ? '#f33' : '#fff'; $('hm').style.opacity = 1; setTimeout(() => ($('hm').style.opacity = 0), 120); }
  if (m.target === me.id) { $('dmg').style.opacity = 1; setTimeout(() => ($('dmg').style.opacity = 0), 150); }
});
net.on('shot', (m) => {
  const a = new THREE.Vector3(...m.o).addScaledVector(new THREE.Vector3(...m.d), 0.6).add(new THREE.Vector3(0, -0.12, 0));
  const b = new THREE.Vector3(...m.o).addScaledVector(new THREE.Vector3(...m.d), m.l);
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe066 }));
  scene.add(line);
  setTimeout(() => { scene.remove(line); g.dispose(); }, 70);
});

// ---------- mods ao vivo ----------
const mc = new ModClient({ THREE, scene, camera, renderer, net, me, API, feed });
mc.loadAll().catch((e) => console.warn('mods:', e.message));
net.on('mod', (m) => { if (m.kind !== 'client') return; m.deleted ? mc.unload(m.path) : mc.load(m); });

// ---------- input ----------
const keys = {};
let playing = false, fire = false, lastShot = 0;
const touch = { mx: 0, mz: 0, jump: false };
const isTouch = 'ontouchstart' in window;

addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!playing) return;
  if (e.code === 'KeyV') me.third = !me.third;
  const k = e.key.toLowerCase();
  for (const [action, key] of Object.entries(me.binds)) {
    if (key === k && me.avatar.actions[action]) me.oneShot = { name: action, until: performance.now() + me.avatar.duration(action) * 1000 };
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  me.yaw -= e.movementX * 0.0022;
  me.pitch = clamp(me.pitch - e.movementY * 0.0022, -1.5, 1.5);
});
addEventListener('mousedown', () => { if (playing) fire = true; });
addEventListener('mouseup', () => (fire = false));
document.addEventListener('pointerlockchange', () => {
  if (!isTouch && document.pointerLockElement !== renderer.domElement) { playing = false; $('menu').style.display = 'flex'; $('play').textContent = 'CONTINUAR'; }
});

if (isTouch) {
  document.body.classList.add('touch');
  let L = null, R = null;
  addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.target.closest && t.target.closest('.btn')) continue;
      if (t.clientX < innerWidth / 2 && !L) L = { id: t.identifier, x: t.clientX, y: t.clientY };
      else if (t.clientX >= innerWidth / 2 && !R) R = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (L && t.identifier === L.id) { touch.mx = clamp((t.clientX - L.x) / 50); touch.mz = clamp((t.clientY - L.y) / 50); }
      if (R && t.identifier === R.id) {
        me.yaw -= (t.clientX - R.x) * 0.006;
        me.pitch = clamp(me.pitch - (t.clientY - R.y) * 0.006, -1.5, 1.5);
        R.x = t.clientX; R.y = t.clientY;
      }
    }
  }, { passive: true });
  addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (L && t.identifier === L.id) { L = null; touch.mx = touch.mz = 0; }
      if (R && t.identifier === R.id) R = null;
    }
  });
  const hold = (id, on, off) => { $(id).addEventListener('touchstart', (e) => { e.preventDefault(); on(); }); $(id).addEventListener('touchend', off); };
  hold('bfire', () => (fire = true), () => (fire = false));
  hold('bjump', () => (touch.jump = true), () => (touch.jump = false));
  hold('bview', () => (me.third = !me.third), () => {});
}

$('name').value = localStorage.getItem('pname') || '';
$('play').onclick = () => {
  const name = $('name').value.trim() || 'Jogador';
  localStorage.setItem('pname', name);
  if (!net.joined) net.connect(name, 'default');
  playing = true;
  $('menu').style.display = 'none';
  if (!isTouch) renderer.domElement.requestPointerLock();
};

// ---------- física ----------
const RAD = 0.4;
function step(dt, now) {
  const sprint = keys.ShiftLeft;
  const sp = sprint ? 8 : 5;
  let fx = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touch.mz;
  let rx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.mx;
  const len = Math.hypot(fx, rx);
  if (len > 1) { fx /= len; rx /= len; }
  const s = Math.sin(me.yaw), c = Math.cos(me.yaw);
  me.pos.x += (-s * fx + c * rx) * sp * dt;
  me.pos.z += (-c * fx - s * rx) * sp * dt;
  me.vy -= 22 * dt;
  me.pos.y += me.vy * dt;

  let gy = 0;
  for (const b of boxes) {
    const inX = Math.abs(me.pos.x - b.x) < b.w / 2 + 0.2, inZ = Math.abs(me.pos.z - b.z) < b.d / 2 + 0.2;
    if (inX && inZ && me.pos.y >= b.h - 0.35) gy = Math.max(gy, b.h);
  }
  for (const b of boxes) {
    if (me.pos.y >= b.h - 0.35) continue;
    const cx = clamp(me.pos.x, b.x - b.w / 2, b.x + b.w / 2), cz = clamp(me.pos.z, b.z - b.d / 2, b.z + b.d / 2);
    const dx = me.pos.x - cx, dz = me.pos.z - cz, d = Math.hypot(dx, dz);
    if (d < RAD) {
      if (d > 1e-4) { me.pos.x += (dx / d) * (RAD - d); me.pos.z += (dz / d) * (RAD - d); }
      else me.pos.x += RAD;
    }
  }
  if (me.pos.y <= gy && me.vy <= 0) { me.pos.y = gy; me.vy = 0; me.ground = true; } else me.ground = false;
  if ((keys.Space || touch.jump) && me.ground) { me.vy = 7.5; me.ground = false; }
  me.pos.x = clamp(me.pos.x, -195, 195); me.pos.z = clamp(me.pos.z, -195, 195);

  let a = !me.ground ? 'jump' : len > 0.1 ? (sprint ? 'run' : 'walk') : 'idle';
  if (me.oneShot) { if (now < me.oneShot.until) a = me.oneShot.name; else me.oneShot = null; }
  me.anim = a;

  if (fire && now - lastShot > 100) {
    lastShot = now;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    net.send({ t: 'shoot', o: camera.position.toArray(), d: f.toArray() });
  }
}

// ---------- loop ----------
let last = performance.now(), lastSend = 0, frames = 0, fpsAt = last;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (playing) step(dt, now);

  camera.rotation.set(me.pitch, me.yaw, 0);
  const head = new THREE.Vector3(me.pos.x, me.pos.y + 1.6, me.pos.z);
  if (me.third) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.copy(head).addScaledVector(f, -3.2).add(new THREE.Vector3(0, 0.3, 0));
  } else camera.position.copy(head);
  gun.visible = !me.third;
  me.avatar.root.visible = me.third;
  me.avatar.root.position.copy(me.pos);
  me.avatar.setYaw(me.yaw);
  me.avatar.play(me.anim);
  me.avatar.update(dt);

  const k = 1 - Math.exp(-15 * dt);
  for (const r of remotes.values()) {
    r.avatar.root.position.lerp(r.target, k);
    let d = r.ty - (r.cy ?? r.ty);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.cy = (r.cy ?? r.ty) + d * k;
    r.avatar.setYaw(r.cy);
    r.avatar.play(r.anim);
    r.avatar.update(dt);
  }

  if (playing && now - lastSend > 33) {
    lastSend = now;
    net.send({ t: 'move', x: me.pos.x, y: me.pos.y, z: me.pos.z, r: me.yaw, a: me.anim });
  }
  mc.frame(dt, now / 1000);
  renderer.render(scene, camera);
  frames++;
  if (now - fpsAt > 500) { $('fps').textContent = Math.round((frames * 1000) / (now - fpsAt)) + ' fps'; frames = 0; fpsAt = now; }
}
requestAnimationFrame(loop);

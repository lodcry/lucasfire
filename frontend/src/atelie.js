import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadModel } from './avatar.js';
import { API } from '../config.js';

const $ = (id) => document.getElementById(id);
const msg = (t, bad) => { $('msg').style.color = bad ? '#f77' : '#7f7'; $('msg').textContent = t; };
let token = localStorage.getItem('token') || '';
$('who').textContent = token ? '✔ logado' : '';

// ---------- viewer ----------
const holder = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
holder.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e12);
const cam = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
cam.position.set(2, 1.6, 3);
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(0, 0.9, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.4), new THREE.GridHelper(10, 20, 0x335, 0x223));
const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(3, 6, 4); scene.add(dl);
const helpers = new THREE.Group(); scene.add(helpers);
function resize() { const w = holder.clientWidth, h = holder.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let model = null, mixer = null, clips = [], file = null, rawH = 1, curAction = null;
const state = { clips: {}, binds: {}, hitboxes: [], hands: {} };
const BASE = ['idle', 'walk', 'run', 'jump', 'shoot', 'reload', 'die'];
const clock = new THREE.Clock();
(function tick() { requestAnimationFrame(tick); mixer?.update(clock.getDelta()); controls.update(); renderer.render(scene, cam); })();

// ---------- login ----------
$('login').onclick = async () => {
  const r = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('user').value, password: $('pass').value }) });
  const j = await r.json();
  if (j.token) { token = j.token; localStorage.setItem('token', token); $('who').textContent = '✔ logado'; msg('Login ok'); loadExisting(); }
  else msg(j.error || 'falha no login', true);
};

// ---------- carregar modelo ----------
async function showModel(url, ext) {
  if (model) scene.remove(model);
  mixer = null;
  const g = await loadModel(url, ext);
  model = g.scene;
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(model);
  rawH = b0.max.y - b0.min.y;
  scene.add(model);
  clips = g.animations;
  mixer = new THREE.AnimationMixer(model);
  return g;
}
function applyScale() {
  if (!model) return;
  model.scale.setScalar(+$('scale').value || 1);
  model.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(model);
  model.position.y -= b.min.y;
  model.updateMatrixWorld(true);
  drawHB();
}
function renderClips() {
  const box = $('clips');
  box.innerHTML = clips.length ? '' : 'Nenhum clipe neste modelo.';
  clips.forEach((c) => {
    const d = document.createElement('div'); d.className = 'row';
    d.innerHTML = `<b>${c.name}</b> <span style="opacity:.6">${c.duration.toFixed(2)}s</span>`;
    const b = document.createElement('button'); b.className = 's'; b.textContent = '▶'; b.onclick = () => playClip(c.name);
    d.appendChild(b); box.appendChild(d);
  });
  renderActs();
}
function playClip(name) {
  const clip = clips.find((c) => c.name === name);
  if (!clip || !mixer) return;
  mixer.stopAllAction();
  curAction = mixer.clipAction(clip); curAction.reset().play();
}
function renderActs() {
  const t = $('acts'); t.innerHTML = '';
  const names = [...new Set([...BASE, ...Object.keys(state.clips)])];
  for (const act of names) {
    const tr = document.createElement('tr');
    const opts = ['<option value="">—</option>', ...clips.map((c) => `<option ${state.clips[act] === c.name ? 'selected' : ''}>${c.name}</option>`)].join('');
    tr.innerHTML = `<td><b>${act}</b></td><td><select>${opts}</select></td><td><input maxlength="1" size="1" placeholder="tecla" value="${state.binds[act] || ''}" style="width:50px"></td><td><button class="s">▶</button></td>`;
    const [sel, key] = tr.querySelectorAll('select,input');
    sel.onchange = () => { sel.value ? (state.clips[act] = sel.value) : delete state.clips[act]; };
    key.oninput = () => { key.value ? (state.binds[act] = key.value.toLowerCase()) : delete state.binds[act]; };
    tr.querySelector('button').onclick = () => sel.value && playClip(sel.value);
    t.appendChild(tr);
  }
}
$('addact').onclick = () => { const n = prompt('Nome da ação (ex: dance, wave, granada)'); if (n && /^\w{1,20}$/.test(n)) { state.clips[n] = state.clips[n] || ''; renderActs(); } };
$('auto').onclick = () => {
  const re = { idle: /idle|stand/i, walk: /walk/i, run: /run|sprint|jog/i, jump: /jump/i, shoot: /shoot|fire/i, reload: /reload/i, die: /die|death|dead/i };
  for (const [a, r] of Object.entries(re)) { const c = clips.find((x) => r.test(x.name)); if (c) state.clips[a] = c.name; }
  renderActs();
};

// ---------- hitboxes ----------
function genHB() {
  if (!model) return;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const H = box.max.y - box.min.y, base = box.min.y;
  const find = (re) => { let r = null; model.traverse((o) => { if (o.isBone && !r && re.test(o.name)) r = o; }); return r; };
  const yOf = (o) => { const v = new THREE.Vector3(); o.getWorldPosition(v); return v.y - base; };
  const head = find(/head/i), neck = find(/neck/i), hips = find(/hips|pelvis/i);
  const hy = head ? yOf(head) : H * 0.88, ny = neck ? yOf(neck) : H * 0.82, py = hips ? yOf(hips) : H * 0.5;
  const f = (n) => +n.toFixed(3);
  state.hitboxes = [
    { part: 'head', y0: f(hy - H * 0.02), y1: f(H), r: f(H * 0.07), mult: 3 },
    { part: 'torso', y0: f(py - H * 0.02), y1: f(ny), r: f(H * 0.14), mult: 1 },
    { part: 'legs', y0: 0, y1: f(py - H * 0.02), r: f(H * 0.09), mult: 0.7 },
  ];
  const lh = find(/left.?hand|hand[_.]?l\b/i), rh = find(/right.?hand|hand[_.]?r\b/i);
  state.hands = { left: lh?.name || null, right: rh?.name || null };
  $('hands').textContent = `mãos: ${state.hands.left || '?'} / ${state.hands.right || '?'}  ·  ${model.getObjectByProperty('isBone', true) ? 'esqueleto ok' : 'sem esqueleto (ajuste manual)'}`;
  renderHB(); drawHB();
}
$('genhb').onclick = genHB;
function renderHB() {
  const t = $('hbs'); t.innerHTML = '<tr><td>parte</td><td>y0</td><td>y1</td><td>raio</td><td>×dano</td></tr>';
  state.hitboxes.forEach((h) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input value="${h.part}" style="width:70px"></td>` + ['y0', 'y1', 'r', 'mult'].map((k) => `<td><input type="number" step="0.01" value="${h[k]}"></td>`).join('');
    const ins = tr.querySelectorAll('input');
    ins[0].oninput = () => { h.part = ins[0].value; };
    ['y0', 'y1', 'r', 'mult'].forEach((k, i) => (ins[i + 1].oninput = () => { h[k] = +ins[i + 1].value; drawHB(); }));
    t.appendChild(tr);
  });
}
function drawHB() {
  helpers.clear();
  const colors = { head: 0xff4444, torso: 0xffcc33, legs: 0x44aaff };
  state.hitboxes.forEach((h) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, Math.max(h.y1 - h.y0, 0.01), 12), new THREE.MeshBasicMaterial({ color: colors[h.part] || 0x66ff66, wireframe: true }));
    m.position.y = (h.y0 + h.y1) / 2;
    helpers.add(m);
  });
}

// ---------- arquivo / existentes ----------
$('scale').oninput = applyScale;
$('file').onchange = async (e) => {
  file = e.target.files[0];
  if (!file) return;
  const ext = (file.name.match(/\.(glb|gltf|fbx)$/i) || [])[1];
  if (!ext) return msg('Formato não suportado', true);
  $('name').value ||= file.name.replace(/\.\w+$/, '').replace(/[^\w-]/g, '_').slice(0, 40);
  msg('Carregando…');
  try {
    await showModel(URL.createObjectURL(file), ext);
    $('scale').value = rawH > 50 ? 0.01 : 1;
    state.clips = {}; state.binds = {};
    applyScale(); renderClips(); genHB();
    msg(`Modelo ok: ${clips.length} clipes. Altura bruta ${rawH.toFixed(2)}.`);
  } catch (err) { msg('Erro ao carregar: ' + err.message, true); }
};
async function loadExisting() {
  try {
    const list = await (await fetch(API + '/api/assets')).json();
    const box = $('existing'); box.innerHTML = '';
    list.forEach((a) => {
      const b = document.createElement('button'); b.className = 's'; b.textContent = a.name;
      b.onclick = async () => {
        file = null; $('name').value = a.name; $('type').value = a.type;
        const m = a.manifest || {};
        $('scale').value = m.scale || 1; $('yaw').value = Math.round(((m.yawOffset || 0) * 180) / Math.PI);
        state.clips = { ...(m.clips || {}) }; state.binds = { ...(m.binds || {}) }; state.hitboxes = m.hitboxes || []; state.hands = m.hands || {};
        await showModel(a.url);
        applyScale(); renderClips(); renderHB(); drawHB();
        msg('Carregado ' + a.name);
      };
      box.appendChild(b);
    });
  } catch { $('existing').textContent = 'backend offline?'; }
}
loadExisting();

// ---------- salvar ----------
$('save').onclick = async () => {
  if (!token) return msg('Faça login primeiro', true);
  const name = $('name').value.trim();
  if (!/^[\w-]{1,40}$/.test(name)) return msg('Nome inválido', true);
  const clipsClean = Object.fromEntries(Object.entries(state.clips).filter(([, v]) => v));
  const manifest = { scale: +$('scale').value || 1, yawOffset: ((+$('yaw').value || 0) * Math.PI) / 180, clips: clipsClean, binds: state.binds, hitboxes: state.hitboxes, hands: state.hands };
  const fd = new FormData();
  if (file) fd.append('file', await toGlb(file));
  fd.append('name', name); fd.append('type', $('type').value); fd.append('manifest', JSON.stringify(manifest));
  msg('Enviando…');
  const r = await fetch(API + '/api/assets', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const j = await r.json();
  if (r.ok) { msg('Salvo! ' + (j.info ? JSON.stringify(j.info) : '')); file = null; loadExisting(); }
  else msg(j.error || 'erro', true);
};

import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
// FBX/GLTF viram GLB no navegador (com animações) antes do envio.
async function toGlb(f) {
  if (/\.glb$/i.test(f.name)) return f;
  if (!model) throw new Error('modelo não carregado');
  msg('Convertendo para GLB…');
  const s = model.scale.clone(), p = model.position.clone();
  model.scale.setScalar(1); model.position.set(0, 0, 0); model.updateMatrixWorld(true);
  const buf = await new GLTFExporter().parseAsync(model, { binary: true, animations: clips });
  model.scale.copy(s); model.position.copy(p); model.updateMatrixWorld(true);
  return new File([buf], f.name.replace(/\.\w+$/, '') + '.glb', { type: 'model/gltf-binary' });
}

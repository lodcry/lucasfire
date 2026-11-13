// Servidor de jogo autoritativo: posições, tiros, dano por parte do corpo.
const { WebSocketServer } = require('ws');
const db = require('./db');
const mods = require('./modloader');

const players = new Map();
let nextId = 1;
const weapons = { rifle: { damage: 25, rate: 0.1, range: 150 } };

function rng(s) { return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const R = rng(1337);
const boxes = [];
for (let i = 0; i < 40; i++) {
  const w = 2 + R() * 6, d = 2 + R() * 6, h = 1.5 + R() * 5;
  let x = (R() - 0.5) * 300, z = (R() - 0.5) * 300;
  if (Math.hypot(x, z) < 15) x += 25;
  boxes.push({ x: +x.toFixed(2), z: +z.toFixed(2), w: +w.toFixed(2), d: +d.toFixed(2), h: +h.toFixed(2) });
}

const defaultHB = [
  { part: 'head', y0: 1.5, y1: 1.8, r: 0.13, mult: 3 },
  { part: 'torso', y0: 0.9, y1: 1.5, r: 0.25, mult: 1 },
  { part: 'legs', y0: 0, y1: 0.9, r: 0.17, mult: 0.7 },
];
const hbCache = new Map();
async function hitboxesFor(name) {
  if (hbCache.has(name)) return hbCache.get(name);
  let hb = defaultHB;
  try {
    const a = await db.get().collection('assets').findOne({ name });
    if (a?.manifest?.hitboxes?.length) hb = a.manifest.hitboxes;
  } catch {}
  hbCache.set(name, hb);
  return hb;
}
const invalidate = (name) => hbCache.delete(name);

function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  return -b + s >= 0 ? 0 : null;
}
function rayHit(o, d, p, hbs) {
  let best = null;
  for (const h of hbs) {
    const step = Math.max(h.r * 0.8, 0.05);
    for (let y = h.y0; y <= h.y1 + 1e-6; y += step) {
      const t = raySphere(o, d, [p.x, p.y + y, p.z], h.r);
      if (t !== null && (!best || t < best.t)) best = { t, part: h.part, mult: h.mult ?? 1 };
    }
  }
  return best;
}
function rayBox(o, d, b) {
  const mn = [b.x - b.w / 2, 0, b.z - b.d / 2], mx = [b.x + b.w / 2, b.h, b.z + b.d / 2];
  let tmin = 0, tmax = 1e9;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; }
    else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

const send = (p, o) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const broadcast = (o) => { const s = JSON.stringify(o); for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
const spawn = () => ({ x: (Math.random() - 0.5) * 60, y: 0, z: (Math.random() - 0.5) * 60 });
const list = () => [...players.values()].map((p) => ({ id: p.id, name: p.name, hp: p.hp, x: p.x, y: p.y, z: p.z, kills: p.k, deaths: p.d }));
const find = (id) => players.get(Number(id));

function say(text) { broadcast({ t: 'chat', n: 'SERVIDOR', m: String(text).slice(0, 200) }); }
function teleport(id, x, y, z) {
  const p = find(id); if (!p) throw new Error('jogador não existe');
  p.x = +x; p.y = +y; p.z = +z; send(p, { t: 'tp', x: p.x, y: p.y, z: p.z });
}
function damage(id, amount, by, part) {
  const t = typeof id === 'object' ? id : find(id);
  if (!t || t.dead) return;
  t.hp = Math.max(0, t.hp - amount);
  broadcast({ t: 'hit', target: t.id, by: by?.id ?? 0, part: part || 'body', dmg: Math.round(amount) });
  if (t.hp <= 0) {
    t.dead = true; t.d++;
    if (by && by !== t) by.k++;
    broadcast({ t: 'kill', bn: by?.name || 'Mundo', tn: t.name });
    mods.emit('death', { target: t, killer: by });
    setTimeout(() => {
      t.hp = 100; t.dead = false;
      const s = spawn(); t.x = s.x; t.y = s.y; t.z = s.z;
      send(t, { t: 'tp', ...s });
    }, 3000);
  }
}

const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

async function shoot(p, m) {
  const w = weapons[p.weapon] || weapons.rifle;
  const now = Date.now();
  if (p.dead || now - p.lastShot < w.rate * 800) return;
  if (!isVec(m.o) || !isVec(m.d)) return;
  const len = Math.hypot(...m.d);
  if (len < 1e-6) return;
  const d = m.d.map((v) => v / len);
  const o = m.o;
  if (Math.hypot(o[0] - p.x, o[1] - (p.y + 1.6), o[2] - p.z) > 6) return;
  p.lastShot = now;
  let best = null, target = null;
  for (const q of players.values()) {
    if (q === p || q.dead) continue;
    const h = rayHit(o, d, q, await hitboxesFor(q.c));
    if (h && h.t <= w.range && (!best || h.t < best.t)) { best = h; target = q; }
  }
  let wall = 1e9;
  for (const b of boxes) { const t = rayBox(o, d, b); if (t !== null && t < wall) wall = t; }
  const reach = Math.min(best ? best.t : w.range, wall, w.range);
  broadcast({ t: 'shot', id: p.id, o, d, l: +reach.toFixed(2) });
  if (!best || best.t > wall) return;
  const c = { shooter: p, target, part: best.part, damage: w.damage * best.mult, weapon: p.weapon };
  mods.emit('shoot', c);
  if (c.cancel) return;
  damage(target, c.damage, p, best.part);
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536 });
  wss.on('connection', (ws) => {
    let p = null;
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'join' && !p) {
        const s = spawn();
        p = { id: nextId++, ws, name: String(m.name || 'Jogador').replace(/[^\w \-À-ú]/g, '').slice(0, 16) || 'Jogador',
          c: /^[\w-]{1,40}$/.test(m.character || '') ? m.character : 'default',
          x: s.x, y: 0, z: s.z, r: 0, a: 'idle', hp: 100, k: 0, d: 0, dead: false, lastShot: 0, lastMove: Date.now(), weapon: 'rifle' };
        players.set(p.id, p);
        send(p, { t: 'welcome', id: p.id, boxes, weapons, spawn: s });
        mods.emit('join', { player: p });
        return;
      }
      if (!p) return;
      if (m.t === 'move') {
        if (p.dead) return;
        const now = Date.now();
        const dt = Math.max((now - p.lastMove) / 1000, 0.016);
        if (![m.x, m.y, m.z, m.r].every(Number.isFinite)) return;
        if (Math.hypot(m.x - p.x, m.z - p.z) > 14 * dt + 1 || Math.abs(m.x) > 200 || Math.abs(m.z) > 200 || m.y < -5 || m.y > 80) {
          send(p, { t: 'tp', x: p.x, y: p.y, z: p.z }); return;
        }
        p.x = m.x; p.y = m.y; p.z = m.z; p.r = m.r; p.a = String(m.a || 'idle').slice(0, 30); p.lastMove = now;
      } else if (m.t === 'shoot') shoot(p, m);
      else if (m.t === 'chat') broadcast({ t: 'chat', n: p.name, m: String(m.m || '').slice(0, 120) });
    });
    ws.on('close', () => { if (p) { players.delete(p.id); mods.emit('leave', { player: p }); } });
    ws.on('error', () => {});
  });
  setInterval(() => {
    mods.emit('tick', { dt: 0.033, players: [...players.values()] });
    if (!players.size) return;
    broadcast({ t: 'snap', p: [...players.values()].map((q) => ({ id: q.id, n: q.name, c: q.c, x: q.x, y: q.y, z: q.z, r: q.r, a: q.a, hp: q.hp, k: q.k, d: q.d })) });
  }, 33);
}

module.exports = { attach, broadcast, list, say, damage, teleport, invalidate, weapons };

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

async function ensureAdmin() {
  const pw = (process.env.ADMIN_PASSWORD || '').trim();
  if (!pw) { console.warn('ADMIN_PASSWORD não definido: admin não criado'); return; }
  const users = db.get().collection('users');
  const ex = await users.findOne({ username: 'lucasbeats' });
  if (!ex) {
    await users.insertOne({ username: 'lucasbeats', hash: await bcrypt.hash(pw, 10), role: 'admin', createdAt: new Date() });
    console.log('Admin lucasbeats criado');
  } else if (!bcrypt.compareSync(pw, ex.hash)) {
    await users.updateOne({ username: 'lucasbeats' }, { $set: { hash: await bcrypt.hash(pw, 10) } });
    console.log('Senha do admin atualizada');
  }
}

const tries = new Map();
async function login(req, res) {
  const ip = req.ip;
  const t = tries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 15 * 60 * 1000) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 10) return res.status(429).json({ error: 'muitas tentativas, aguarde' });
  const { username, password } = req.body || {};
  const u = await db.get().collection('users').findOne({ username: String(username || '').trim().toLowerCase() });
  if (!u || !bcrypt.compareSync(String(password || '').trim(), u.hash)) {
    t.n++; tries.set(ip, t); console.log('login falhou: usuario=' + String(username || '').slice(0, 20) + ' existe=' + !!u);
    return res.status(401).json({ error: 'credenciais inválidas' });
  }
  const token = jwt.sign({ u: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
}

function requireAdmin(req, res, next) {
  try {
    const h = (req.headers.authorization || '').replace('Bearer ', '');
    const p = jwt.verify(h, process.env.JWT_SECRET);
    if (p.role !== 'admin') throw new Error('x');
    req.user = p;
    next();
  } catch { res.status(401).json({ error: 'não autorizado' }); }
}

module.exports = { ensureAdmin, login, requireAdmin };

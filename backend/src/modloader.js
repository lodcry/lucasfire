// Carrega "mods" do MongoDB e troca ao vivo, sem redeploy.
const vm = require('vm');
const db = require('./db');

const hooks = {};
const cache = new Map();
const errs = new Map();
const listeners = [];
let ctx = {};
const col = () => db.get().collection('mods');

const setContext = (c) => { ctx = c; };
const onChange = (f) => listeners.push(f);
const notify = (c) => listeners.forEach((f) => { try { f(c); } catch (e) { console.error(e); } });

function unhook(path) {
  for (const n in hooks) hooks[n] = hooks[n].filter((h) => h.path !== path);
}

function compile(mod) {
  const mine = [];
  const log = (...a) => console.log('[mod ' + mod.path + ']', ...a);
  const sb = {
    module: { exports: {} }, exports: {},
    console: { log, error: log },
    Math, JSON, Date, Number, String, Array, Object, Map, Set,
  };
  sb.api = {
    ...ctx,
    hook: (name, fn) => { if (typeof fn === 'function') mine.push({ path: mod.path, name, fn }); },
    data: (p) => { const m = cache.get(p); return m ? JSON.parse(m.content) : null; },
  };
  vm.createContext(sb);
  new vm.Script(mod.content, { filename: mod.path }).runInContext(sb, { timeout: 1000 });
  if (typeof sb.module.exports.init === 'function') sb.module.exports.init(sb.api);
  return mine;
}

function activate(mod) {
  let mine;
  try { mine = compile(mod); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  unhook(mod.path);
  for (const h of mine) (hooks[h.name] ||= []).push(h);
  errs.set(mod.path, 0);
  return { ok: true };
}

function emit(name, payload) {
  for (const h of [...(hooks[name] || [])]) {
    try { h.fn(payload); } catch (e) {
      console.error('[mod ' + h.path + '] erro em ' + name + ':', e.message);
      const n = (errs.get(h.path) || 0) + 1;
      errs.set(h.path, n);
      if (n >= 5) {
        unhook(h.path);
        console.error('módulo desativado, tentando rollback:', h.path);
        rollback(h.path).catch((er) => console.error('rollback falhou:', er.message));
      }
    }
  }
}

async function saveMod({ path, kind, content, author }) {
  if (typeof path !== 'string' || !/^[\w\-./]{1,120}$/.test(path) || path.includes('..')) throw new Error('caminho inválido');
  if (!['server', 'client', 'data'].includes(kind)) throw new Error('kind deve ser server, client ou data');
  if (typeof content !== 'string' || content.length > 500000) throw new Error('conteúdo inválido');
  const mod = { path, kind, content };
  if (kind === 'server') {
    const r = activate(mod);
    if (!r.ok) throw new Error('mod de servidor falhou: ' + r.error);
  } else {
    unhook(path);
    if (kind === 'data') JSON.parse(content);
  }
  const old = await col().findOne({ path });
  const version = (old?.version || 0) + 1;
  const history = [...(old?.history || []), ...(old ? [{ version: old.version, kind: old.kind, content: old.content, at: new Date() }] : [])].slice(-20);
  await col().updateOne({ path }, { $set: { path, kind, content, version, author: author || 'admin', updatedAt: new Date(), history } }, { upsert: true });
  cache.set(path, { ...mod, version });
  notify({ path, kind, version, content });
  return { path, kind, version };
}

async function deleteMod(path) {
  unhook(path);
  const old = await col().findOne({ path });
  if (!old) throw new Error('não existe');
  await col().deleteOne({ path });
  cache.delete(path);
  notify({ path, kind: old.kind, deleted: true });
  return { deleted: path };
}

async function rollback(path) {
  const m = await col().findOne({ path });
  if (!m) throw new Error('não existe');
  const prev = m.history?.[m.history.length - 1];
  if (!prev) { unhook(path); throw new Error('sem versão anterior (módulo desativado)'); }
  if (prev.kind === 'server') {
    const r = activate({ path, content: prev.content });
    if (!r.ok) throw new Error(r.error);
  } else unhook(path);
  const version = m.version + 1;
  await col().updateOne({ path }, { $set: { kind: prev.kind, content: prev.content, version, history: m.history.slice(0, -1), updatedAt: new Date() } });
  cache.set(path, { path, kind: prev.kind, content: prev.content, version });
  notify({ path, kind: prev.kind, version, content: prev.content });
  return { path, version, restoredFrom: prev.version };
}

async function loadAll() {
  const all = await col().find({}).toArray();
  for (const m of all) {
    cache.set(m.path, m);
    if (m.kind === 'server') {
      const r = activate(m);
      console.log('mod servidor', m.path, r.ok ? 'ok' : 'FALHOU: ' + r.error);
    }
  }
  console.log(all.length + ' mods carregados');
}

const list = () => col().find({}, { projection: { _id: 0, path: 1, kind: 1, version: 1, updatedAt: 1 } }).sort({ path: 1 }).toArray();
const read = async (path) => {
  const m = await col().findOne({ path }, { projection: { _id: 0, history: 0 } });
  if (!m) throw new Error('não existe');
  return m;
};
const clientMods = () => col().find({ kind: 'client' }, { projection: { _id: 0, path: 1, content: 1, version: 1 } }).sort({ path: 1 }).toArray();

module.exports = { setContext, onChange, emit, saveMod, deleteMod, rollback, loadAll, list, read, clientMods };

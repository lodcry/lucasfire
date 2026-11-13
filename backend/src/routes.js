const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { GridFSBucket, ObjectId } = require('mongodb');
const db = require('./db');
const auth = require('./auth');
const mods = require('./modloader');
const game = require('./game');
const { optimize, mb } = require('./optimize');

cloudinary.config({ secure: true });
const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });
const A = () => db.get().collection('assets');
const NAME = /^[\w-]{1,40}$/;
const wrap = (f) => async (q, s) => { try { await f(q, s); } catch (e) { s.status(400).json({ error: e.message }); } };
const bucket = () => new GridFSBucket(db.get(), { bucketName: 'models' });

function up(buf, publicId) {
  return new Promise((res, rej) =>
    cloudinary.uploader.upload_stream({ resource_type: 'raw', public_id: publicId, folder: 'lucasfps', overwrite: true },
      (e, x) => (e ? rej(e) : res(x))).end(buf));
}

// Cloudinary primeiro (até 9,5 MB). Se passar ou falhar, cai no MongoDB GridFS.
async function store(buf, base, req) {
  if (buf.length <= 9.5 * 1048576) {
    try { return { url: (await up(buf, base + '.glb')).secure_url, where: 'cloudinary' }; }
    catch (e) { console.error('cloudinary falhou, usando GridFS:', e.message); }
  }
  const id = new ObjectId();
  await new Promise((res, rej) => bucket().openUploadStreamWithId(id, base + '.glb').on('error', rej).on('finish', res).end(buf));
  const host = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return { url: `${host}/api/files/${id}.glb`, where: 'mongodb' };
}

r.post('/login', wrap(auth.login));

r.get('/files/:id', async (q, s) => {
  try {
    const id = new ObjectId(q.params.id.replace(/\.glb$/, ''));
    s.set({ 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=31536000, immutable' });
    bucket().openDownloadStream(id).on('error', () => s.sendStatus(404)).pipe(s);
  } catch { s.sendStatus(404); }
});

r.get('/assets', wrap(async (_q, s) => s.json(await A().find({}, { projection: { _id: 0 } }).toArray())));
r.get('/assets/:name', wrap(async (q, s) => {
  const a = await A().findOne({ name: q.params.name });
  if (!a) return s.sendStatus(404);
  s.json({ ...a.manifest, name: a.name, type: a.type, url: a.url });
}));

r.post('/assets', auth.requireAdmin, upload.single('file'), wrap(async (q, s) => {
  const { name, type } = q.body;
  if (!NAME.test(name || '')) throw new Error('nome inválido (letras, números, _ e -)');
  const manifest = JSON.parse(q.body.manifest || '{}');
  delete manifest.url;
  const old = await A().findOne({ name });
  let url = old?.url, info = null;
  if (q.file) {
    let buf = q.file.buffer;
    if (buf.subarray(0, 4).toString() !== 'glTF') throw new Error('envie .glb (FBX/GLTF o Ateliê converte antes de enviar)');
    try {
      const o = await optimize(buf);
      buf = o.buffer;
      info = { de: mb(o.from), para: mb(o.to), passos: o.steps };
    } catch (e) { console.error('otimização falhou:', e.message); info = { aviso: 'otimização falhou, enviado original' }; }
    if (buf.length > 40 * 1048576) throw new Error('mesmo otimizado tem ' + mb(buf.length) + ' (limite 40 MB). Reduza o modelo no Blender.');
    const st = await store(buf, `${name}-${Date.now()}`, q);
    url = st.url; info = { ...info, guardado: st.where };
  }
  if (!url) throw new Error('envie um arquivo');
  await A().updateOne({ name }, { $set: { name, type: type || 'character', url, manifest, updatedAt: new Date() } }, { upsert: true });
  game.invalidate(name);
  s.json({ ok: true, name, url, info });
}));

r.put('/assets/:name', auth.requireAdmin, wrap(async (q, s) => {
  const a = await A().findOne({ name: q.params.name });
  if (!a) return s.sendStatus(404);
  await A().updateOne({ name: a.name }, { $set: { manifest: { ...a.manifest, ...q.body }, updatedAt: new Date() } });
  game.invalidate(a.name);
  s.json({ ok: true });
}));

r.delete('/assets/:name', auth.requireAdmin, wrap(async (q, s) => {
  await A().deleteOne({ name: q.params.name });
  game.invalidate(q.params.name);
  s.json({ ok: true });
}));

r.get('/mods/client', wrap(async (_q, s) => s.json(await mods.clientMods())));
r.get('/mods', auth.requireAdmin, wrap(async (_q, s) => s.json(await mods.list())));
r.get('/mods/read', auth.requireAdmin, wrap(async (q, s) => s.json(await mods.read(String(q.query.path)))));
r.put('/mods', auth.requireAdmin, wrap(async (q, s) => s.json(await mods.saveMod({ ...q.body, author: q.user.u }))));
r.delete('/mods', auth.requireAdmin, wrap(async (q, s) => s.json(await mods.deleteMod(String(q.query.path)))));
r.post('/mods/rollback', auth.requireAdmin, wrap(async (q, s) => s.json(await mods.rollback(String(q.body.path)))));

r.use((e, _q, s, _n) => s.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'arquivo maior que 60 MB' : e.message }));
module.exports = r;

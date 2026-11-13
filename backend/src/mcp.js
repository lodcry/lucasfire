// MCP mínimo (JSON-RPC sobre HTTP) em POST /mcp. Auth: Bearer MCP_TOKEN.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const mods = require('./modloader');
const game = require('./game');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'MCP_PROMPT.md'), 'utf8');
const REMINDER = 'Lembrete: use só ferramentas deste MCP. Nunca reiniciar/deploy. Mudanças ao vivo.';
const r = express.Router();
const A = () => db.get().collection('assets');

const tools = {
  get_rules: { d: 'LEIA PRIMEIRO. Regras obrigatórias e API dos mods.', p: {}, f: () => RULES },
  server_status: { d: 'Uptime, memória, jogadores e quantidade de mods.', p: {}, f: async () => ({ uptimeSeg: Math.round(process.uptime()), memMB: Math.round(process.memoryUsage().rss / 1048576), jogadores: game.list().length, mods: (await mods.list()).length }) },
  list_mods: { d: 'Lista os módulos (path, kind, version).', p: {}, f: () => mods.list() },
  read_mod: { d: 'Lê um módulo inteiro.', p: { path: 'string' }, req: ['path'], f: (a) => mods.read(a.path) },
  write_mod: { d: 'Cria/atualiza módulo AO VIVO (sem reiniciar). kind: server | client | data. Leia get_rules antes.', p: { path: 'string', kind: 'string', content: 'string' }, req: ['path', 'kind', 'content'], f: (a) => mods.saveMod({ ...a, author: 'mcp' }) },
  delete_mod: { d: 'Apaga um módulo.', p: { path: 'string' }, req: ['path'], f: (a) => mods.deleteMod(a.path) },
  rollback_mod: { d: 'Volta o módulo para a versão anterior.', p: { path: 'string' }, req: ['path'], f: (a) => mods.rollback(a.path) },
  list_assets: { d: 'Lista assets (modelos 3D + manifestos).', p: {}, f: () => A().find({}, { projection: { _id: 0 } }).toArray() },
  get_asset: { d: 'Lê o manifesto de um asset.', p: { name: 'string' }, req: ['name'], f: async (a) => (await A().findOne({ name: a.name }, { projection: { _id: 0 } })) || { error: 'não existe' } },
  update_asset: { d: 'Mescla campos no manifesto (clips, binds, hitboxes, scale, yawOffset...).', p: { name: 'string', manifest: 'object' }, req: ['name', 'manifest'], f: async (a) => {
    const old = await A().findOne({ name: a.name });
    if (!old) throw new Error('não existe');
    await A().updateOne({ name: a.name }, { $set: { manifest: { ...old.manifest, ...a.manifest }, updatedAt: new Date() } });
    game.invalidate(a.name);
    return { ok: true };
  } },
  list_players: { d: 'Lista jogadores online.', p: {}, f: () => game.list() },
  say: { d: 'Mensagem do servidor para todos.', p: { text: 'string' }, req: ['text'], f: (a) => { game.say(a.text); return { ok: true }; } },
  damage: { d: 'Aplica dano a um jogador.', p: { id: 'number', amount: 'number' }, req: ['id', 'amount'], f: (a) => { game.damage(a.id, a.amount); return { ok: true }; } },
  teleport: { d: 'Teleporta um jogador.', p: { id: 'number', x: 'number', y: 'number', z: 'number' }, req: ['id', 'x', 'y', 'z'], f: (a) => { game.teleport(a.id, a.x, a.y, a.z); return { ok: true }; } },
};

const schema = (n, t) => ({
  name: n, description: t.d,
  inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(t.p).map(([k, v]) => [k, { type: v }])), required: t.req || [] },
});

function authed(req) {
  const tok = process.env.MCP_TOKEN;
  if (!tok) return false;
  const got = (req.headers.authorization || '').replace('Bearer ', '') || String(req.query.token || '');
  const a = Buffer.from(got), b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

r.get('/', (_q, s) => s.sendStatus(405));
r.post('/', async (req, res) => {
  if (!authed(req)) return res.status(401).json({ error: 'não autorizado' });
  const { id, method, params } = req.body || {};
  const ok = (result) => res.json({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return res.sendStatus(202);
  try {
    if (method === 'initialize') return ok({ protocolVersion: params?.protocolVersion || '2025-03-26', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'lucas-fps', version: '1.1.0' }, instructions: RULES });
    if (method === 'ping') return ok({});
    if (method === 'prompts/list') return ok({ prompts: [{ name: 'regras', description: 'Regras obrigatórias para operar o jogo' }] });
    if (method === 'prompts/get') return ok({ description: 'Regras', messages: [{ role: 'user', content: { type: 'text', text: RULES } }] });
    if (method === 'tools/list') return ok({ tools: Object.entries(tools).map(([n, t]) => schema(n, t)) });
    if (method === 'tools/call') {
      const t = tools[params?.name];
      if (!t) return fail(-32602, 'ferramenta desconhecida (não existe reiniciar/deploy)');
      try {
        const out = await t.f(params.arguments || {});
        return ok({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }, { type: 'text', text: REMINDER }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: String(e.message || e) }, { type: 'text', text: REMINDER }] });
      }
    }
    fail(-32601, 'método não suportado');
  } catch (e) { fail(-32603, String(e.message || e)); }
});

module.exports = r;

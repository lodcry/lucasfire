require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const db = require('./db');
const auth = require('./auth');
const mods = require('./modloader');
const game = require('./game');

(async () => {
  if (!process.env.JWT_SECRET || !process.env.MONGODB_URI) { console.error('Defina JWT_SECRET e MONGODB_URI'); process.exit(1); }
  await db.connect();
  await auth.ensureAdmin();

  const app = express();
  app.set('trust proxy', 1);
  const o = process.env.FRONTEND_ORIGIN;
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.get('/health', (_q, s) => s.json({ ok: true, t: Date.now() }));
  app.use('/api', require('./routes'));
  app.use('/mcp', require('./mcp'));

  const server = http.createServer(app);
  game.attach(server);
  mods.setContext({ weapons: game.weapons, players: game.list, broadcast: game.broadcast, say: game.say, damage: game.damage, teleport: game.teleport });
  mods.onChange((c) => { if (c.kind === 'client' || c.kind === 'data') game.broadcast({ t: 'mod', ...c }); });
  await mods.loadAll();

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log('Backend na porta ' + port));
})().catch((e) => { console.error(e); process.exit(1); });

const { MongoClient } = require('mongodb');
let db;
async function connect() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  db = c.db(process.env.DB_NAME || 'lucasfps');
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('mods').createIndex({ path: 1 }, { unique: true });
  await db.collection('assets').createIndex({ name: 1 }, { unique: true });
  console.log('MongoDB ok');
  return db;
}
module.exports = { connect, get: () => db };

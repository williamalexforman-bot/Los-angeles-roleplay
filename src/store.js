const { MongoClient } = require('mongodb');
let db;
async function connect() {
  let uri = process.env.MONGODB_URI;
  if (!uri && process.env.MONGODB_USERNAME && process.env.MONGODB_PASSWORD && process.env.MONGODB_HOST) {
    uri = `mongodb+srv://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${process.env.MONGODB_HOST}/?retryWrites=true&w=majority`;
  }
  if (!uri) throw new Error('Set MONGODB_URI or the existing MONGODB_USERNAME, MONGODB_PASSWORD, MONGODB_HOST environment values.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try { await client.connect(); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  // Separate collections preserve data belonging to the backed-up original bot.
  const connected = client.db(process.env.MONGODB_DATABASE || 'discordbot');
  try { await connected.collection('fresh_locks').createIndex({ expires: 1 }, { expireAfterSeconds: 0 }); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  db = connected;
}
function collection(name) {
  if (!db) throw new Error('The database is offline. No disciplinary changes were made. Ask an administrator to check MongoDB settings.');
  return db.collection(`fresh_${name}`);
}
async function locked(key, work) {
  const locks = collection('locks');
  const owner = require('node:crypto').randomUUID();
  try { await locks.insertOne({ _id: key, owner, expires: new Date(Date.now() + 600000) }); }
  catch (e) { if (e.code === 11000) throw new Error('Another action for this member is running. Please try again later.'); throw e; }
  const timer = setInterval(() => locks.updateOne({ _id: key, owner }, { $set: { expires: new Date(Date.now() + 600000) } }).catch(() => {}), 30000);
  try { return await work(); } finally { clearInterval(timer); await locks.deleteOne({ _id: key, owner }); }
}
module.exports = { connect, collection, locked };

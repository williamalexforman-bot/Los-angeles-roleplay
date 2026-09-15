async function runTask(name, work) {
  try { await work(); }
  catch (error) { console.error(`${name} failed:`, error.code || error.name); }
}
async function startTask(name, work, interval) {
  await runTask(name, work);
  return setInterval(() => { void runTask(name, work); }, interval);
}
module.exports = { runTask, startTask };

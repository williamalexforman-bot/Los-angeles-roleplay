async function runTask(name, work) {
  try { await work(); }
  catch (error) { console.error(`${name} failed:`, error.code || error.name); }
}
async function startTask(name, work, interval) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runTask(name, work); } finally { running = false; }
  };
  await tick();
  return setInterval(() => { void tick(); }, interval);
}
module.exports = { runTask, startTask };

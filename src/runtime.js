function errorDetails(error){return {errorType:error?.name||typeof error,errorCode:error?.code||null,message:String(error?.message||error||'Unknown error').slice(0,1000),stack:error?.stack?.split('\n').slice(0,6).join('\n')||null};}
async function runTask(name, work) {
  try { await work(); }
  catch (error) { console.error(JSON.stringify({event:'task_failed',task:name,at:new Date().toISOString(),...errorDetails(error)})); }
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
module.exports = { runTask, startTask, errorDetails };

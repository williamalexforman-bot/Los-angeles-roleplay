async function lookupUsername(username, request = fetch) {
  username = username.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Enter a Roblox username, not a display name or profile URL.');
  let response;
  try {
    response = await request('https://users.roblox.com/v1/usernames/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new Error('Roblox lookup timed out or could not connect. Try again shortly.'); }
  if (response.status === 429) throw new Error('Roblox is rate limiting lookups. Try again shortly.');
  if (!response.ok) throw new Error('Roblox lookup is unavailable. Try again shortly.');
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Roblox returned an unreadable response. Try again shortly.'); }
  const account = result.data?.[0];
  if (!account) throw new Error('No Roblox account was found with that username. Check the spelling.');
  if (!Number.isSafeInteger(account.id) || account.id <= 0 || !/^[A-Za-z0-9_]{3,20}$/.test(account.name || '')) throw new Error('Roblox returned an invalid account. Try again shortly.');
  return account;
}
module.exports = { lookupUsername };

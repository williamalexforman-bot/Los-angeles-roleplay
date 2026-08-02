# TODO — LOA Improvements

## 1. ✅ `/loa` Command — replaced `setup`/`status` subcommands with `request` only
- [x] `/loa request` — opens the LOA request modal directly (no separate management-only setup panel)
- [x] `/loa setup` and `/loa status` removed from command definition

## 2. ✅ Role Assignment — automatic on approval
- [x] Assign role `1521593407795888329` to the member when an LOA is approved
- [x] Log success/failure and reflect it in the staff confirmation message
- [x] Auto-remove the role when the LOA end date passes (timer-based)

## 3. ✅ Privacy — delete original request on review
- [x] Track the pending request channel + message ID after posting
- [x] Delete the original request message (with its private reason) when approved or denied
- [x] Post a clean confirmation embed without the private reason

## 4. ✅ Verified
- [x] `npm run build` passes
- [x] `npm test` passes (44 commands)
- [x] Bot restarted, logged in, and registered 44 guild slash commands
- [x] Push to GitHub

---

# Custom Status — "Watching [member count] members"

## 1. ✅ Presence Update Logic
- [x] `updateMemberCountPresence(client)` helper in `src/events/ready.ts`
- [x] Uses `client.user.setActivity(\`${memberCount} members\`, { type: ActivityType.Watching })`
- [x] Refreshes via `client.guilds.fetch()` so the count stays accurate without the Server Members Intent

## 2. ✅ Background Refresh — every 5 minutes
- [x] `setInterval(..., 5 * 60 * 1000)` scheduled in `onReady`
- [x] Runs once immediately on `onReady` so the status appears at startup
- [x] Clears any prior timer on reconnect so intervals never stack

## 3. ✅ Verified
- [x] `npm run build` passes


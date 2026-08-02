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


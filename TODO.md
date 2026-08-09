# Task To-Do

## A. Fix LOA "unavailable" error
- [x] Add LOA_REQUEST_CHANNEL_ID and LOA_ROLE_ID to .env (explicit config)
- [x] Improve LOA channel error message to guide permission fix
- [x] Restrict /loa request to the LOA requester role (1521593407791825036) or Administrator

## B. Fix /rename so any channel can be renamed
- [x] Verify rename.ts is correct (allows any manageable channel)
- [x] Rebuild dist/ so the running bot picks up the new rename command

## C. Fully remove all ticket commands/functionality
- [x] Clean tests/smoke.ts: remove ticket imports and ticket test blocks
- [x] Clean README.md: remove ticket/verify/bloxlink references
- [x] Verify no remaining ticket references in src/

## D. Rebuild & restart
- [x] npm run build
- [x] Restart the bot so all changes take effect

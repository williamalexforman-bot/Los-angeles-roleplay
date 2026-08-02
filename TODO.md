# TODO — LOA System, Activity Check Fix & Infraction Rename

## 1. ✅ Activity Check — In-Memory Fallback
- [x] Add in-memory Map store for activity checks when MongoDB is down
- [x] Button handler works with in-memory data when DB unavailable

## 2. ✅ Infraction — Rename `rule-broken` to `notes`
- [x] Change option `rule-broken` → `notes` in command definition
- [x] Change `getString('rule-broken')` → `getString('notes')`
- [x] Update internal field usage/labels

## 3. ✅ LOA System — New `/loa` command
- [x] Create `src/commands/loa.ts`
- [x] `/loa setup` — posts LOA request panel (embed + red button)
- [x] Button → modal (name, start date, end date, reason)
- [x] Modal submit → sends request to channel 1528206019237515344 with approve/deny buttons
- [x] Approve — DM user, post confirmation embed, assign role 1521593407795888329
- [x] Deny — DM user
- [x] Auto-remove role when end date passes
- [x] Empty in-memory state cleanup

## 4. ✅ Wire Up
- [x] Register `loaCommand` in `registry.ts`
- [x] Add LOA button/modal handlers to `interactionCreate.ts`

## 5. ✅ Tests & Build
- [x] Update smoke tests for `notes` rename
- [x] Add LOA smoke tests
- [x] `npm run build` passes
- [x] `npm test` passes

## 6. ✅ Push to GitHub
- [ ] Commit and push to `origin/main`


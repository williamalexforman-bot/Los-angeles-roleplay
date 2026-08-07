# Session Embed Banner Binding Fix

## Root Cause
- `createSessionAttachments()` pushed the top banner as a **standalone message attachment**, so Discord rendered it as a separate chat image OUTSIDE the embed box.
- The banner must be bound ONLY inside the main embed via `.setImage()`.

## Tasks
- [x] 1. `embeds.ts`: Remove the standalone top-banner attachment from `createSessionAttachments()` — attach ONLY the underbanner there. This prevents the banner from being dropped outside the embed.
- [x] 2. `embeds.ts`: Confirmed `createSessionEmbed()` calls `.setImage(resolveTopBannerUrl(emblemType))` and `createUnderbannerEmbed()` calls `.setImage(BOTTOM_UNDERBANNER)`.
- [x] 3. `sessions.ts`: Verified all session payloads send `embeds: [mainEmbed, underbannerEmbed]` in the correct order (no standalone images).
- [x] 4. Rebuilt (`npm run build`) and restarted the bot via PM2 — bot online.

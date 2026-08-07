# Session Emblem Layout — Single Combined Banner Inside Embed

## Goal (final)
The top banner + underbanner are composited into ONE image that sits INSIDE the embed (orange-bordered card), big and full-width. Nothing is pushed outside the emblem.

## Tasks
- [x] 1. `build_combined_banners.js`: New script that composites [TOP banner] + [warm gap] + [underbanner] into one `session-*-combo.png` (1600x550, 2.91:1) per session type.
- [x] 2. Generated `assets/session-{start,end,vote,boost,full}-combo.png`.
- [x] 3. `embeds.ts`: Point `SESSION_BANNER_NAME_*` at the `*-combo.png` files; `createSessionEmbed()` uses `.setImage(resolveTopBannerUrl(...))` so the combined emblem renders inside the embed.
- [x] 4. `embeds.ts`: `createSessionAttachments()` attaches only the single combo banner (underbanner now baked in).
- [x] 5. `sessions.ts`: Use single-embed layout in `postSessionAnnouncement()` and `session-vote`; `handleSessionVoteButton()` edits with the single combined-banner embed.
- [x] 6. Accent color `#FF7A00` (`SESSION_ACCENT_COLOR = 0xff7a00`) for all session types.
- [x] 7. Type-check (`npm run build`).

# ERLC Utility Bot — Command List

> **Total Commands:** 12 | **Prefix-only:** 1 | **Slash-only:** 3 | **Both:** 8

---

## DM
Sends a direct message to a specified user.
**Role:** Management

| Type | Command |
|------|---------|
| Prefix | `!dm` |
| Slash | `/dm` |

No subcommands.

---

## ERLC
Queries Roblox ERLC server information and game data.
**Role:** Staff

| Type | Aliases |
|------|---------|
| Prefix | `!erlc`, `!server`, `!players`, `!joinlogs`, `!killlogs`, `!cmdlogs`, `!bans`, `!vehicles`, `!queue`, `!robloxcmd` |
| Slash | `/erlc` |

| Subcommand | Description |
|------------|-------------|
| `server` / `serverinfo` | Get server information |
| `players` | Get online players list |
| `joinlogs` | Get join/leave logs |
| `killlogs` | Get kill logs |
| `commandlogs` / `cmdlogs` | Get command logs |
| `bans` | Get server bans |
| `vehicles` | Get server vehicles |
| `queue` | Get server queue |
| `command` *(slash only)* | Execute an in-game command |

---

## Giveaway
Manages giveaways with button-based entry and random winner selection.
**Role:** Management

| Type | Aliases |
|------|---------|
| Prefix | `!giveaway`, `!gstart`, `!gend`, `!greroll` |
| Slash | `/giveaway` |

| Subcommand | Description |
|------------|-------------|
| `start` / `gstart` | Start a new giveaway |
| `end` / `gend` | End a giveaway early |
| `reroll` / `greroll` | Reroll a giveaway winner |

---

## Infraction
Tracks moderation infractions (warnings, strikes, mutes, bans) for users.
**Role:** Management

| Type | Aliases |
|------|---------|
| Prefix | `!infraction`, `!warn`, `!strike` |
| Slash | `/infraction` |

| Subcommand | Description |
|------------|-------------|
| `add` | Add an infraction to a user (type: Warning/Strike/Mute/Ban) |
| `remove` | Remove an infraction by ID |
| `list` | List all infractions for a user |

---

## Member Count
Displays server member statistics (total, humans, bots).
**Role:** None

| Type | Aliases |
|------|---------|
| Prefix | `!membercount`, `!members`, `!mc` |
| Slash | `/membercount` |

No subcommands.

---

## Ping
Returns bot latency and API ping.
**Role:** None

| Type | Command |
|------|---------|
| Prefix | `!ping` |

No subcommands. *(Prefix only)*

---

## Promotion
Tracks user promotions and rank changes with history.
**Role:** Management

| Type | Aliases |
|------|---------|
| Prefix | `!promotion`, `!promote` |
| Slash | `/promotion` |

| Subcommand | Description |
|------------|-------------|
| `add` | Promote a user (old rank → new rank) |
| `history` | View promotion history for a user |

---

## Session
Manages server session announcements (startup/shutdown) and voting.
**Role:** Staff

| Type | Aliases |
|------|---------|
| Prefix | `!session`, `!ssu`, `!ssd`, `!ssuvote` |
| Slash | `/session` |

| Subcommand | Description |
|------------|-------------|
| `ssu` | Server Startup announcement |
| `ssd` | Server Shutdown announcement |
| `vote` / `ssuvote` | Start an SSU vote |

---

## Suggestion
Submits a user suggestion to the suggestion channel.
**Role:** None

| Type | Aliases |
|------|---------|
| Prefix | `!suggestion`, `!suggest` |
| Slash | `/suggestion` |

No subcommands.

---

## Embed
Creates a custom embed via a modal form (title, description, color, footer, thumbnail).
**Role:** Staff

| Type | Command |
|------|---------|
| Slash | `/embed` |

No subcommands. *(Slash only)*

---

## Review
Submits a 1–5 star review to the review channel.
**Role:** None

| Type | Command |
|------|---------|
| Slash | `/review` |

No subcommands. *(Slash only)*

---

## Ticket
Support ticket system with button-based creation, transcripts, and logging.
**Role:** Management (setup) / Anyone (create via button)

| Type | Command |
|------|---------|
| Slash | `/ticket` |

| Subcommand | Description |
|------------|-------------|
| `setup` | Setup the ticket panel in the current channel |
| `close` | Close the current ticket and generate a transcript |

*(Slash only)*

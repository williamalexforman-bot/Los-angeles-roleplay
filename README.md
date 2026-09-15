# ERLC Utility Bot (v1.0.0)

[![GitHub License](https://img.shields.io/github/license/SEJED-DEV/ERLC-UTILITY-BOT?color=blue)](https://github.com/SEJED-DEV/ERLC-UTILITY-BOT/blob/main/LICENSE.md)
[![GitHub Repo Size](https://img.shields.io/github/repo-size/SEJED-DEV/ERLC-UTILITY-BOT?color=blue)](https://github.com/SEJED-DEV/ERLC-UTILITY-BOT)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/SEJED-DEV/ERLC-UTILITY-BOT?color=blue)](https://github.com/SEJED-DEV/ERLC-UTILITY-BOT)
[![Discord Support](https://img.shields.io/badge/Discord-Support-7289DA?logo=discord&logoColor=white)](https://discord.gg/zYvqDB5MWB)

A professional, enterprise-grade Discord bot designed for ER:LC Private Servers. Built with modularity, security, and the latest **ERLC API V2** at its core.

---

## 🎧 Support & Community

Need real-time assistance or want to join the community?
**[Join our Discord Support Server](https://discord.gg/zYvqDB5MWB)**

---

## ✨ Features

- **🚀 ERLC API V2 (Optimized)**: Real-time status, postal location tracking, wanted-star detection, and vehicle plate lookups—all via a single-endpoint polling system for maximum efficiency.
- **🛡️ Secure Persistence**: High-performance local SQLite database (`better-sqlite3`) ensures your data stays on your machine, not in the cloud.
- **⚙️ Dynamic Management**: A powerful `/config` command system allows owners to update API keys, channel IDs, and role permissions without reboots.
- **👔 Executive Branding**: High-fidelity embeds, auto-updating SSU counters, and professional console logging.
- **🎫 Feature Suite**: Advanced Ticket transcripts, Button-based Giveaways, and comprehensive forensic logging.

---

## 🛠️ Quick Start

### 1. Requirements
- Node.js 18.x or higher
- An ER:LC Private Server API Key

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/SEJED-DEV/ERLC-UTILITY-BOT
cd ERLC-UTILITY-BOT

# Install dependencies
npm install
```

### 3. Configuration
Rename `.env.example` to `.env` and enter your IDs. The rest can be configured via `/config` once the bot is live.

#### Environment Variables

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application client ID |
| `GUILD_ID` | Discord server (guild) ID |
| `ERLC_SERVER_KEY` | Your ER:LC API server key |
| `SERVER_OWNER_ID` | Discord user ID of the server owner |
| `PREFIX` | Custom command prefix (e.g. `!`) |
| `TICKET_ROLE_GENERAL` | Role ID(s) for general ticket access (comma-separated) |
| `TICKET_ROLE_MANAGEMENT` | Role ID(s) for management ticket access |
| `TICKET_ROLE_OWNERSHIP` | Role ID(s) for ownership ticket access |
| `TICKET_SUPPORT_ROLE_ID` | Fallback role ID for tickets |
| `TICKET_CATEGORY_ID` | Discord category channel ID for ticket channels |
| `TICKET_LOG_CHANNEL_ID` | Channel ID for ticket close logs |
| `ERLC_JOINLOGS_CHANNEL_ID` | Channel ID for join/leave log messages |
| `ERLC_KILLLOGS_CHANNEL_ID` | Channel ID for kill log messages |
| `ERLC_CMDLOGS_CHANNEL_ID` | Channel ID for command log messages |
| `ERLC_POLL_INTERVAL` | Polling interval in seconds (min 30) |
| `GIVEAWAY_CHANNEL_ID` | Channel ID for giveaways |
| `SESSION_CHANNEL_ID` | Channel ID for session announcements |
| `SESSION_ROLE_ID` | Role ID to ping for sessions |
| `QUICK_JOIN_LINK` | Roblox quick-join URL |
| `SSU_VOTE_THRESHOLD` | Number of votes needed (default: 5) |
| `SSU_VOTE_DURATION` | Vote duration in minutes (default: 5) |
| `STAFF_ROLE_ID` | Staff role ID (for session permissions) |
| `MANAGEMENT_ROLE_ID` | Management role ID (for giveaways, ticket close) |

### 4. Launch
```bash
npm start
```

---

## 📦 Project Structure

```text
src/
├── commands/     # Slash & Prefix commands
├── events/       # Discord event listeners
├── handlers/     # Loaders (Command, Slash, Events)
└── utils/        # Core Utilities (DB, API, Security, Branding)
database.db       # Local SQLite storage
```

## 📜 Credits & License
Maintained and authored by **SEJED-DEV**.
-   **License**: [MIT License](LICENSE.md) (Free for use with attribution).
-   **Attribution**: Maintain the `/credits` and `/support` commands visible.

---

© 2026 SEJED-DEV. All Rights Reserved.

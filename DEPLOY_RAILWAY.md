# 🚄 Deploy to Railway.app or Render — 24/7 Free Cloud Hosting

This guide will get your bot running 24/7 in the cloud so you don't need your Mac on.

---

## Step 1: Create a GitHub Repository

1. Go to https://github.com/new
2. Name it `csrp-bot` or whatever you like
3. Click **Create repository**
4. In your terminal, run:

```bash
cd "/Users/williamforman/Downloads/CSRP Bot/discord-management-bot"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## Option A: Deploy on Railway

1. Go to https://railway.app
2. Click **Login with GitHub**
3. Click **New Project** → **Deploy from GitHub repo**
4. Select the repo you just pushed
5. Railway will automatically build and deploy using `railway.json`

**Add Environment Variables:**
1. In Railway dashboard, go to your project
2. Click **Variables** tab
3. Add **ALL** the variables from your `.env` file
4. Click **Deploy**

**Useful Railway Commands:**
- **View logs:** Railway dashboard → Deployments → View Logs
- **Restart:** Click Restart button in the dashboard
- **Webhook URL:** `https://your-project.up.railway.app`

---

## Option B: Deploy on Render

1. Go to https://render.com
2. Click **Login with GitHub**
3. Click **New Blueprint** → select your repo
4. Render automatically reads `render.yaml` to configure the service

**Add Environment Variables:**
1. In Render dashboard, go to your service → **Environment** tab
2. Add **ALL** the variables from your `.env` file:
   - `BOT_TOKEN` — Your Discord bot token
   - `MONGODB_URI` — Your MongoDB connection string
   - `ENABLE_PRIVILEGED_INTENTS` — `true`
   - `WEBHOOK_SECRET` — A random secret string for legacy webhooks (optional)
   - All channel/role IDs from your `.env`
3. Click **Save Changes** — the service will redeploy automatically

**Webhook URL:** `https://YOUR-APP-NAME.onrender.com`

---

## 🔴 CRITICAL: Keep the Bot Awake (Both Platforms)

Both Railway (free tier) and Render (free tier) **spin down your service after 15 minutes of no HTTP traffic**. Since the bot's web server only receives traffic when ER:LC sends a webhook, it will go to sleep without a ping.

**Fix: Use a free uptime monitor**

1. Go to https://uptimerobot.com and sign up (free)
2. Click **Add New Monitor**
3. Configure:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** `CSRP Bot`
   - **URL:** `https://YOUR-APP.onrender.com/health` (or your Railway URL)
   - **Interval:** Every 5 minutes
4. Click **Create Monitor** — done! 🎉

The uptime monitor will ping the `/health` endpoint every 5 minutes, which:
- Prevents the service from spinning down
- Validates the bot is alive
- Costs absolutely nothing

---

## 🔧 Troubleshooting

**Bot doesn't come online:**
- Check platform logs for errors
- Make sure `BOT_TOKEN` is correct
- Ensure `MONGODB_URI` is a valid MongoDB Atlas connection string

**Webhook not working:**
- Your platform provides a public URL — use that + `/erlc-event` (or `/roblox-event`) in ER:LC webhook settings
- Example: `https://your-app.onrender.com/erlc-event`


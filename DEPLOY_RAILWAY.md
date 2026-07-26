# 🚄 Deploy to Railway.app — 24/7 Free Cloud Hosting

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

## Step 2: Deploy on Railway

1. Go to https://railway.app
2. Click **Login with GitHub**
3. Click **New Project** → **Deploy from GitHub repo**
4. Select the repo you just pushed
5. Railway will automatically build and deploy using `railway.json`

## Step 3: Add Environment Variables

1. In Railway dashboard, go to your project
2. Click **Variables** tab
3. Add **ALL** the variables from your `.env` file:

| Variable | Value |
|----------|-------|
| `BOT_TOKEN` | Your Discord bot token |
| `MONGODB_URI` | Your MongoDB connection string |
| `ENABLE_PRIVILEGED_INTENTS` | `true` |
| `PARTNERSHIP_APPROVAL_CHANNEL_ID` | `1526042350802043022` |
| Plus all other IDs from your `.env` | ... |

4. Click **Deploy**

## Step 4: Done! 🎉

Your bot will be online 24/7. Railway auto-restarts if it crashes.

### Useful Railway Commands

- **View logs:** Railway dashboard → Deployments → View Logs
- **Restart:** Click Restart button in the dashboard
- **Custom domain:** Railway provides a `*.railway.app` URL for the webhook

---

## 🔧 Troubleshooting

**Bot doesn't come online:**
- Check Railway logs for errors
- Make sure `BOT_TOKEN` is correct
- Ensure `MONGODB_URI` is a valid MongoDB Atlas connection string

**Webhook not working:**
- Railway provides a public URL like `https://your-project.up.railway.app`
- Use that URL + `/erlc-event` in your ER:LC webhook settings


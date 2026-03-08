# 🎬 Telegram → AI Video Pipeline

Converts your voice note + video + b-roll clips into a fully edited, AI-composed short-form video — delivered back to you on Telegram.

---

## 📁 Project Structure

```
challenge-video-pipeline1/
├── src/
│   ├── server.js                  # Express health-check + Telegram polling entry point
│   ├── session.js                 # Conversational session state machine
│   ├── telegram.js                # Telegram Bot API helpers (send, getFile, long polling)
│   ├── pipeline/                  # Core video pipeline steps
│   │   ├── transcribe.js          # Voice note → text via Replicate WhisperX
│   │   ├── generateAroll.js       # Lip-sync video via Replicate Pixverse
│   │   ├── analyzeBroll.js        # Describe B-rolls + plan edit with Gemini 2.5 Pro
│   │   ├── renderPhotoBrolls.js   # Pre-render photo B-rolls as Ken Burns video clips
│   │   ├── composeVideo.js        # Final FFmpeg composition (A-roll + B-roll overlays)
│   │   └── generateCaption.js     # Viral caption generation via GPT-4o
│   ├── utils/
│   │   ├── cleanup.js             # Temp file cleanup
│   │   ├── download.js            # File downloader (URL → disk)
│   │   ├── duration.js            # FFprobe duration / video size helpers
│   │   └── retry.js               # Retry wrapper with exponential backoff
│   └── test_local.js              # Standalone local test runner (step-by-step)
├── assets/                        # Test media for local testing
├── Dockerfile                     # Production container (Node 20 + FFmpeg)
├── package.json
└── README.md
```

---

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root:
```env
PORT=3000
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
REPLICATE_API_TOKEN=your-replicate-api-token
OPENROUTER_API_KEY=your-openrouter-api-key
```

### 3. Start the Bot (Local)

Ensure you have `ffmpeg` installed locally.
```bash
npm start
```
The bot immediately starts polling Telegram for messages — no webhook or public URL needed.

---

## ☁️ Deploying to Railway

This project is fully ready for [Railway.app](https://railway.app/).

1. Create a new service on Railway and connect your GitHub repository.
2. Railway auto-detects the `Dockerfile` and builds the container with FFmpeg.
3. In the **Variables** tab, add: `TELEGRAM_BOT_TOKEN`, `REPLICATE_API_TOKEN`, `OPENROUTER_API_KEY`.
4. Deploy! The bot starts polling Telegram from the cloud.

> The Express server on `PORT` responds with `200 OK` on `GET /` for Railway health checks.

---

## 📱 How to Use (Telegram Bot)

### Step 1 — Send A-Roll (voice note + video)
Send the bot:
- 🎙️ A **voice note** (your narration / speech)
- 🎬 A **video of yourself** (used for AI lip-sync)

These can arrive in any order or in the same message. The bot tracks what's missing and prompts you.

### Step 2 — Bot Confirms
Once both are received, the bot replies:
> ✅ A-roll media is collected - send b-rolls now 🎥📸

### Step 3 — Send B-Rolls
Send **photos and/or video clips** as B-roll footage. You can send them individually or as an album. The bot waits 4 seconds after the last item, then automatically starts the pipeline.

### Result
Within a few minutes, the bot sends back:
- 🎬 The final edited video with B-roll overlays
- 📝 AI-generated viral caption with hashtags

---

## 🔄 Pipeline Flow

```
[Telegram Bot Polling]
       │
       ▼
[Session Manager]  ─── Step 0: Collect voice + A-roll video
       │                Step 1: Set header (/header) or toggle caps
       │                Step 2: Collect B-rolls (one by one)
       │                Step 3: Trigger Render (/start)
       ▼
[1. Transcribe Audio]      ── WhisperX via Replicate
       ▼
[2. Generate A-Roll]       ── Pixverse lip-sync via Replicate
       ▼
[3. Download A-Roll]       ── Download to /tmp
       ▼
[4. Analyze B-Rolls]       ── Gemini 2.5 Pro describes clips + plans edit
       ▼
[5. Pre-render Photos]     ── FFmpeg Ken Burns animation
       ▼
[6. Compose Video]         ── FFmpeg (B-rolls + Header + Subtitles)
       ▼
[7. Generate Caption]      ── GPT-4o writes viral caption
       ▼
[8. Extra Polish Step]     ── Placeholder for final refinements
       ▼
[9. Send Result]           ── Upload video + caption to Telegram
```

---

## 🛠️ Local Testing

Run individual pipeline steps without Telegram. Results are cached in `tmp/` between steps.

```bash
# Step 0: Normalize assets & upload to public URL
node src/test_local.js 0

# Step 1: Transcribe voice note (WhisperX)
node src/test_local.js 1

# Step 2: Generate Lip-sync A-Roll (Pixverse)
node src/test_local.js 2

# Step 3: Download A-Roll locally
node src/test_local.js 3

# Step 4: Describe B-Roll clips (Gemini 2.5 Pro)
node src/test_local.js 4

# Step 5: Pre-render photo B-rolls (Ken Burns animation)
node src/test_local.js 5

# Step 6: Plan the edit (Gemini 2.5 Pro)
node src/test_local.js 6

# Step 7: Compose final video (FFmpeg)
node src/test_local.js 7

# Step 8: Generate viral caption (GPT-4o)
node src/test_local.js 8
```

> Running `node src/test_local.js` without arguments wipes `tmp/` and runs all steps 0–8.

---

## ⚠️ Notes

- Video composition uses **local FFmpeg**. The `Dockerfile` installs it automatically for cloud deploys.
- Telegram uses **long polling** (no webhook needed). Works identically on local and Railway.
- Session state lives in-memory (`session.js`). A server restart clears all sessions.
- Telegram sends album items as separate messages. The bot uses a 4-second debounce timer to group B-roll items together before starting the pipeline.
- Photo B-rolls are pre-rendered with a Ken Burns zoom animation before being composited.

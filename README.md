# 🎬 Telegram → AI Video Pipeline

Converts your voice note + photo + b-roll videos into a fully edited, AI-composed video — delivered back to you on Telegram.

---

## 📁 Project Structure

```
challenge-video-pipeline1/
├── src/                           # Source JS files
│   ├── server.js                  # Main Express / Polling Server
│   ├── session.js                 # Session Manager
│   ├── telegram.js                # Telegram API helpers
│   ├── pipeline/                  # Core video pipeline steps
│   │   ├── transcribe.js          # Transcribes voice note via Replicate Whisper
│   │   ├── generateAroll.js       # Generates lip-sync video via Replicate Pixverse
│   │   ├── analyzeBroll.js        # Analyzes b-roll clips, creates edit plan with GPT-4o
│   │   ├── composeVideo.js        # Composes final video with b-roll via local FFmpeg
│   │   └── generateCaption.js     # Generates viral caption, sends video to Telegram
│   └── test_local.js              # Standalone local test runner
└── README.md
```

---

## 🚀 Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment variables
Create a `.env` file in the root with your API keys:
```env
TELEGRAM_BOT_TOKEN=8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc
REPLICATE_API_TOKEN=r8_cYkGtnlW5dT9h0e6aThUBTtP1mhZ3Y33AgHUy
OPENROUTER_API_KEY=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
```

### 3. Start the Server (Local)

Ensure you have `ffmpeg` installed locally on your system.
```bash
npm start
```
The bot will begin polling for Telegram messages.

---

## ☁️ Deploying to Railway

This project is fully ready to be deployed to [Railway.app](https://railway.app/).
Since the video composition uses local FFmpeg, the included `Dockerfile` ensures it is installed in the hosting environment automatically.

1. Create a new service on Railway and connect your GitHub repository.
2. Railway will automatically detect the `Dockerfile` and build the container with FFmpeg included.
3. In your Railway project, go to the **Variables** tab for the service and add your `TELEGRAM_BOT_TOKEN`, `REPLICATE_API_TOKEN`, and `OPENROUTER_API_KEY`.
4. Deploy! The bot will begin polling for Telegram messages from the cloud.

---

## 📱 How to Use (Telegram)

### Message 1 — Voice Note
Send a voice recording of yourself speaking to the bot.  
The bot will confirm receipt and ask for the next message.

### Message 2 — Caption + Photo + Video(s)
Send a message with:
- **Caption text** (your rough idea for the video caption)
- **A photo of yourself** (used for the AI lip-sync a-roll)
- **One or more video clips** (your b-roll footage)

> 💡 Telegram only allows one media per message. If you have multiple videos, send them as separate messages *after* the photo+caption message. The bot accumulates them until you have at least 1 video + 1 photo.

### Result
Within a few minutes, the bot sends back:
- 🎬 The final edited video
- 📝 AI-generated viral caption with hashtags
- 📋 The edit plan showing where each b-roll was inserted

---

## 🔄 Pipeline Flow

```
Telegram Voice Note
       ↓
[Session Manager] — saves audioUrl to session
       ↓
Telegram Caption + Photo + Videos
       ↓
[Session Manager] — assembles all assets, triggers pipeline
       ↓
[Transcribe Audio] — Whisper via Replicate
       ↓
[Generate A-Roll] — Pixverse lip-sync via Replicate (video + audio → talking video)
       ↓
[Analyze B-Roll] — GPT-4o describes each clip, plans insertion timestamps
       ↓
[Compose Video] — fal.ai FFmpeg overlays b-roll onto a-roll
       ↓
[Generate Caption & Send] — GPT-4o writes viral caption → Telegram
```

---

## 🔑 API Keys (hardcoded)

| Service | Key |
|---------|-----|
| Telegram Bot | `8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc` |
| Replicate | `r8_cYkGtnlW5dT9h0e6aThUBTtP1mhZ3Y33AgHUy` |
| OpenRouter | `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` |

---

## ✏️ Modifying Code

Edit any file in `src/`, then restart the server:
```bash
npm start
```

---

## ⚠️ Notes

- Video compositing is done locally using FFmpeg. When deploying to platforms like Railway, the included `Dockerfile` installs FFmpeg automatically for you.
- Replicate Whisper (`openai/whisper`) transcribes the Telegram voice note by URL — no download required.
- Replicate Pixverse (`pixverse/lipsync`) generates the lip-synced A-roll video.
- Session state is kept in memory by `session.js` over the course of the bot interaction.
- Telegram only sends one media item per message payload. For multiple b-roll videos or photos, the session manager accumulates them across messages.

---

## 🛠️ Local Testing

You can run individual parts of the pipeline locally without having to trigger the full bot via Telegram. This is great for debugging prompts, API limits, or parsing errors. 

**Make sure you have an `.env` file with `REPLICATE_API_TOKEN` and `OPENROUTER_API_KEY`.**

The `tmp/` folder will comfortably cache outputs at every step and act as the input for the *next* step so you don't rebuild from scratch.

### 🏃 Running Steps Independently

Run these bash commands in order. If you need to re-run a step, you can just execute it again without starting over!

```bash
# Step 0: Upload initial mock assets located in /assets to the public cloud
node src/test_local.js 0

# Step 1: Transcribe the uploaded voice note using WhisperX
node src/test_local.js 1

# Step 2: Generate Lip-sync A-Roll using Pixverse
node src/test_local.js 2

# Step 3: Download A-Roll locally for composition
node src/test_local.js 3

# Step 4: Describe B-Roll clips using Gemini 2.5 Pro
node src/test_local.js 4

# Step 5: Pre-render photo B-rolls as video clips with Ken Burns animation
node src/test_local.js 5

# Step 6: Plan the edit based on descriptions and transcript
node src/test_local.js 6

# Step 7: Compose the final video using local FFmpeg
node src/test_local.js 7

# Step 8: Generate the final viral caption (OpenRouter)
node src/test_local.js 8
```

> **Note:** Running `node src/test_local.js` without any arguments will completely wipe the `./tmp` folder and execute all 0-8 steps continuously.


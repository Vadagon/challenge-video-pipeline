# 🎬 Telegram → AI Video Pipeline (n8n)

Converts your voice note + photo + b-roll videos into a fully edited, AI-composed video — delivered back to you on Telegram.

---

## 📁 Project Structure

```
challenge-video-pipeline1/
├── src/                           # Source JS files (edit these, then run build.js)
│   ├── 01_session_manager.js      # Handles Telegram messages, session state
│   ├── 02_transcribe_audio.js     # Transcribes voice note via Replicate Whisper
│   ├── 03_generate_aroll.js       # Generates lip-sync video via Replicate Pixverse
│   ├── 04_analyze_broll.js        # Analyzes b-roll clips, creates edit plan with GPT-4o
│   ├── 05_compose_video.js        # Composes final video with b-roll via local FFmpeg
│   ├── 06_send_result.js          # Generates viral caption, sends video to Telegram
│   └── 07_error_handler.js        # Catches errors, notifies user
├── workflow_template.json          # n8n workflow skeleton (%%CODE_XX%% placeholders)
├── workflow.json                   # ✅ BUILT FILE — import this into n8n
├── build.js                        # Build script: injects src/ JS → workflow.json
└── README.md
```

---

## 🚀 Setup

### 1. Build the workflow
```bash
node build.js
```

### 2. Import into n8n
- Open n8n → **Workflows** → **Import from File**
- Select `workflow.json`

### 3. Add Telegram Credential
- Go to **Credentials** → **New** → search `Telegram API`
- Paste your bot token: `8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc`
- Assign it to the **"Telegram Trigger"** node

### 4. Activate the workflow ✅
n8n automatically registers the Telegram webhook — no manual `curl` needed.

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

Edit any file in `src/`, then rebuild:
```bash
node build.js
# Re-import workflow.json into n8n
```

---

## ⚠️ Notes

- Video compositing is done locally using FFmpeg (must be installed in the n8n environment).
- Replicate Whisper (`openai/whisper`) transcribes the Telegram voice note by URL — no download required.
- Replicate Pixverse (`pixverse/lipsync`) generates the lip-synced A-roll video.
- Session state uses n8n's `$getWorkflowStaticData("global")` — it persists across executions within the same workflow instance.
- Telegram only sends one media item per message payload. For multiple b-roll videos, the session manager accumulates them across messages.

---

## 🛠️ Local Testing

You can run individual parts of the pipeline locally without having to trigger the full bot via Telegram. This is great for debugging prompts, API limits, or parsing errors. 

**Make sure you have an `.env` file with `REPLICATE_API_TOKEN` and `OPENROUTER_API_KEY`.**

The `tmp/` folder will comfortably cache outputs at every step and act as the input for the *next* step so you don't rebuild from scratch.

### 🏃 Running Steps Independently

Run these bash commands in order. If you need to re-run a step, you can just execute it again without starting over!

```bash
# Step 0: Upload initial mock assets located in /assets to the Replicate cloud
node src/test_local.js 0

# Step 1: Transcribe the uploaded voice note using WhisperX
node src/test_local.js 1

# Step 2: Generate Lip-sync A-Roll using Pixverse
node src/test_local.js 2

# Step 3: Download A-Roll locally for composition
node src/test_local.js 3

# Step 4: Describe B-Roll clips using Gemini 2.5 Pro
node src/test_local.js 4

# Step 5: Plan the edit based on description and transcript
node src/test_local.js 5

# Step 6: Compose the final video using local FFmpeg
node src/test_local.js 6

# Step 7: Generate the final viral caption (OpenRouter)
node src/test_local.js 7
```

> **Note:** Running `node src/test_local.js` without any arguments will completely wipe the `./tmp` folder and execute all 0-7 steps continuously.

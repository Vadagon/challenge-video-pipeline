// NODE: Session Manager
// Receives Telegram updates from the n8n Telegram Trigger node and tracks
// 2-message session state per chat.
// Message 1: Voice audio only
// Message 2: Caption + Subject (Photo/Video) + B-Roll Video(s) → triggers pipeline

const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

// The Telegram Trigger node exposes the update directly (not nested under .body)
const update = $input.first().json;
const message = update.message || update.edited_message || null;

if (!message) {
  return [{ json: { skip: true, reason: "no message" } }];
}

const chatId = String(message.chat.id);

// Load existing session from workflow static data
const staticData = $getWorkflowStaticData("global");
if (!staticData.sessions) staticData.sessions = {};

let session = staticData.sessions[chatId] || { step: 0 };

// Prevent duplicate processing if already in progress (but allow new voice notes)
if (session.step === 2 && !message.voice) {
  return [{ json: { skip: true, reason: "already processing" } }];
}

// ── STEP 1: Voice message ──────────────────────────────────────────────────
if (message.voice && (session.step === 0 || session.step === 2)) {
  const fileId = message.voice.file_id;

  // Resolve file path via Telegram API
  const fileInfoResp = await this.helpers.httpRequest({
    method: "GET",
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`,
  });

  const filePath = fileInfoResp.result.file_path;
  const audioUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

  session = { step: 1, chatId, audioUrl, audioFileId: fileId, videos: [] };
  staticData.sessions[chatId] = session;

  // Acknowledge receipt
  await this.helpers.httpRequest({
    method: "POST",
    url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: {
      chat_id: chatId,
      text: "🎙️ Got your voice note!\n\nNow send a single message (or an album) with:\n📝 Caption (as message text)\n👤 A video of you (or a photo)\n🎬 One or more clips (b-roll)",
    },
    json: true,
  });

  return [{ json: { skip: true, reason: "waiting for step 2" } }];
}

// ── STEP 2: Accumulate Caption + Subject + Videos ─────────────────────────
if (session.step === 1) {
  const currentCaption = message.caption || message.text || "";
  const photo = message.photo;
  const video = message.video;

  let updated = false;

  // 1. Accumulate Caption (if we don't have one yet)
  if (currentCaption && !session.caption) {
    session.caption = currentCaption;
    updated = true;
  }

  // 2. Accumulate Subject (The first person-centric media we get)
  // If we get multiple videos, the first one is the subject, others are b-roll
  if (!session.subjectUrl) {
    if (photo) {
      const bestPhoto = photo[photo.length - 1];
      const photoInfoResp = await this.helpers.httpRequest({
        method: "GET",
        url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${bestPhoto.file_id}`,
      });
      session.subjectUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${photoInfoResp.result.file_path}`;
      session.subjectType = "image";
      updated = true;
    } else if (video) {
      const videoInfoResp = await this.helpers.httpRequest({
        method: "GET",
        url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${video.file_id}`,
      });
      session.subjectUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${videoInfoResp.result.file_path}`;
      session.subjectType = "video";
      updated = true;
    }
  } else if (video) {
    // 3. Accumulate B-Roll Video
    const videoInfoResp = await this.helpers.httpRequest({
      method: "GET",
      url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${video.file_id}`,
    });
    const videoUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${videoInfoResp.result.file_path}`;

    if (!session.videos) session.videos = [];
    if (!session.videos.find(v => v.fileId === video.file_id)) {
      session.videos.push({ fileId: video.file_id, url: videoUrl, duration: video.duration });
      updated = true;
    }
  }

  // Save updated session state
  staticData.sessions[chatId] = session;

  // 4. Check if we have everything needed to proceed
  const hasCaption = !!session.caption;
  const hasSubject = !!session.subjectUrl;
  const hasVideos = session.videos && session.videos.length > 0;

  if (hasCaption && hasSubject && hasVideos) {
    // TRIGGER PIPELINE
    session.step = 2; // Move to "processing" state
    staticData.sessions[chatId] = session;

    await this.helpers.httpRequest({
      method: "POST",
      url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      body: {
        chat_id: chatId,
        text: "⚙️ All assets received! Starting video generation pipeline...\n\nThis may take a few minutes ☕",
      },
      json: true,
    });

    return [{
      json: {
        skip: false,
        chatId,
        audioUrl: session.audioUrl,
        subjectUrl: session.subjectUrl,
        subjectType: session.subjectType,
        videos: session.videos,
        rawCaption: session.caption,
      },
    }];
  }

  // 5. Still collecting
  if (updated && !message.media_group_id) {
    const missing = [];
    if (!hasCaption) missing.push("📝 caption");
    if (!hasSubject) missing.push("👤 you (video/photo)");
    if (!hasVideos) missing.push("🎬 clips (b-roll)");

    await this.helpers.httpRequest({
      method: "POST",
      url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      body: {
        chat_id: chatId,
        text: `📥 Received some assets. Still missing: ${missing.join(", ")}.`,
      },
      json: true,
    });
  }

  return [{ json: { skip: true, reason: "collecting assets", hasCaption, hasSubject, videoCount: (session.videos || []).length } }];
}

// ── DEFAULT: Unexpected State Reset ───────────────────────────────────────
delete staticData.sessions[chatId];
await this.helpers.httpRequest({
  method: "POST",
  url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
  body: {
    chat_id: chatId,
    text: "👋 Send a voice note to start! The bot will guide you through the next steps.",
  },
  json: true,
});

return [{ json: { skip: true, reason: "unexpected state reset" } }];

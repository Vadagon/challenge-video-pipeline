const telegram = require('./telegram');

// In-memory sessions storage
const sessions = {};

/**
 * Handles an incoming Telegram update.
 * Resolves session state and handles requesting missing assets.
 * Returns an object with { skip, chatId, audioUrl, videos, rawCaption, reason }
 * If skip is false, the pipeline should start.
 */
async function handleUpdate(update) {
    const message = update.message || update.edited_message || null;
    if (!message) return { skip: true, reason: 'no message' };

    const chatId = String(message.chat.id);
    let session = sessions[chatId] || { step: 0 };

    // Prevent duplicate processing if already in progress (but allow new voice notes to reset)
    if (session.step === 2 && !message.voice) {
        return { skip: true, reason: 'already processing' };
    }

    // ── STEP 1: Voice message ──────────────────────────────────────────────────
    if (message.voice && (session.step === 0 || session.step === 2)) {
        const fileId = message.voice.file_id;
        const audioUrl = await telegram.getFileUrl(fileId);

        session = { step: 1, chatId, audioUrl, audioFileId: fileId, videos: [] };
        sessions[chatId] = session;

        await telegram.sendMessage(
            chatId,
            "🎙️ Got your voice note!\n\nNow send a single message (or an album) with:\n📝 Caption (as message text)\n🎬 One main video (A-roll)\n📸 One or more clips (B-roll)"
        );

        return { skip: true, reason: 'waiting for step 2' };
    }

    // ── STEP 2: Accumulate Caption + Videos ──────────────────────────────────
    if (session.step === 1) {
        const currentCaption = message.caption || message.text || "";
        const video = message.video;

        let updated = false;

        // 1. Accumulate Caption
        if (currentCaption && !session.caption) {
            session.caption = currentCaption;
            updated = true;
        }

        // 2. Accumulate Video
        if (video) {
            const videoUrl = await telegram.getFileUrl(video.file_id);

            if (!session.videos) session.videos = [];
            if (!session.videos.find(v => v.fileId === video.file_id)) {
                session.videos.push({ fileId: video.file_id, url: videoUrl, duration: video.duration });
                updated = true;
            }
        }

        // Save updated session state
        sessions[chatId] = session;

        const hasCaption = !!session.caption;
        const videoCount = (session.videos || []).length;
        const hasEnoughVideos = videoCount >= 2;

        if (hasCaption && hasEnoughVideos) {
            session.step = 2; // Move to "processing" state
            sessions[chatId] = session;

            await telegram.sendMessage(
                chatId,
                `⚙️ All assets received (${videoCount} videos)! Starting generation pipeline...\n\nThis may take a few minutes ☕`
            );

            return {
                skip: false,
                chatId,
                audioUrl: session.audioUrl,
                videos: session.videos,
                rawCaption: session.caption
            };
        }

        if (updated && !message.media_group_id) {
            const missing = [];
            if (!hasCaption) missing.push("📝 caption");
            if (videoCount === 0) missing.push("🎬 main video (A-roll)");
            if (videoCount === 1) missing.push("🎬 b-roll clips");

            await telegram.sendMessage(
                chatId,
                `📥 Received ${videoCount} video(s). Still missing: ${missing.join(", ")}.`
            );
        }

        return { skip: true, reason: 'collecting assets', hasCaption, videoCount };
    }

    // ── DEFAULT: Unexpected State Reset ───────────────────────────────────────
    delete sessions[chatId];
    await telegram.sendMessage(
        chatId,
        "👋 Send a voice note to start! The bot will guide you through the next steps."
    );

    return { skip: true, reason: 'unexpected state reset' };
}

module.exports = { handleUpdate };

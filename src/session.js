const telegram = require('./telegram');

// In-memory sessions storage
const sessions = {};

/**
 * Handles an incoming Telegram update.
 * Resolves session state and handles requesting missing assets.
 * Returns an object with { skip, reason }
 * If the pipeline should start (after debounce), it calls `onReady`.
 */
async function handleUpdate(update, onReady) {
    const message = update.message || update.edited_message || null;
    if (!message) return { skip: true, reason: 'no message' };

    const chatId = String(message.chat.id);
    const text = (message.text || message.caption || "").trim().toLowerCase();

    // ── COMMAND HANDLING ──────────────────────────────────────────────────

    // /stop command: Reset everything
    if (text === '/stop') {
        const hadSession = !!sessions[chatId];
        delete sessions[chatId];
        await telegram.sendMessage(
            chatId,
            hadSession ? "🔄 Session reset! Send a voice note to start a new project." : "👋 Send a voice note to start! The bot will guide you through the next steps."
        );
        return { skip: true, reason: 'session reset' };
    }

    // /start command: Trigger render or Greet
    if (text === '/start') {
        let session = sessions[chatId];

        // If no session or already processing, greet/reset
        if (!session || session.step === 0 || session.step === 2) {
            delete sessions[chatId];
            await telegram.sendMessage(
                chatId,
                "👋 Welcome! Send a voice note to start your video project."
            );
            return { skip: true, reason: 'greeting' };
        }

        // If waiting for b-rolls, trigger the pipeline
        if (session.step === 1) {
            if (session.bRolls.length === 0) {
                await telegram.sendMessage(chatId, "⚠️ Please send at least one B-roll photo or video before starting the render.");
                return { skip: true, reason: 'no b-rolls' };
            }

            session.step = 2; // Move to processing state
            sessions[chatId] = session;

            const bRollCount = session.bRolls.length;
            await telegram.sendMessage(
                chatId,
                `⚙️ Starting generation pipeline with ${bRollCount} B-rolls...\n\nThis may take a few minutes ☕`
            );

            // Prepare the combined videos array: [A-roll, ...B-rolls]
            const allVideos = [session.aRollVideo, ...session.bRolls];

            // Trigger the pipeline
            const pipelineData = {
                skip: false,
                chatId,
                audioUrl: session.audioUrl,
                videos: allVideos,
                rawCaption: session.caption || "",
                headerText: session.headerText || "",
                captionsEnabled: session.captionsEnabled !== false // Default to true
            };

            if (typeof onReady === 'function') {
                console.log(`[Session ${chatId}] Pipeline manually triggered via /start.`);
                onReady(pipelineData);
            }
            return { skip: true, reason: 'pipeline started' };
        }
    }

    // /header command: Set overlay text
    if (text.startsWith('/header')) {
        let session = sessions[chatId] || { step: 0 };
        const headerText = text.replace('/header', '').trim();

        if (!headerText) {
            await telegram.sendMessage(chatId, "⚠️ Please provide text after /header. Example: `/header Road to 100k$`");
            return { skip: true, reason: 'empty header' };
        }

        session.headerText = headerText;
        sessions[chatId] = session;

        await telegram.sendMessage(chatId, `✅ Header set to: "${headerText}"\nThis will appear at the top of your final video.`);
        return { skip: true, reason: 'header set' };
    }

    // /captionsoff command: Disable subtitles
    if (text === '/captionsoff') {
        let session = sessions[chatId] || { step: 0 };
        session.captionsEnabled = false;
        sessions[chatId] = session;
        await telegram.sendMessage(chatId, "🔇 Subtitles disabled for this video.");
        return { skip: true, reason: 'captions disabled' };
    }

    // /captionson command: Enable subtitles (default)
    if (text === '/captionson') {
        let session = sessions[chatId] || { step: 0 };
        session.captionsEnabled = true;
        sessions[chatId] = session;
        await telegram.sendMessage(chatId, "🔊 Subtitles enabled for this video.");
        return { skip: true, reason: 'captions enabled' };
    }

    let session = sessions[chatId] || { step: 0, captionsEnabled: true };

    // Prevent duplicate processing if already in progress (but allow new voice notes to reset)
    if (session.step === 2 && !message.voice) {
        return { skip: true, reason: 'already processing' };
    }

    // ── STEP 1: Voice message + A-Roll Video ──────────────────────────────────
    if (session.step === 0 || session.step === 2) {
        let updated = false;

        // 1. Accumulate Voice
        if (message.voice && !session.audioUrl) {
            const fileId = message.voice.file_id;
            session.audioUrl = await telegram.getFileUrl(fileId);
            session.audioFileId = fileId;
            updated = true;
        }

        // 2. Accumulate A-Roll Video
        if (message.video && !session.aRollVideo) {
            session.aRollVideo = {
                fileId: message.video.file_id,
                url: await telegram.getFileUrl(message.video.file_id),
                duration: message.video.duration,
                type: "video"
            };
            updated = true;
        }

        // 3. Accumulate Caption
        if (!session.caption && (message.caption || message.text)) {
            session.caption = message.caption || message.text;
            updated = true;
        }

        if (updated) {
            sessions[chatId] = session;
        }

        const hasAudio = !!session.audioUrl;
        const hasVideo = !!session.aRollVideo;

        if (hasAudio && hasVideo) {
            session.step = 1;
            session.bRolls = [];
            sessions[chatId] = session;

            await telegram.sendMessage(
                chatId,
                "✅ A-roll media is collected - send b-rolls now 🎥📸\n\nWhen you are finished, type /start to render the video."
            );
            return { skip: true, reason: 'waiting for b-rolls' };
        }

        if (updated) {
            const missing = [];
            if (!hasAudio) missing.push("🎙️ voice note");
            if (!hasVideo) missing.push("🎬 main video (A-roll)");

            await telegram.sendMessage(
                chatId,
                `📥 Received media. Still missing: ${missing.join(" and ")}.`
            );
        }

        return { skip: true, reason: 'collecting a-roll' };
    }

    // ── STEP 2: Accumulate B-Rolls with Debounce ─────────────────────────────
    if (session.step === 1) {
        const video = message.video;
        const photo = message.photo && message.photo.length > 0 ? message.photo[message.photo.length - 1] : null;

        let addedMedia = false;

        if (video) {
            const videoUrl = await telegram.getFileUrl(video.file_id);
            if (!session.bRolls.find(v => v.fileId === video.file_id)) {
                session.bRolls.push({ fileId: video.file_id, url: videoUrl, duration: video.duration, type: "video" });
                addedMedia = true;
            }
        }

        if (photo) {
            const photoUrl = await telegram.getFileUrl(photo.file_id);
            if (!session.bRolls.find(v => v.fileId === photo.file_id)) {
                session.bRolls.push({ fileId: photo.file_id, url: photoUrl, duration: 5, type: "photo" });
                addedMedia = true;
            }
        }

        if (addedMedia) {
            sessions[chatId] = session;
            await telegram.sendMessage(chatId, `✅ B-roll added (${session.bRolls.length} total). Send more or type /start to render!`);
        }

        return { skip: true, reason: 'collecting b-rolls', bRollCount: session.bRolls.length };
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

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
    const text = (message.text || message.caption || "").trim();

    // ── COMMAND HANDLING ──────────────────────────────────────────────────

    // /start or /stop command: Reset everything
    if (text === '/start' || text === '/stop') {
        delete sessions[chatId];
        await telegram.sendMessage(
            chatId,
            "🔄 Session reset! Send a voice note to start a new project."
        );
        return { skip: true, reason: 'session reset' };
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

    let session = sessions[chatId] || { step: 0 };

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
                "✅ A-roll media is collected - send b-rolls now 🎥📸"
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

            // Clear existing timeout if there is one
            if (session.debounceTimer) {
                clearTimeout(session.debounceTimer);
            }

            // Set a debounce timer to start the pipeline after 4 seconds of inactivity
            session.debounceTimer = setTimeout(async () => {
                const finalSession = sessions[chatId];
                if (!finalSession || finalSession.step !== 1) return;

                finalSession.step = 2; // Move to processing state
                delete finalSession.debounceTimer;
                sessions[chatId] = finalSession;

                const bRollCount = finalSession.bRolls.length;
                await telegram.sendMessage(
                    chatId,
                    `⚙️ All assets received (A-roll + ${bRollCount} B-rolls)! Starting generation pipeline...\n\nThis may take a few minutes ☕`
                );

                // Prepare the combined videos array: [A-roll, ...B-rolls]
                const allVideos = [finalSession.aRollVideo, ...finalSession.bRolls];

                // Trigger the pipeline by mimicking the webhooks resolve format
                const pipelineData = {
                    skip: false,
                    chatId,
                    audioUrl: finalSession.audioUrl,
                    videos: allVideos,
                    rawCaption: finalSession.caption || "",
                    headerText: finalSession.headerText || ""
                };

                // Trigger the pipeline using the provided callback
                if (typeof onReady === 'function') {
                    console.log(`[Session ${chatId}] Pipeline debounce triggered.`);
                    onReady(pipelineData);
                }
            }, 4000);

            sessions[chatId] = session;
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

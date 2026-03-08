require('dotenv').config();
const express = require('express');

const telegram = require('./telegram');
const sessionManager = require('./session');

const { downloadFile } = require('./utils/download');
const { cleanupFiles } = require('./utils/cleanup');
const { uploadToPublicUrl } = require('./utils/upload');
const { convertToMp3, convertToMp4 } = require('./utils/convert');

const { transcribeAudio } = require('./pipeline/transcribe');
const { generateARoll } = require('./pipeline/generateAroll');
const { analyzeBRoll } = require('./pipeline/analyzeBroll');
const { composeVideo } = require('./pipeline/composeVideo');
const { generateCaption } = require('./pipeline/generateCaption');
const { renderPhotoBrolls } = require('./pipeline/renderPhotoBrolls');
const { getVideoSize } = require('./utils/duration');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Video Pipeline Server is running!');
});

// Start Telegram Polling instead of using webhooks
telegram.startPolling(async (update) => {
    try {
        const sessionRes = await sessionManager.handleUpdate(update, (pipelineData) => {
            if (pipelineData && !pipelineData.skip) {
                // Run the heavy pipeline asynchronously
                runPipeline(pipelineData).catch(err => {
                    console.error("Pipeline failed:", err);
                    telegram.sendMessage(pipelineData.chatId, `❌ Pipeline error: ${err.message}`);
                });
            }
        });

        // Retain synchronous support in case a future step decides to return pipeline data directly
        if (sessionRes && !sessionRes.skip) {
            runPipeline(sessionRes).catch(err => {
                console.error("Pipeline failed:", err);
                telegram.sendMessage(sessionRes.chatId, `❌ Pipeline error: ${err.message}`);
            });
        }
    } catch (err) {
        console.error("Error processing update:", err);
    }
});

async function runPipeline({ chatId, audioUrl, videos, rawCaption, headerText }) {
    const downloadedPaths = [];

    try {
        // 0. Normalize Media (Download -> Convert -> Re-upload)
        // This is necessary because Telegram URLs have invalid content-type headers for Replicate
        await telegram.sendMessage(chatId, "⚙️ Normalizing media for AI processing...");

        // A. Normalize Audio
        const rawAudioLocal = `/tmp/raw_audio_${chatId}_${Date.now()}.bin`;
        const normalizedAudioLocal = `/tmp/audio_${chatId}_${Date.now()}.mp3`;
        await downloadFile(audioUrl, rawAudioLocal);
        downloadedPaths.push(rawAudioLocal);
        await convertToMp3(rawAudioLocal, normalizedAudioLocal);
        downloadedPaths.push(normalizedAudioLocal);
        const audioPublicUrl = await uploadToPublicUrl(normalizedAudioLocal);

        // B. Normalize A-Roll Video
        const aRollSourceUrl = videos[0].url;
        const rawVideoLocal = `/tmp/raw_video_${chatId}_${Date.now()}.bin`;
        const normalizedVideoLocal = `/tmp/video_${chatId}_${Date.now()}.mp4`;
        await downloadFile(aRollSourceUrl, rawVideoLocal);
        downloadedPaths.push(rawVideoLocal);
        await convertToMp4(rawVideoLocal, normalizedVideoLocal);
        downloadedPaths.push(normalizedVideoLocal);
        const aRollPublicUrl = await uploadToPublicUrl(normalizedVideoLocal);

        // 1. Transcribe Audio
        await telegram.sendMessage(chatId, "🗣️ Transcribing audio...");
        let transcription;
        try {
            transcription = await transcribeAudio(audioPublicUrl);
        } catch (e) {
            throw new Error(`Audio transcription failed: ${e.message}`);
        }

        // 2. Generate A-Roll Video
        await telegram.sendMessage(chatId, "🤖 Generating A-Roll talking head...");
        let aRollResultUrl;
        try {
            aRollResultUrl = await generateARoll(audioPublicUrl, aRollPublicUrl);
        } catch (e) {
            throw new Error(`A-Roll generation (Lip-sync) failed: ${e.message}`);
        }

        // 3. Download A-Roll Result locally
        await telegram.sendMessage(chatId, "📥 Downloading AI result...");
        const aRollLocal = `/tmp/aroll_${chatId}_${Date.now()}.mp4`;
        try {
            await downloadFile(aRollResultUrl, aRollLocal);
            downloadedPaths.push(aRollLocal);
        } catch (e) {
            throw new Error(`Failed to download A-Roll: ${e.message}`);
        }

        // 4. Analyze B-Roll
        await telegram.sendMessage(chatId, "🧠 Analyzing B-Rolls & Planning Edit...");
        const rawBrollClips = videos.slice(1);
        const normalizedBrollClips = [];

        for (let i = 0; i < rawBrollClips.length; i++) {
            const clip = rawBrollClips[i];
            try {
                if (clip.type === 'video') {
                    // Normalize Video B-Roll
                    const rawBrollLocal = `/tmp/raw_broll_v_${chatId}_${i}_${Date.now()}.bin`;
                    const normalizedBrollLocal = `/tmp/broll_v_${chatId}_${i}_${Date.now()}.mp4`;
                    await downloadFile(clip.url, rawBrollLocal);
                    downloadedPaths.push(rawBrollLocal);
                    await convertToMp4(rawBrollLocal, normalizedBrollLocal);
                    downloadedPaths.push(normalizedBrollLocal);
                    const publicUrl = await uploadToPublicUrl(normalizedBrollLocal);
                    normalizedBrollClips.push({ ...clip, url: publicUrl, localPath: normalizedBrollLocal });
                } else if (clip.type === 'photo') {
                    // For photos, we just need a clean upload (no conversion needed for Gemini multimodal)
                    const rawPhotoLocal = `/tmp/raw_broll_p_${chatId}_${i}_${Date.now()}.bin`;
                    await downloadFile(clip.url, rawPhotoLocal);
                    downloadedPaths.push(rawPhotoLocal);
                    const publicUrl = await uploadToPublicUrl(rawPhotoLocal);
                    normalizedBrollClips.push({ ...clip, url: publicUrl, localPath: rawPhotoLocal });
                }
            } catch (err) {
                console.error(`Failed to normalize B-roll ${i}:`, err.message);
                // If normalization fails, we can still fall back to the original URL if necessary, 
                // but usually this means the file is broken.
            }
        }

        let brolls, editPlan;
        try {
            const analysis = await analyzeBRoll(normalizedBrollClips, transcription);
            brolls = analysis.brolls;
            editPlan = analysis.editPlan;
        } catch (e) {
            console.error("B-Roll analysis warning:", e);
            throw new Error("Failed to analyze B-Roll clips or plan the edit.");
        }

        // Note: B-rolls are already downloaded locally during normalization above.
        // We still need to ensure brolls array contains the localPaths for composeVideo.
        // The normalizedBrollClips already had localPath, and analyzeBRoll returns them.

        // 5. Pre-render photo B-rolls as video clips
        await telegram.sendMessage(chatId, "🖼️ Pre-rendering photo B-rolls...");
        try {
            const canvas = getVideoSize(aRollLocal);
            brolls = await renderPhotoBrolls(brolls, '/tmp', canvas);
        } catch (e) {
            console.warn("Photo B-roll rendering warning:", e.message);
            // Non-fatal: composeVideo will skip clips without valid localPaths
        }

        // 6. Compose Video (Local FFmpeg)
        await telegram.sendMessage(chatId, "🎬 Composing final video...");
        let finalVideoPath;
        try {
            finalVideoPath = await composeVideo(chatId, aRollLocal, brolls, editPlan, headerText);
            downloadedPaths.push(finalVideoPath);
        } catch (e) {
            throw new Error(`Video composition failed: ${e.message}`);
        }

        // 6. Generate Caption
        await telegram.sendMessage(chatId, "✍️ Generating viral caption...");
        let viralCaption = rawCaption; // Fallback
        try {
            viralCaption = await generateCaption(rawCaption, transcription);
        } catch (e) {
            console.warn("Caption generation failed, using raw caption:", e.message);
        }

        // 7. Send Result to User
        await telegram.sendMessage(chatId, "🚀 Uploading your masterpiece!");
        try {
            await telegram.sendVideo(chatId, finalVideoPath, viralCaption);
            await telegram.sendMessage(chatId, "✅ Video sent! Use /start (or send a new voice note) to make another.");
        } catch (e) {
            throw new Error("Final video was generated but failed to upload to Telegram.");
        }

    } finally {
        // Cleanup temporary files
        await cleanupFiles(downloadedPaths);
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

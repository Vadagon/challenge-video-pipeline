require('dotenv').config();
const express = require('express');

const telegram = require('./telegram');
const sessionManager = require('./session');

const { downloadFile } = require('./utils/download');
const { cleanupFiles } = require('./utils/cleanup');

const { transcribeAudio } = require('./pipeline/transcribe');
const { generateARoll } = require('./pipeline/generateAroll');
const { analyzeBRoll } = require('./pipeline/analyzeBroll');
const { composeVideo } = require('./pipeline/composeVideo');
const { generateCaption } = require('./pipeline/generateCaption');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Video Pipeline Server is running!');
});

app.post('/webhook', async (req, res) => {
    // Always respond to Telegram immediately to avoid retries
    res.sendStatus(200);

    try {
        const update = req.body;
        const sessionRes = await sessionManager.handleUpdate(update);

        if (sessionRes && !sessionRes.skip) {
            // Run the heavy pipeline asynchronously
            runPipeline(sessionRes).catch(err => {
                console.error("Pipeline failed:", err);
                telegram.sendMessage(sessionRes.chatId, `❌ Pipeline error: ${err.message}`);
            });
        }
    } catch (err) {
        console.error("Error processing update:", err);
    }
});

async function runPipeline({ chatId, audioUrl, videos, rawCaption }) {
    const downloadedPaths = [];

    try {
        // 1. Transcribe Audio
        await telegram.sendMessage(chatId, "🗣️ Transcribing audio...");
        let transcription;
        try {
            transcription = await transcribeAudio(audioUrl);
        } catch (e) {
            throw new Error(`Audio transcription failed: ${e.message}`);
        }

        // 2. Generate A-Roll Video
        await telegram.sendMessage(chatId, "🤖 Generating A-Roll talking head...");
        let aRollUrl;
        const aRollSourceUrl = videos[0].url;
        try {
            aRollUrl = await generateARoll(audioUrl, aRollSourceUrl);
        } catch (e) {
            throw new Error(`A-Roll generation (Lip-sync) failed: ${e.message}`);
        }

        // 3. Download A-Roll locally
        await telegram.sendMessage(chatId, "📥 Downloading assets locally...");
        const aRollLocal = `/tmp/aroll_${chatId}_${Date.now()}.mp4`;
        try {
            await downloadFile(aRollUrl, aRollLocal);
            downloadedPaths.push(aRollLocal);
        } catch (e) {
            throw new Error(`Failed to download A-Roll: ${e.message}`);
        }

        // 4. Analyze B-Roll
        await telegram.sendMessage(chatId, "🧠 Analyzing B-Rolls & Planning Edit...");
        const brollClips = videos.slice(1);
        let brolls, editPlan;
        try {
            const analysis = await analyzeBRoll(brollClips, transcription);
            brolls = analysis.brolls;
            editPlan = analysis.editPlan;
        } catch (e) {
            console.error("B-Roll analysis warning:", e);
            throw new Error("Failed to analyze B-Roll clips or plan the edit.");
        }

        // Download B-Rolls locally
        for (let i = 0; i < brolls.length; i++) {
            const broll = brolls[i];
            const bLocal = `/tmp/broll_${chatId}_${i}_${Date.now()}.mp4`;
            try {
                await downloadFile(broll.url, bLocal);
                downloadedPaths.push(bLocal);
                broll.localPath = bLocal; // Set localPath for composeVideo
            } catch (e) {
                console.error(`Failed to download B-Roll ${i}:`, e.message);
                // Continue despite failure, composeVideo handles missing localPaths safely
            }
        }

        // 5. Compose Video (Local FFmpeg)
        await telegram.sendMessage(chatId, "🎬 Composing final video...");
        let finalVideoPath;
        try {
            finalVideoPath = await composeVideo(chatId, aRollLocal, brolls, editPlan);
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

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
        const transcription = await transcribeAudio(audioUrl);

        // 2. Generate A-Roll Video
        await telegram.sendMessage(chatId, "🤖 Generating A-Roll talking head...");
        const aRollSourceUrl = videos[0].url;
        const aRollUrl = await generateARoll(audioUrl, aRollSourceUrl);

        // 3. Download A-Roll locally
        await telegram.sendMessage(chatId, "📥 Downloading assets locally...");
        const aRollLocal = `/tmp/aroll_${chatId}_${Date.now()}.mp4`;
        await downloadFile(aRollUrl, aRollLocal);
        downloadedPaths.push(aRollLocal);

        // 4. Analyze B-Roll
        await telegram.sendMessage(chatId, "🧠 Analyzing B-Rolls & Planning Edit...");
        const brollClips = videos.slice(1);
        const { brolls, editPlan } = await analyzeBRoll(brollClips, transcription);

        // Download B-Rolls locally
        for (let i = 0; i < brolls.length; i++) {
            const broll = brolls[i];
            const bLocal = `/tmp/broll_${chatId}_${i}_${Date.now()}.mp4`;
            await downloadFile(broll.url, bLocal);
            downloadedPaths.push(bLocal);
            broll.localPath = bLocal; // Set localPath for composeVideo
        }

        // 5. Compose Video (Local FFmpeg)
        await telegram.sendMessage(chatId, "🎬 Composing final video...");
        const finalVideoPath = await composeVideo(chatId, aRollLocal, brolls, editPlan);
        downloadedPaths.push(finalVideoPath);

        // 6. Generate Caption
        await telegram.sendMessage(chatId, "✍️ Generating viral caption...");
        const viralCaption = await generateCaption(rawCaption, transcription);

        // 7. Send Result to User
        await telegram.sendMessage(chatId, "🚀 Uploading your masterpiece!");
        await telegram.sendVideo(chatId, finalVideoPath, viralCaption);

        await telegram.sendMessage(chatId, "✅ Video sent! Use /start (or send a new voice note) to make another.");

    } finally {
        // Cleanup temporary files
        await cleanupFiles(downloadedPaths);
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { transcribeAudio } = require('./pipeline/transcribe');
const { generateARoll } = require('./pipeline/generateAroll');
const { analyzeBRoll } = require('./pipeline/analyzeBroll');
const { composeVideo } = require('./pipeline/composeVideo');
const { generateCaption } = require('./pipeline/generateCaption');

// Helper to simulate URL upload if needed, but Replicate accepts data URIs
// or we can use a service like ngrok if we had a local server.
// However, since we want to touch the scripts as little as possible:
// The pipeline functions *currently* expect URLs for audio and A-roll source.

// To test locally without changing the core scripts (which use Axios to fetch URLs),
// we need to pass URLs. We can use fal.ai or replicate data URIs for files.

const axios = require('axios');
const FormData = require('form-data');

async function fileToPublicUrl(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
    });

    const pageUrl = res.data.data.url;
    // tmpfiles.org provides a landing page URL. We can get the direct file URL by inserting '/dl/'
    const directUrl = pageUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    return directUrl;
}

async function runLocalTest() {
    const assetsDir = path.join(__dirname, '../assets');
    const tmpDir = path.join(__dirname, '../tmp');

    // Clean and recreate tmp folder for local test
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    // Replace these with the actual files from your assets folder
    const audioFile = path.join(assetsDir, '2026-03-06 14.05.59.ogg');
    // Use the MOV file for A-Roll since pixverse/lipsync expects a video, not an image
    const aRollSourceFile = path.join(assetsDir, 'IMG_0497.MOV');
    const bRollFile = path.join(assetsDir, 'IMG_0497.MOV');

    console.log('--- Starting Local Pipeline Test ---');

    const chatId = 'local-test';
    const rawCaption = 'This is a test run locally without Telegram.';

    try {
        // Use native Replicate API to upload local files safely and generate internal URLs
        console.log('Uploading local files directly to Replicate cloud...');
        const Replicate = require('replicate');
        const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

        console.log('  -> Uploading voice note...');
        const audioBuffer = await fs.promises.readFile(audioFile);
        const audioUpload = await replicate.files.create(audioBuffer);

        console.log('  -> Uploading A-Roll video...');
        const aRollBuffer = await fs.promises.readFile(aRollSourceFile);
        const aRollUpload = await replicate.files.create(aRollBuffer);

        const audioUri = audioUpload.urls.get;
        const aRollSourceUri = aRollUpload.urls.get;

        console.log('Audio URL:', audioUri);
        console.log('A-Roll Source URL:', aRollSourceUri);

        // 1. Transcribe Audio
        console.log('\n[1/6] 🗣️ Transcribing audio...');
        const transcription = await transcribeAudio(audioUri);
        fs.writeFileSync(path.join(tmpDir, 'transcription.json'), JSON.stringify(transcription, null, 2));
        console.log('Transcription saved to tmp/transcription.json');

        // 2. Generate A-Roll Video
        console.log('\n[2/6] 🤖 Generating A-Roll talking head...');
        const aRollUrl = await generateARoll(audioUri, aRollSourceUri);
        fs.writeFileSync(path.join(tmpDir, 'aroll_url.txt'), aRollUrl);
        console.log('A-Roll URL:', aRollUrl);

        // 3. Download A-Roll locally
        console.log('\n[3/6] 📥 Downloading A-Roll locally...');
        const { downloadFile } = require('./utils/download');
        const aRollLocal = path.join(tmpDir, 'test_aroll.mp4');
        await downloadFile(aRollUrl, aRollLocal);
        console.log('A-Roll Saved ->', aRollLocal);

        // 4. Analyze B-Roll
        console.log('\n[4/6] 🧠 Analyzing B-Rolls & Planning Edit...');
        const brollClips = [{ url: "https://example.com/mock.mp4", duration: 5 }];
        const { brolls, editPlan } = await analyzeBRoll(brollClips, transcription);
        fs.writeFileSync(path.join(tmpDir, 'broll_analysis.json'), JSON.stringify({ brolls, editPlan }, null, 2));
        console.log('B-roll Analysis & Edit Plan saved to tmp/broll_analysis.json');

        // Map the local file to the analyzed b-roll for composition
        brolls[0].localPath = bRollFile;

        // 5. Compose Video (Local FFmpeg)
        console.log('\n[5/6] 🎬 Composing final video...');
        const finalVideoSystemPath = await composeVideo(chatId, aRollLocal, brolls, editPlan);
        const finalVideoPath = path.join(tmpDir, 'final_video.mp4');
        fs.copyFileSync(finalVideoSystemPath, finalVideoPath);
        console.log('Final Video Saved ->', finalVideoPath);

        // 6. Generate Caption
        console.log('\n[6/6] ✍️ Generating viral caption...');
        const viralCaption = await generateCaption(rawCaption, transcription);
        fs.writeFileSync(path.join(tmpDir, 'caption.txt'), viralCaption);
        console.log('\n--- FINAL CAPTION ---');
        console.log(viralCaption);
        console.log('\n✅ Local Test outputs have been completely saved to the /tmp folder!');

    } catch (err) {
        console.error('\n❌ PIpeline Test Failed:', err);
    }
}

runLocalTest();

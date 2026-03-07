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

    // Parse step argument (e.g., node src/test_local.js 1)
    const stepArg = process.argv.slice(2)[0];
    const stepToRun = stepArg ? parseInt(stepArg, 10) : null;

    // Clean and recreate tmp folder for local test ONLY if running all steps
    if (stepToRun === null) {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Replace these with the actual files from your assets folder
    const audioFile = path.join(assetsDir, 'test_audio.mp3');
    // Use the MOV file for A-Roll since pixverse/lipsync expects a video, not an image
    const aRollSourceFile = path.join(assetsDir, 'test_video.mp4');
    const bRollFile = path.join(assetsDir, 'test_video.mp4');

    console.log(`--- Starting Local Pipeline Test (Step: ${stepToRun !== null ? stepToRun : 'ALL'}) ---`);

    const chatId = 'local-test';
    const rawCaption = 'This is a test run locally without Telegram.';

    try {
        let audioUri, aRollSourceUri, bRollUri;
        const urlsFile = path.join(tmpDir, 'uploaded_urls.json');

        if (stepToRun === null || stepToRun === 0) {
            console.log('\n[0/7] ☁️ Uploading local files to Public URL (tmpfiles.org)...');

            console.log('  -> Uploading voice note...');
            audioUri = await fileToPublicUrl(audioFile);

            console.log('  -> Uploading A-Roll video...');
            aRollSourceUri = await fileToPublicUrl(aRollSourceFile);

            console.log('  -> Uploading B-Roll video...');
            bRollUri = await fileToPublicUrl(bRollFile);

            fs.writeFileSync(urlsFile, JSON.stringify({ audioUri, aRollSourceUri, bRollUri }, null, 2));
            console.log('Uploaded URLs saved to tmp/uploaded_urls.json');
            console.log('Audio:', audioUri);
            console.log('A-Roll:', aRollSourceUri);
            console.log('B-Roll:', bRollUri);
        } else if (fs.existsSync(urlsFile)) {
            const urls = JSON.parse(fs.readFileSync(urlsFile, 'utf8'));
            audioUri = urls.audioUri;
            aRollSourceUri = urls.aRollSourceUri;
            bRollUri = urls.bRollUri;
        }

        let transcription;
        const transcribeFile = path.join(tmpDir, 'transcription.json');

        if (stepToRun === null || stepToRun === 1) {
            console.log('\n[1/7] 🗣️ Transcribing audio...');
            transcription = await transcribeAudio(audioUri);
            fs.writeFileSync(transcribeFile, JSON.stringify(transcription, null, 2));
            console.log('Transcription saved to tmp/transcription.json');
        } else if (fs.existsSync(transcribeFile)) {
            transcription = JSON.parse(fs.readFileSync(transcribeFile, 'utf8'));
        }

        let aRollUrl;
        const aRollUrlFile = path.join(tmpDir, 'aroll_url.txt');

        if (stepToRun === null || stepToRun === 2) {
            console.log('\n[2/7] 🤖 Generating A-Roll talking head...');
            aRollUrl = await generateARoll(audioUri, aRollSourceUri);
            fs.writeFileSync(aRollUrlFile, aRollUrl);
            console.log('A-Roll URL:', aRollUrl);
        } else if (fs.existsSync(aRollUrlFile)) {
            aRollUrl = fs.readFileSync(aRollUrlFile, 'utf8');
        }

        let aRollLocal = path.join(tmpDir, 'test_aroll.mp4');

        if (stepToRun === null || stepToRun === 3) {
            console.log('\n[3/7] 📥 Downloading A-Roll locally...');
            const { downloadFile } = require('./utils/download');
            await downloadFile(aRollUrl, aRollLocal);
            console.log('A-Roll Saved ->', aRollLocal);
        }

        let brolls;
        const brollDescriptionFile = path.join(tmpDir, 'broll_descriptions.json');

        if (stepToRun === null || stepToRun === 4) {
            console.log('\n[4/7] 👁️ Describing B-Roll clips...');
            const { describeBRolls } = require('./pipeline/analyzeBroll');
            const brollClips = [{ url: bRollUri, duration: 5 }];
            brolls = await describeBRolls(brollClips);
            fs.writeFileSync(brollDescriptionFile, JSON.stringify(brolls, null, 2));
            console.log('B-roll Descriptions saved to tmp/broll_descriptions.json');
        } else if (fs.existsSync(brollDescriptionFile)) {
            brolls = JSON.parse(fs.readFileSync(brollDescriptionFile, 'utf8'));
        }

        let editPlan;
        const editPlanFile = path.join(tmpDir, 'edit_plan.json');

        if (stepToRun === null || stepToRun === 5) {
            console.log('\n[5/7] 🧠 Planning Edit...');
            const { planEdit } = require('./pipeline/analyzeBroll');
            editPlan = await planEdit(brolls, transcription);
            fs.writeFileSync(editPlanFile, JSON.stringify(editPlan, null, 2));
            console.log('Edit Plan saved to tmp/edit_plan.json');
        } else if (fs.existsSync(editPlanFile)) {
            editPlan = JSON.parse(fs.readFileSync(editPlanFile, 'utf8'));
        }

        if (brolls && brolls.length > 0) {
            brolls[0].localPath = bRollFile;
        }

        let finalVideoPath = path.join(tmpDir, 'final_video.mp4');

        if (stepToRun === null || stepToRun === 6) {
            console.log('\n[6/7] 🎬 Composing final video...');
            const finalVideoSystemPath = await composeVideo(chatId, aRollLocal, brolls, editPlan);
            fs.copyFileSync(finalVideoSystemPath, finalVideoPath);
            console.log('Final Video Saved ->', finalVideoPath);
        }

        let viralCaption;
        const captionFile = path.join(tmpDir, 'caption.txt');

        if (stepToRun === null || stepToRun === 7) {
            console.log('\n[7/7] ✍️ Generating viral caption...');
            viralCaption = await generateCaption(rawCaption, transcription);
            fs.writeFileSync(captionFile, viralCaption);
            console.log('\n--- FINAL CAPTION ---');
            console.log(viralCaption);
        } else if (fs.existsSync(captionFile)) {
            viralCaption = fs.readFileSync(captionFile, 'utf8');
        }

        if (stepToRun === null) {
            console.log('\n✅ Local Test outputs have been completely saved to the /tmp folder!');
        } else {
            console.log(`\n✅ Step ${stepToRun} completed successfully.`);
        }

    } catch (err) {
        console.error('\n❌ PIpeline Test Failed:', err);
    }
}

runLocalTest();

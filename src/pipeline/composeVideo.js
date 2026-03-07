const { execSync } = require('child_process');
const fs = require('fs');

function composeVideo(chatId, aRollPath, brollsWithLocalPaths, editPlan) {
    if (!aRollPath) throw new Error("Missing A-Roll local path for composition");
    if (!fs.existsSync(aRollPath)) throw new Error("A-Roll local file not found: " + aRollPath);

    // Step 1: Detect Durations
    const { getDuration } = require('../utils/duration');
    const aRollDuration = getDuration(aRollPath);
    console.log(`[Compose] A-Roll Duration: ${aRollDuration.toFixed(2)}s`);

    // Step 2: Build Input List & Sanitize Plan
    const inputs = [`-i "${aRollPath}"`];
    const planWithInputs = [];

    for (const plan of editPlan) {
        const clip = brollsWithLocalPaths[plan.clipIndex];
        if (clip && clip.localPath && fs.existsSync(clip.localPath)) {
            const inputIdx = inputs.length;
            inputs.push(`-i "${clip.localPath}"`);

            // Safety Check: Cap duration to the actual B-roll file length
            const actualBrollDuration = getDuration(clip.localPath);
            let sanitizedDuration = Math.min(plan.duration, actualBrollDuration);

            // Safety Check: Ensure no overlay goes past A-roll end
            if (plan.startTime + sanitizedDuration > aRollDuration) {
                sanitizedDuration = Math.max(0, aRollDuration - plan.startTime);
            }

            if (sanitizedDuration > 0) {
                planWithInputs.push({ ...plan, inputIdx, duration: sanitizedDuration });
            }
        }
    }

    // Step 3: Build Filter Complex
    let filterParts = [];
    let prevOutput = "[0:v]";
    let brollLayerIdx = 1;

    for (const plan of planWithInputs) {
        const scaledLabel = `scaled${plan.inputIdx}`;
        const outLabel = `layer${brollLayerIdx}`;

        filterParts.push(
            `[${plan.inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[${scaledLabel}]`
        );

        filterParts.push(
            `${prevOutput}[${scaledLabel}]overlay=0:0:enable='between(t,${plan.startTime},${plan.startTime + plan.duration})'[${outLabel}]`
        );

        prevOutput = `[${outLabel}]`;
        brollLayerIdx++;
    }

    const filterComplex = filterParts.join("; ");
    const outputFilePath = `/tmp/final_${chatId || Date.now()}.mp4`;

    // Step 3: Construct Full Command
    const ffmpegCommand = [
        "ffmpeg -y",
        inputs.join(" "),
        filterComplex ? `-filter_complex "${filterComplex}"` : "",
        `-map "${filterComplex ? prevOutput : '0:v'}"`,
        "-map 0:a",
        "-c:v libx264 -preset superfast -crf 23",
        "-c:a aac -b:a 128k",
        "-movflags +faststart",
        `-t ${aRollDuration}`, // Truncate to exact A-roll duration
        `"${outputFilePath}"`
    ].filter(Boolean).join(" ");

    // Step 4: Execute FFmpeg
    try {
        execSync(ffmpegCommand, { timeout: 120000, stdio: 'pipe' });
    } catch (err) {
        throw new Error(`FFmpeg execution failed: ${err.stderr?.toString() || err.message}`);
    }

    if (!fs.existsSync(outputFilePath)) {
        throw new Error(`FFmpeg did not produce output file: ${outputFilePath}`);
    }

    return outputFilePath;
}

module.exports = { composeVideo };

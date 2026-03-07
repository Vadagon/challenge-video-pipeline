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

            if (clip.type === 'photo') {
                // Loop the photo so it behaves like a video stream
                inputs.push(`-loop 1 -framerate 30 -i "${clip.localPath}"`);
            } else {
                inputs.push(`-i "${clip.localPath}"`);
            }

            // Safety Check: Cap duration to the actual B-roll file length (if video)
            const actualBrollDuration = clip.type === 'photo' ? plan.duration + 2 : getDuration(clip.localPath);
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
        const clip = brollsWithLocalPaths[plan.clipIndex];
        const scaledLabel = `scaled${plan.inputIdx}`;
        const outLabel = `layer${brollLayerIdx}`;

        if (clip.type === 'photo') {
            // Option B: Blurred Background + Full Fit with Zoom
            const bgLabel = `bg${plan.inputIdx}`;
            const fgLabel = `fg${plan.inputIdx}`;
            const mergedLabel = `merged${plan.inputIdx}`;

            // 1. Blurred, scaled-up background to fill 1080x1920
            filterParts.push(
                `[${plan.inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[${bgLabel}]`
            );
            // 2. Foreground photo fitted within 1080x1920 without cropping
            filterParts.push(
                `[${plan.inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=decrease[${fgLabel}]`
            );
            // 3. Merge them and apply a slow zoompan effect
            filterParts.push(
                `[${bgLabel}][${fgLabel}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[${mergedLabel}]`
            );
            filterParts.push(
                `[${mergedLabel}]zoompan=z='zoom+0.001':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=1:s=1080x1920:fps=30[${scaledLabel}]`
            );
        } else {
            // Standard Video Handling
            filterParts.push(
                `[${plan.inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[${scaledLabel}]`
            );
        }

        // Apply to main composition with eof_action=pass to prevent freezing on last frame!
        filterParts.push(
            `${prevOutput}[${scaledLabel}]overlay=0:0:enable='between(t,${plan.startTime},${plan.startTime + plan.duration})':eof_action=pass[${outLabel}]`
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

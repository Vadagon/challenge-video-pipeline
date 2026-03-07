const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Step 7: Compose the final video by overlaying B-roll clips onto the A-roll.
 *
 * By the time this runs, all B-roll clips (including photos pre-rendered in
 * step 5) are plain MP4 video files. No special photo handling needed here.
 *
 * Display style: Fit + Blurred Background
 *   — Each B-roll is scaled to fit entirely within the canvas (no cropping).
 *   — Any letterbox/pillarbox area is filled by a blurred copy of the same clip.
 *   — No forced zoom on videos (photos already have Ken Burns baked in).
 */
function composeVideo(chatId, aRollPath, brollsWithLocalPaths, editPlan) {
    if (!aRollPath) throw new Error("Missing A-Roll local path for composition");
    if (!fs.existsSync(aRollPath)) throw new Error("A-Roll local file not found: " + aRollPath);

    const { getDuration, getVideoSize } = require('../utils/duration');
    const aRollDuration = getDuration(aRollPath);
    const { width: CW, height: CH } = getVideoSize(aRollPath);
    console.log(`[Compose] A-Roll: ${aRollDuration.toFixed(2)}s @ ${CW}x${CH}`);

    // Build FFmpeg input list & sanitize each planned overlay
    const inputs = [`-i "${aRollPath}"`];
    const planWithInputs = [];

    for (const plan of editPlan) {
        const clip = brollsWithLocalPaths[plan.clipIndex];
        if (clip && clip.localPath && fs.existsSync(clip.localPath)) {
            const inputIdx = inputs.length;

            // Offset the input so the clip stream starts at its planned timestamp
            inputs.push(`-itsoffset ${plan.startTime} -i "${clip.localPath}"`);

            // Cap duration to available clip length
            const clipDuration = getDuration(clip.localPath);
            let sanitizedDuration = Math.min(plan.duration, clipDuration);

            // Never go past the end of the A-roll
            if (plan.startTime + sanitizedDuration > aRollDuration) {
                sanitizedDuration = Math.max(0, aRollDuration - plan.startTime);
            }

            if (sanitizedDuration > 0) {
                planWithInputs.push({ ...plan, inputIdx, duration: sanitizedDuration, clip });
            }
        }
    }

    // Build filter_complex: each clip → fit+blur composite → overlay on timeline
    let filterParts = [];
    let prevOutput = "[0:v]";
    let layerIdx = 1;

    for (const plan of planWithInputs) {
        const scaledLabel = `scaled${plan.inputIdx}`;
        const outLabel = `layer${layerIdx}`;

        const bgLabel = `bg${plan.inputIdx}`;
        const fgLabel = `fg${plan.inputIdx}`;
        const spLabel = `sp${plan.inputIdx}`;

        // 1. Split clip stream into two copies
        filterParts.push(`[${plan.inputIdx}:v]split=2[${spLabel}a][${spLabel}b]`);

        // 2. Background: scale-up to cover canvas + crop + blur
        filterParts.push(
            `[${spLabel}a]` +
            `scale=${CW}:${CH}:force_original_aspect_ratio=increase,` +
            `crop=${CW}:${CH},` +
            `boxblur=25:4` +
            `[${bgLabel}]`
        );

        // 3. Foreground: fit (contain) within canvas, no cropping
        filterParts.push(
            `[${spLabel}b]` +
            `scale=${CW}:${CH}:force_original_aspect_ratio=decrease,` +
            `pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:black@0,` +
            `setsar=1` +
            `[${fgLabel}]`
        );

        // 4. Composite: blurred bg + sharp fg centered
        filterParts.push(
            `[${bgLabel}][${fgLabel}]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[${scaledLabel}]`
        );

        // 5. Layer onto main timeline
        //    eof_action=pass: when the clip ends, it disappears cleanly (no freeze)
        filterParts.push(
            `${prevOutput}[${scaledLabel}]overlay=0:0:` +
            `enable='between(t,${plan.startTime},${plan.startTime + plan.duration})':` +
            `eof_action=pass[${outLabel}]`
        );

        prevOutput = `[${outLabel}]`;
        layerIdx++;
    }

    const filterComplex = filterParts.join("; ");
    const outputFilePath = `/tmp/final_${chatId || Date.now()}.mp4`;

    const ffmpegCommand = [
        "ffmpeg -y",
        inputs.join(" "),
        filterComplex ? `-filter_complex "${filterComplex}"` : "",
        `-map "${filterComplex ? prevOutput : '0:v'}"`,
        "-map 0:a",
        "-c:v libx264 -preset superfast -crf 23",
        "-c:a aac -b:a 128k",
        "-movflags +faststart",
        `-t ${aRollDuration}`,
        `"${outputFilePath}"`
    ].filter(Boolean).join(" ");

    console.log(`[Compose] Running FFmpeg...`);

    try {
        execSync(ffmpegCommand, { timeout: 300000, stdio: 'pipe' });
    } catch (err) {
        throw new Error(`FFmpeg execution failed: ${err.stderr?.toString() || err.message}`);
    }

    if (!fs.existsSync(outputFilePath)) {
        throw new Error(`FFmpeg did not produce output file: ${outputFilePath}`);
    }

    return outputFilePath;
}

module.exports = { composeVideo };

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');

const execAsync = promisify(exec);

/**
 * Step 7: Compose the final video by overlaying B-roll clips onto the A-roll.
 * Target format: 1080x1920 (Instagram Reels, YouTube Shorts, TikTok).
 *
 * By the time this runs, all B-roll clips (including photos pre-rendered in
 * step 5) are plain MP4 video files. No special photo handling needed here.
 *
 * Display style: Fit + Blurred Background
 *   — Each B-roll is scaled to fit entirely within the canvas (no cropping).
 *   — Any letterbox/pillarbox area is filled by a blurred copy of the same clip.
 *   — No forced zoom on videos (photos already have Ken Burns baked in).
 */
/**
 * Formats seconds into ASS time format: H:MM:SS.cc
 */
function formatAssTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const c = Math.floor((seconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
}

async function composeVideo(chatId, aRollPath, brollsWithLocalPaths, editPlan, headerText = "", transcription = null, captionsEnabled = true) {
    if (!aRollPath) throw new Error("Missing A-Roll local path for composition");
    if (!fs.existsSync(aRollPath)) throw new Error("A-Roll local file not found: " + aRollPath);

    const { getDuration } = require('../utils/duration');
    const aRollDuration = getDuration(aRollPath);
    // Explicitly target Instagram format.
    const CW = 1080;
    const CH = 1920;
    console.log(`[Compose] A-Roll: ${aRollDuration.toFixed(2)}s. Target: ${CW}x${CH}. Header: "${headerText}". Captions: ${captionsEnabled}`);

    if (aRollDuration <= 0) {
        throw new Error("Invalid A-Roll duration detected (0s).");
    }

    // Build FFmpeg input list & sanitize each planned overlay
    const inputs = [`-i "${aRollPath}"`];
    const planWithInputs = [];

    for (const plan of editPlan) {
        const clip = brollsWithLocalPaths[plan.clipIndex];
        if (clip && clip.localPath) {
            if (!fs.existsSync(clip.localPath)) {
                console.warn(`[Compose] Warning: Planned B-roll clip missing on disk: ${clip.localPath}`);
                continue;
            }
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

    const outputFilePath = `/tmp/final_${chatId || Date.now()}.mp4`;
    let subtitlePath = null;

    // Generate Subtitles if enabled and transcription available
    if (captionsEnabled && transcription && transcription.segments) {
        subtitlePath = `/tmp/subtitles_${chatId || Date.now()}.ass`;
        const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${CW}
PlayResY: ${CH}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,50,50,150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
        let assEvents = "";
        for (const seg of transcription.segments) {
            const start = formatAssTime(seg.start);
            const end = formatAssTime(seg.end);
            const text = seg.text.replace(/\n/g, "\\N").trim();
            if (text) {
                assEvents += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
            }
        }
        fs.writeFileSync(subtitlePath, assHeader + assEvents);
        console.log(`[Compose] Subtitles generated at ${subtitlePath}`);
    }

    // Build filter_complex: each clip → fit+blur composite → overlay on timeline
    let filterParts = [];

    // Scale the base A-Roll to exact 1080x1920 first
    filterParts.push(`[0:v]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH}[base]`);

    let prevOutput = "[base]";

    // If there are B-rolls, layer them
    if (planWithInputs.length > 0) {
        let layerIdx = 1;
        for (const plan of planWithInputs) {
            const scaledLabel = `scaled${plan.inputIdx}`;
            const outLabel = `layer${layerIdx}`;

            const bgLabel = `bg${plan.inputIdx}`;
            const fgLabel = `fg${plan.inputIdx}`;
            const spLabel = `sp${plan.inputIdx}`;

            // 1. Split clip stream into two copies
            filterParts.push(`[${plan.inputIdx}:v]split=2[${spLabel}a][${spLabel}b]`);

            // 2. Background: scale-up to cover canvas + crop + lighter blur for performance
            filterParts.push(
                `[${spLabel}a]` +
                `scale=${CW}:${CH}:force_original_aspect_ratio=increase,` +
                `crop=${CW}:${CH},` +
                `boxblur=15:2` + // Optimization: Fast blur
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
            filterParts.push(
                `${prevOutput}[${scaledLabel}]overlay=0:0:` +
                `enable='between(t,${plan.startTime},${plan.startTime + plan.duration})':` +
                `eof_action=pass[${outLabel}]`
            );

            prevOutput = `[${outLabel}]`;
            layerIdx++;
        }
    }

    // 6. Final Header Text Overlay (on top of everything)
    if (headerText) {
        const escapedHeader = headerText.replace(/'/g, "'\\''");
        const headerLabel = `header_v`;
        filterParts.push(`${prevOutput}drawtext=text='${escapedHeader}':fontcolor=white:fontsize=64:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:box=1:boxcolor=black@0.4:boxborderw=30:x=(w-tw)/2:y=200[${headerLabel}]`);
        prevOutput = `[${headerLabel}]`;
    }

    // 7. Apply Subtitles if they exist
    if (subtitlePath) {
        const subLabel = `subs_v`;
        filterParts.push(`${prevOutput}subtitles='${subtitlePath}':fontsdir=/usr/share/fonts/truetype/dejavu/[${subLabel}]`);
        prevOutput = `[${subLabel}]`;
    }

    const filterComplex = filterParts.join("; ");

    const ffmpegCommand = [
        "ffmpeg -y",
        inputs.join(" "),
        `-filter_complex "${filterComplex}"`,
        `-map "${prevOutput}"`,
        "-map 0:a", // Use audio from A-Roll (input 0)
        "-c:v libx264 -preset veryfast -crf 23 -profile:v baseline -level 3.0", // Performance & Mobile decode opt
        "-c:a aac -b:a 128k",
        "-movflags +faststart", // Crucial for immediate web playback
        `-t ${aRollDuration}`,
        `"${outputFilePath}"`
    ].join(" ");

    console.log(`[Compose] Running FFmpeg asynchronously...`);

    try {
        await execAsync(ffmpegCommand, { timeout: 300000 });
    } catch (err) {
        throw new Error(`FFmpeg execution failed: ${err.stderr || err.message}`);
    } finally {
        if (subtitlePath && fs.existsSync(subtitlePath)) {
            fs.unlinkSync(subtitlePath);
        }
    }

    if (!fs.existsSync(outputFilePath)) {
        throw new Error(`FFmpeg did not produce output file: ${outputFilePath}`);
    }

    return outputFilePath;
}

module.exports = { composeVideo };

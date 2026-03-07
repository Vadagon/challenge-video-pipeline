const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Step 5: Pre-render photo B-rolls as video clips with Ken Burns animation.
 *
 * For each b-roll clip that is a photo, this renders a proper MP4 video
 * (with blurred background + slow zoom-in) and updates the clip's localPath
 * to point to the rendered video. Video clips are passed through unchanged.
 *
 * Doing this in a dedicated step (instead of inline in composeVideo) means:
 *   — The composition step is simpler: no special photo handling
 *   — Pre-rendered clips can be inspected independently in tmp/
 *   — Zoompan failures are caught early, not during final composition
 *
 * @param {Array}  brolls    Array of b-roll descriptor objects (from describeBRolls)
 * @param {string} outDir    Directory to write rendered photo videos into
 * @param {object} canvas    { width, height } — the final video canvas size
 * @returns                  The same brolls array with photo localPaths updated to .mp4
 */
async function renderPhotoBrolls(brolls, outDir, canvas) {
    const { width: CW, height: CH } = canvas;

    for (let i = 0; i < brolls.length; i++) {
        const clip = brolls[i];

        // Only process photos that have a localPath on disk
        if (clip.type !== 'photo' || !clip.localPath || !fs.existsSync(clip.localPath)) {
            continue;
        }

        const inputPath = clip.localPath;
        const outputPath = path.join(outDir, `photo_broll_${i}.mp4`);
        const duration = clip.duration || 5; // seconds

        console.log(`\n[RenderPhoto] Rendering photo ${i}: ${path.basename(inputPath)} → ${path.basename(outputPath)}`);

        // Total frames with a small buffer so zoompan never runs dry
        const frames = Math.ceil((duration + 1.5) * 30);

        // FFmpeg filter chain:
        //  1. Scale to contain (fit within canvas), pad to canvas with black
        //  2. Zoompan: stable linear zoom (trunc(x/y) to prevent shakiness)
        //     — At frame 1: zoom=1.0 → full image visible (object-fit: contain)
        //     — As frames progress: zoom grows → image fills canvas (→ cover)
        //  3. Split: one copy → blurred background, one → sharp foreground
        //  4. Composite: blurred bg + sharp fg centered
        const filterComplex = [
            // 1. Contain + pad
            `[0:v]scale=${CW}:${CH}:force_original_aspect_ratio=decrease,` +
            `pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[padded]`,

            // 2. Ken Burns — linear zoom expression (no float drift), integer x/y (no shake)
            `[padded]zoompan=z='1+0.0008*on':` +
            `x='trunc(iw/2-(iw/zoom)/2)':` +
            `y='trunc(ih/2-(ih/zoom)/2)':` +
            `d=${frames}:s=${CW}x${CH}:fps=30[zp]`,

            // 3. Split into background + foreground copies
            `[zp]split=2[spa][spb]`,

            // 4. Background: scale up, crop, blur heavily
            `[spa]scale=${CW}:${CH}:force_original_aspect_ratio=increase,` +
            `crop=${CW}:${CH},boxblur=30:5[bg]`,

            // 5. Foreground: sharp (already CW×CH from zoompan)
            `[spb]copy[fg]`,

            // 6. Composite
            `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[out]`,
        ].join('; ');

        const cmd = [
            'ffmpeg -y',
            `-i "${inputPath}"`,
            `-filter_complex "${filterComplex}"`,
            `-map "[out]"`,
            `-c:v libx264 -preset superfast -crf 20`,
            `-pix_fmt yuv420p`,
            `-movflags +faststart`,
            `-t ${duration}`,
            `"${outputPath}"`,
        ].join(' ');

        try {
            execSync(cmd, { timeout: 120000, stdio: 'pipe' });
            console.log(`[RenderPhoto] ✅ Rendered → ${outputPath}`);

            // Update the clip so composeVideo treats it as a plain video
            clip.localPath = outputPath;
            clip.type = 'video'; // now a real video — no special handling needed
            clip.duration = duration;
        } catch (err) {
            console.error(`[RenderPhoto] ❌ Failed to render photo ${i}:`, err.stderr?.toString() || err.message);
            // Leave clip as-is — composeVideo will skip it if it fails to render
        }
    }

    return brolls;
}

module.exports = { renderPhotoBrolls };

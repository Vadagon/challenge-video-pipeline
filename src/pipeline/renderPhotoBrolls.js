const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Step 5: Pre-render photo B-rolls as video clips with Ken Burns animation.
 *
 * Approach:
 *  Background — raw image scaled to COVER canvas + blurred heavily (static, stable).
 *  Foreground — raw image upscaled 4x to match canvas aspect ratio, padded
 *               transparently to ensure a full "contain", and then animated using
 *               the `zoompan` filter. High-resolution scaling before `zoompan`
 *               prevents the infamous sub-pixel jitter/wobble associated with it.
 *
 *  At t=0  → full image visible, bordered by blurred bg       (object-fit: contain)
 *  As t→   → image grows inwards, transparent borders expand  (→ object-fit: cover)
 *
 * @param {Array}  brolls   B-roll descriptors from analyzeBroll
 * @param {string} outDir   Directory to write rendered clips to (e.g. tmp/)
 * @param {object} canvas   { width, height } of the final video canvas
 * @returns                 Same brolls array with photo localPaths updated to .mp4
 */
async function renderPhotoBrolls(brolls, outDir, canvas) {
    const { width: CW, height: CH } = canvas;

    for (let i = 0; i < brolls.length; i++) {
        const clip = brolls[i];

        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(clip.localPath || '');
        if ((clip.type !== 'photo' && !isImage) || !clip.localPath || !fs.existsSync(clip.localPath)) {
            continue;
        }

        const inputPath = clip.localPath;
        const outputPath = path.join(outDir, `photo_broll_${i}.mp4`);
        const duration = clip.duration || 5;

        console.log(`\n[RenderPhoto] ${path.basename(inputPath)} → ${path.basename(outputPath)} (${duration}s)`);

        //
        // Filter pipeline:
        //
        //   [looped photo stream]
        //       │
        //       ├─ split ─► [bg0] → scale COVER → crop → boxblur → [bg]  (static)
        //       │
        //       └─ [fg0] → scale CONTAIN → growing scale(t) → [fg]        (zoom)
        //
        //   [bg] + [fg] → overlay centered → [out]
        //
        // Why scale(t) instead of zoompan?
        //   zoompan wobbles because near zoom≈1.0 it repeatedly crops 1-2 pixel
        //   differences that get rescaled → visible jitter. scale=eval=frame is
        //   a direct mathematical per-frame computation with no accumulation error.
        //

        const filterComplex = [
            // 1. Split into two copies
            `[0:v]split=2[bg0][fg0]`,

            // 2. Background: fill canvas, crop to exact size, blur hard
            //    This provides the "pillarbox/letterbox" fill.
            `[bg0]scale=${CW}:${CH}:force_original_aspect_ratio=increase,` +
            `crop=${CW}:${CH},` +
            `setsar=1,` +
            `boxblur=35:5[bg]`,

            // 3. Foreground: Smooth, high-precision zoom.
            //    - format=yuva444p: Use high-precision pixel format internally.
            //    - scale: Upscale to 4x resolution proportional to the final rendering to avoid zoompan cropping.
            //    - pad: Fill transparent borders matching the 4x target aspect ratio, ensuring "contain" visuals.
            //    - zoompan: Apply slow, shaky-free zoom on the 4x transparent canvas using x/y formulas.
            `[fg0]format=yuva444p,` +
            `scale=${CW * 4}:${CH * 4}:force_original_aspect_ratio=decrease,` +
            `pad=${CW * 4}:${CH * 4}:-1:-1:color=black@0,` +
            `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 30) + 60}:s=${CW}x${CH}:fps=30,` +
            `setsar=1[fg]`,

            // 4. Composite: blurred bg behind sharp transparent-padded fg
            `[bg][fg]overlay=0:0[out]`,
        ].join('; ');

        const cmd = [
            'ffmpeg -y',
            // Feed as a 30fps video stream — required for `t` to work in scale filter
            `-framerate 30 -loop 1 -i "${inputPath}"`,
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
            console.log(`[RenderPhoto] ✅ Done → ${outputPath}`);

            // Swap type to 'video' so composeVideo treats it as a plain clip
            clip.localPath = outputPath;
            clip.type = 'video';
            clip.duration = duration;
        } catch (err) {
            console.error(
                `[RenderPhoto] ❌ Failed for photo ${i}:`,
                err.stderr?.toString().slice(-500) || err.message
            );
        }
    }

    return brolls;
}

module.exports = { renderPhotoBrolls };

const { execSync } = require('child_process');

/**
 * Get duration of a media file in seconds using ffprobe
 */
function getDuration(filePath) {
    try {
        const output = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf8' }
        ).trim();
        return parseFloat(output) || 0;
    } catch (err) {
        console.error(`Failed to get duration for ${filePath}:`, err.message);
        return 0;
    }
}

/**
 * Get the width and height of a video file using ffprobe.
 * Returns { width, height }, falling back to 1080x1920 if detection fails.
 */
function getVideoSize(filePath) {
    try {
        const output = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filePath}"`,
            { encoding: 'utf8' }
        ).trim();
        const [w, h] = output.split(',').map(Number);
        if (w && h) return { width: w, height: h };
    } catch (err) {
        console.error(`Failed to get video size for ${filePath}:`, err.message);
    }
    return { width: 1080, height: 1920 }; // sensible default
}

module.exports = { getDuration, getVideoSize };


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

module.exports = { getDuration };

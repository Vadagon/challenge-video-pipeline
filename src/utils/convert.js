const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Convert an audio file to MP3 format using ffmpeg.
 * @param {string} inputPath - Path to the input audio file
 * @param {string} outputPath - Path to write the MP3 output
 */
async function convertToMp3(inputPath, outputPath) {
    await execAsync(
        `ffmpeg -y -i "${inputPath}" -acodec libmp3lame -ar 44100 -ab 192k "${outputPath}"`,
        { timeout: 60000 }
    );
    return outputPath;
}

/**
 * Convert a video file to MP4 (H.264/AAC) format using ffmpeg.
 * @param {string} inputPath - Path to the input video file
 * @param {string} outputPath - Path to write the MP4 output
 */
async function convertToMp4(inputPath, outputPath) {
    await execAsync(
        `ffmpeg -y -i "${inputPath}" -vcodec libx264 -acodec aac -movflags faststart -pix_fmt yuv420p "${outputPath}"`,
        { timeout: 120000 }
    );
    return outputPath;
}

module.exports = { convertToMp3, convertToMp4 };

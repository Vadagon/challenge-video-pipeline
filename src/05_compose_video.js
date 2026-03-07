// NODE: Compose Final Video (Local FFmpeg)
// Generates an FFmpeg command to composite b-roll over the talking head,
// executes it locally, and passes the output file path forward.
// Assumes FFmpeg is installed in the n8n environment.

const { execSync } = require('child_process');
const fs = require('fs');

const { chatId, aRollUrl, brolls, rawCaption, transcription, editPlan } = $input.first().json;

if (!aRollUrl) throw new Error("Missing A-Roll URL for composition");

// ── Step 1: Build Input List ──────────────────────────────────────────────
const inputs = [`-i "${aRollUrl}"`];
const planWithInputs = [];

for (const plan of editPlan) {
  const clip = brolls[plan.clipIndex];
  if (clip) {
    const inputIdx = inputs.length;
    inputs.push(`-i "${clip.url}"`);
    planWithInputs.push({ ...plan, inputIdx });
  }
}

// ── Step 2: Build Filter Complex ──────────────────────────────────────────
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

// ── Step 3: Construct Full Command ────────────────────────────────────────
const ffmpegCommand = [
  "ffmpeg -y",
  inputs.join(" "),
  filterComplex ? `-filter_complex "${filterComplex}"` : "",
  `-map "${filterComplex ? prevOutput : '0:v'}"`,
  "-map 0:a",
  "-c:v libx264 -preset superfast -crf 23",
  "-c:a aac -b:a 128k",
  "-movflags +faststart",
  `-t 60`,
  `"${outputFilePath}"`
].filter(Boolean).join(" ");

// ── Step 4: Execute FFmpeg ────────────────────────────────────────────────
try {
  execSync(ffmpegCommand, { timeout: 120000, stdio: 'pipe' });
} catch (err) {
  throw new Error(`FFmpeg execution failed: ${err.stderr?.toString() || err.message}`);
}

if (!fs.existsSync(outputFilePath)) {
  throw new Error(`FFmpeg did not produce output file: ${outputFilePath}`);
}

return [{
  json: {
    chatId,
    outputFilePath,
    rawCaption,
    transcription,
    editPlan,
  },
}];

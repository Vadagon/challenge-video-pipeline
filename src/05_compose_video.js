// NODE: Compose Final Video
// Uses fal.ai ffmpeg-api (or video-merge) to composite b-roll over a-roll
// according to the edit plan.

const FAL_AI_API_KEY = "b58c67f2-94ec-4cfa-bfb7-158a15203b29:54446e43821d9169aba9d11b0f50f536";

const { chatId, aRollUrl, videos, rawCaption, transcription, editPlan } = $input.first().json;

// Build FFmpeg filter_complex command for overlaying b-roll at timestamps
// fal.ai exposes an ffmpeg endpoint: fal-ai/ffmpeg-api

// Construct inputs array: [0] = a-roll, [1..n] = b-roll clips
const inputs = [{ url: aRollUrl }];
for (const plan of editPlan) {
  const clip = videos[plan.clipIndex];
  if (clip) inputs.push({ url: clip.url });
}

// Build FFmpeg filter_complex for picture-in-picture / full replace
// We'll do full-frame b-roll overlay (replaces a-roll during b-roll windows)
let filterParts = [];
let currentInput = "[0:v]";
let currentAudio = "[0:a]";
let brollIdx = 1;

// Start with a-roll as base
filterParts.push(`[0:v]copy[base]`);
let prevOutput = "[base]";

for (const plan of editPlan) {
  const clip = videos[plan.clipIndex];
  if (!clip) continue;

  const inputIdx = brollIdx;
  brollIdx++;

  // Scale b-roll to match a-roll resolution
  filterParts.push(
    `[${inputIdx}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[broll${inputIdx}]`
  );

  // Overlay b-roll over a-roll at timestamp window
  const outLabel = `out${inputIdx}`;
  filterParts.push(
    `${prevOutput}[broll${inputIdx}]overlay=0:0:enable='between(t,${plan.startTime},${plan.startTime + plan.duration})'[${outLabel}]`
  );

  prevOutput = `[${outLabel}]`;
}

const filterComplex = filterParts.join("; ");

// Submit to fal.ai ffmpeg endpoint
const submitResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://queue.fal.run/fal-ai/ffmpeg-api/compose",
  headers: {
    Authorization: `Key ${FAL_AI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    inputs: inputs,
    filter_complex: filterComplex,
    output_options: {
      format: "mp4",
      video_codec: "libx264",
      audio_codec: "aac",
      map_video: prevOutput,
      map_audio: "[0:a]",
    },
  }),
});

const requestId = submitResp.request_id;
if (!requestId) {
  // Fallback: return the a-roll as final video if composition fails
  console.log("FFmpeg compose failed, returning a-roll as final:", JSON.stringify(submitResp));
  return [{
    json: {
      chatId,
      finalVideoUrl: aRollUrl,
      rawCaption,
      transcription,
      editPlan,
      compositionNote: "B-roll composition unavailable; returning a-roll only",
    },
  }];
}

// Poll for completion
let finalVideoUrl = null;
for (let i = 0; i < 36; i++) {
  await new Promise((r) => setTimeout(r, 5000));

  const statusResp = await this.helpers.httpRequest({
    method: "GET",
    url: `https://queue.fal.run/fal-ai/ffmpeg-api/compose/requests/${requestId}/status`,
    headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
  });

  if (statusResp.status === "COMPLETED") {
    const resultResp = await this.helpers.httpRequest({
      method: "GET",
      url: `https://queue.fal.run/fal-ai/ffmpeg-api/compose/requests/${requestId}`,
      headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
    });
    finalVideoUrl = resultResp.video?.url || resultResp.output_url || resultResp.url;
    break;
  }

  if (statusResp.status === "FAILED") {
    // Fallback to a-roll only
    finalVideoUrl = aRollUrl;
    break;
  }
}

if (!finalVideoUrl) finalVideoUrl = aRollUrl; // timeout fallback

return [{
  json: {
    chatId,
    finalVideoUrl,
    rawCaption,
    transcription,
    editPlan,
  },
}];

// NODE: Generate A-Roll via Replicate (Pixverse Lip-sync)
// Uses the first video from the session as the talking head (A-roll).
// Lipsyncs it with the provided audio via Replicate.

const REPLICATE_API_TOKEN = "r8_cYkGtnlW5dT9h0e6aThUBTtP1mhZ3Y33AgHUy";

const { chatId, audioUrl, videos, rawCaption, transcription } = $input.first().json;

if (!videos || videos.length === 0) {
  throw new Error("No videos found in session. Need at least one for A-Roll.");
}

// First video in the list is the A-roll
const aRollSource = videos[0].url;

// ── STEP 1: Submit Prediction to Replicate ──────────────────────────────
const submitResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://api.replicate.com/v1/models/pixverse/lipsync/predictions",
  headers: {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: {
    input: {
      video: aRollSource,
      audio: audioUrl,
    },
  },
});

const predictionId = submitResp.id;
const pollUrl = submitResp.urls.get;

if (!predictionId || !pollUrl) {
  throw new Error("Replicate did not return prediction information: " + JSON.stringify(submitResp));
}

// ── STEP 2: Poll for completion ─────────────────────────────────────────
let aRollUrl = null;
for (let i = 0; i < 60; i++) { // Max 10 minutes (Replicate can be slow)
  await new Promise((r) => setTimeout(r, 10000)); // Poll every 10s

  const statusResp = await this.helpers.httpRequest({
    method: "GET",
    url: pollUrl,
    headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
  });

  if (statusResp.status === "succeeded") {
    // Replicate output for pixverse/lipsync is usually the video URL string
    aRollUrl = statusResp.output;
    break;
  }

  if (statusResp.status === "failed") {
    throw new Error("Replicate prediction failed: " + (statusResp.error || JSON.stringify(statusResp)));
  }

  if (statusResp.status === "canceled") {
    throw new Error("Replicate prediction was canceled.");
  }
}

if (!aRollUrl) {
  throw new Error("Timeout waiting for Replicate lip-sync result");
}

return [{
  json: {
    chatId,
    aRollUrl,
    videos, // Keep all videos, first is A-Roll source, others are B-Roll
    rawCaption,
    transcription,
  },
}];

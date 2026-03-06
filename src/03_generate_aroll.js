// NODE: Generate A-Roll via fal.ai (Sync Lipsync 2 Pro)
// High-quality lip-sync for both images and videos.
// Sync Lipsync 2 Pro supports images as visual input directly (passed to video_url).

const FAL_AI_API_KEY = "b58c67f2-94ec-4cfa-bfb7-158a15203b29:54446e43821d9169aba9d11b0f50f536";

const { chatId, audioUrl, subjectUrl, videos, rawCaption, transcription } = $input.first().json;

// ── STEP 1: Submit Lip-sync Job ──────────────────────────────────────────
// We pass the subject (Photo or Video) directly to video_url
const submitResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://queue.fal.run/fal-ai/sync-lipsync/v2/pro",
  headers: {
    Authorization: `Key ${FAL_AI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: {
    video_url: subjectUrl,
    audio_url: audioUrl,
  },
});

const statusUrl = submitResp.status_url;
const responseUrl = submitResp.response_url;

if (!statusUrl) {
  throw new Error("fal.ai did not return required queue URLs: " + JSON.stringify(submitResp));
}

// ── STEP 2: Poll for completion ─────────────────────────────────────────
let aRollUrl = null;
for (let i = 0; i < 48; i++) { // Max 4 minutes (high quality takes longer)
  await new Promise((r) => setTimeout(r, 5000));

  const statusResp = await this.helpers.httpRequest({
    method: "GET",
    url: statusUrl,
    headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
  });

  if (statusResp.status === "COMPLETED") {
    const resultResp = await this.helpers.httpRequest({
      method: "GET",
      url: responseUrl,
      headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
    });

    // Check possible response paths
    aRollUrl = resultResp.video?.url || resultResp.output?.video_url || resultResp.video_url || resultResp.url;
    break;
  }

  if (statusResp.status === "FAILED") {
    throw new Error("Sync Lipsync 2 Pro job failed: " + JSON.stringify(statusResp));
  }
}

if (!aRollUrl) {
  throw new Error("Timeout waiting for Lip-sync result");
}

return [{
  json: {
    chatId,
    aRollUrl,
    videos,
    rawCaption,
    transcription,
  },
}];

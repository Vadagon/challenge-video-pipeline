// NODE: Transcribe Audio
// Sends the Telegram voice note URL to fal.ai Whisper for transcription
// Uses fal-ai/whisper which accepts a direct audio URL — no download needed

const FAL_AI_API_KEY = "b58c67f2-94ec-4cfa-bfb7-158a15203b29:54446e43821d9169aba9d11b0f50f536";

const { audioUrl, chatId, photoUrl, videos, rawCaption } = $input.first().json;

// Submit transcription job to fal.ai Whisper (supports Telegram .ogg files)
const submitResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://queue.fal.run/fal-ai/whisper",
  headers: {
    Authorization: `Key ${FAL_AI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    audio_url: audioUrl,
    task: "transcribe",
    language: "en",
    chunk_level: "segment",
    version: "3",
  }),
});

const requestId = submitResp.request_id;
if (!requestId) {
  throw new Error("fal.ai Whisper did not return a request_id: " + JSON.stringify(submitResp));
}

// Poll until complete (max 2 minutes)
let transcription = "";
for (let i = 0; i < 24; i++) {
  await new Promise((r) => setTimeout(r, 5000));

  const statusResp = await this.helpers.httpRequest({
    method: "GET",
    url: `https://queue.fal.run/fal-ai/whisper/requests/${requestId}/status`,
    headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
  });

  if (statusResp.status === "COMPLETED") {
    const resultResp = await this.helpers.httpRequest({
      method: "GET",
      url: `https://queue.fal.run/fal-ai/whisper/requests/${requestId}`,
      headers: { Authorization: `Key ${FAL_AI_API_KEY}` },
    });
    // fal.ai Whisper returns: { text: "...", chunks: [...] }
    transcription = resultResp.text || resultResp.transcription || "";
    break;
  }

  if (statusResp.status === "FAILED") {
    throw new Error("fal.ai Whisper transcription failed: " + JSON.stringify(statusResp));
  }
}

if (!transcription) {
  throw new Error("Timeout waiting for Whisper transcription result");
}

return [{
  json: {
    chatId,
    audioUrl,
    photoUrl,
    videos,
    rawCaption,
    transcription,
  },
}];

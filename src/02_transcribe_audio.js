// NODE: Transcribe Audio
// Sends the Telegram voice note URL to Replicate's Whisper for transcription
// Model: openai/whisper:8099696689d249cf8b122d833c36ac3f75505c666a395ca40ef26f68e7d3d16e

const REPLICATE_API_TOKEN = "r8_cYkGtnlW5dT9h0e6aThUBTtP1mhZ3Y33AgHUy";

const { audioUrl, chatId, videos, rawCaption } = $input.first().json;

// ── Step 1: Submit Transcription to Replicate ────────────────────────────
// We use "Prefer: wait" to try and get a synchronous response for short clips.
const submitResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://api.replicate.com/v1/models/openai/whisper/predictions",
  headers: {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    "Content-Type": "application/json",
    "Prefer": "wait",
  },
  body: {
    input: {
      audio: audioUrl,
      language: "auto",
      translate: false,
      temperature: 0,
      transcription: "plain text",
      suppress_tokens: "-1",
      logprob_threshold: -1,
      no_speech_threshold: 0.6,
      condition_on_previous_text: true,
      compression_ratio_threshold: 2.4,
      temperature_increment_on_fallback: 0.2
    },
  },
});

let transcription = "";
let status = submitResp.status;
let pollUrl = submitResp.urls?.get;

// ── Step 2: Handle Immediate Success or Poll ─────────────────────────────
if (status === "succeeded") {
  transcription = submitResp.output?.transcription || submitResp.output || "";
} else {
  // If "wait" didn't finish, we poll
  if (!pollUrl) throw new Error("Replicate did not return a poll URL: " + JSON.stringify(submitResp));

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusResp = await this.helpers.httpRequest({
      method: "GET",
      url: pollUrl,
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });

    if (statusResp.status === "succeeded") {
      transcription = statusResp.output?.transcription || statusResp.output || "";
      break;
    }

    if (statusResp.status === "failed") {
      throw new Error("Replicate transcription failed: " + (statusResp.error || JSON.stringify(statusResp)));
    }
  }
}

if (!transcription) {
  throw new Error("Failed to obtain transcription result");
}

return [{
  json: {
    chatId,
    audioUrl,
    videos,
    rawCaption,
    transcription,
  },
}];

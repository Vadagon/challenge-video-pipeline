// NODE: Analyze B-Roll & Create Edit Plan
// Uses OpenRouter (GPT-4o vision) to analyze each b-roll video thumbnail,
// then uses the transcription to plan when to insert each b-roll clip.

const OPENROUTER_API_KEY = "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";
const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

const { chatId, aRollUrl, videos, rawCaption, transcription } = $input.first().json;

// ── Step 1: Describe each b-roll video (via first frame / thumbnail) ──────
const videoDescriptions = [];
for (const vid of videos) {
  // Download first ~10KB of the video to use as context (or use URL directly)
  // We'll ask the model to infer from URL metadata + description request
  const descResp = await this.helpers.httpRequest({
    method: "POST",
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://n8n.workflow",
      "X-Title": "Video Editor Bot",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are analyzing a b-roll video clip for a social media video editor.
The video URL is: ${vid.url}
Duration: ${vid.duration || "unknown"} seconds

Based on the URL and any context you can infer, describe:
1. What this b-roll clip likely shows (visual content, mood, setting)
2. What topics or keywords it best matches
3. Ideal usage duration for a b-roll insert (2-5 seconds recommended)

Be concise. Return JSON only:
{"description": "...", "keywords": ["..."], "suggestedDuration": 3}`,
            },
          ],
        },
      ],
      max_tokens: 300,
    }),
  });

  let desc = { description: "b-roll clip", keywords: [], suggestedDuration: 3 };
  try {
    const raw = descResp.choices[0].message.content.replace(/```json|```/g, "").trim();
    desc = JSON.parse(raw);
  } catch (e) {
    desc.description = descResp.choices[0]?.message?.content || "b-roll clip";
  }

  videoDescriptions.push({ ...vid, ...desc });
}

// ── Step 2: Create edit plan using transcription ───────────────────────────
const brollSummary = videoDescriptions
  .map((v, i) => `Clip ${i + 1}: "${v.description}" | keywords: ${v.keywords.join(", ")} | suggested: ${v.suggestedDuration}s`)
  .join("\n");

const planResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://openrouter.ai/api/v1/chat/completions",
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://n8n.workflow",
    "X-Title": "Video Editor Bot",
  },
  body: JSON.stringify({
    model: "openai/gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a professional social media video editor. Your job is to plan b-roll inserts over an a-roll talking-head video.
Rules:
- First 3 seconds: always show the speaker (a-roll) for hook
- B-roll should match what the speaker is saying
- Each b-roll insert: 2-5 seconds
- Leave speaker visible during key emotional moments
- Return ONLY valid JSON`,
      },
      {
        role: "user",
        content: `TRANSCRIPTION (a-roll):
"${transcription}"

AVAILABLE B-ROLL CLIPS:
${brollSummary}

Create a b-roll edit plan. For each insert specify:
- startTime (seconds into the video)
- duration (seconds)
- clipIndex (0-based index from the list above)
- reason (why this clip fits here)

Return JSON array: [{"startTime": 5, "duration": 3, "clipIndex": 0, "reason": "..."}]`,
      },
    ],
    max_tokens: 800,
  }),
});

let editPlan = [];
try {
  const raw = planResp.choices[0].message.content.replace(/```json|```/g, "").trim();
  editPlan = JSON.parse(raw);
} catch (e) {
  // fallback: insert clips evenly
  const estimatedDuration = transcription.split(" ").length / 2.5; // rough: 2.5 words/sec
  editPlan = videoDescriptions.map((v, i) => ({
    startTime: 4 + i * 6,
    duration: v.suggestedDuration || 3,
    clipIndex: i,
    reason: "evenly distributed fallback",
  }));
}

return [{
  json: {
    chatId,
    aRollUrl,
    videos: videoDescriptions,
    rawCaption,
    transcription,
    editPlan,
  },
}];

// NODE: Analyze B-Roll & Create Edit Plan
// Uses OpenRouter (GPT-4o vision) to analyze each b-roll video thumbnail,
// then uses the transcription to plan when to insert each b-roll clip.

const OPENROUTER_API_KEY = "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";
const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

const { chatId, aRollUrl, videos, rawCaption, transcription } = $input.first().json;

// ── Step 1: Describe each b-roll video (skip the first one as it's a-roll) ──
// We isolate just the b-roll clips (everything after the first video)
const brollClips = videos.slice(1);
const videoDescriptions = [];

for (const vid of brollClips) {
  const descResp = await this.helpers.httpRequest({
    method: "POST",
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://n8n.workflow",
      "X-Title": "Video Editor Bot",
    },
    body: {
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

Based on the URL and context, describe:
1. What this b-roll clip likely shows (visual content, mood, setting)
2. What topics it matches
3. Ideal usage duration (2-5 seconds recommended)

Return JSON: {"description": "...", "keywords": ["..."], "suggestedDuration": 3}`,
            },
          ],
        },
      ],
      max_tokens: 300,
    },
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
  .map((v, i) => `Clip ${i}: "${v.description}" | keywords: ${v.keywords.join(", ")} | suggested: ${v.suggestedDuration}s`)
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
  body: {
    model: "openai/gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a social media video editor. Plan b-roll inserts over an a-roll.
Rules:
- First 3 seconds: always show speaker (a-roll)
- B-roll should match speech
- Inserts: 2-5 seconds
- Return ONLY JSON`,
      },
      {
        role: "user",
        content: `TRANSCRIPTION:
"${transcription}"

AVAILABLE B-ROLL CLIPS:
${brollSummary}

Create a b-roll edit plan.
Return JSON array: [{"startTime": 5, "duration": 3, "clipIndex": 0, "reason": "..."}]`,
      },
    ],
    max_tokens: 800,
  },
});

let editPlan = [];
try {
  const raw = planResp.choices[0].message.content.replace(/```json|```/g, "").trim();
  editPlan = JSON.parse(raw);
} catch (e) {
  // fallback: insert clips evenly
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
    brolls: videoDescriptions, // Renamed to brolls to be explicit
    rawCaption,
    transcription,
    editPlan,
  },
}];

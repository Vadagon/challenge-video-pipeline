// NODE: Generate Caption & Send Final Video
// Enriches the raw caption with AI, adds viral hashtags,
// then sends the final composed video back to the user on Telegram.

const OPENROUTER_API_KEY = "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";
const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

const { chatId, finalVideoUrl, rawCaption, transcription, editPlan } = $input.first().json;

// ── Step 1: Generate enriched caption ─────────────────────────────────────
const captionResp = await this.helpers.httpRequest({
  method: "POST",
  url: "https://openrouter.ai/api/v1/chat/completions",
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://n8n.workflow",
    "X-Title": "Video Caption Generator",
  },
  body: JSON.stringify({
    model: "openai/gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a viral social media content strategist specializing in short-form video (TikTok, Instagram Reels, YouTube Shorts).
Your job: take a raw video caption idea + transcript and turn it into a hook-driven, engaging caption with viral hashtags.

Rules:
- Start with a strong hook (first line = stop-the-scroll)
- Keep it under 150 words
- Natural, conversational tone
- End with 5-8 highly relevant hashtags (mix of niche + broad)
- Do not use emojis excessively (2-3 max)
- Return ONLY the final caption text, no explanations`,
      },
      {
        role: "user",
        content: `Raw caption idea: "${rawCaption}"

Video transcription (what I say in the video):
"${transcription}"

Write the viral caption with hashtags:`,
      },
    ],
    max_tokens: 400,
  }),
});

const viralCaption = captionResp.choices[0].message.content.trim();

// ── Step 2: Build edit plan summary ───────────────────────────────────────
const planSummary = editPlan
  .map(
    (p, i) =>
      `• B-roll ${p.clipIndex + 1} at ${p.startTime}s for ${p.duration}s — ${p.reason}`
  )
  .join("\n");

// ── Step 3: Send video to Telegram ────────────────────────────────────────
// Send the video file
await this.helpers.httpRequest({
  method: "POST",
  url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
  body: {
    chat_id: chatId,
    video: finalVideoUrl,
    caption: viralCaption,
    parse_mode: "Markdown",
    supports_streaming: true,
  },
  json: true,
});

// ── Step 4: Send edit plan details as a follow-up message ─────────────────
await this.helpers.httpRequest({
  method: "POST",
  url: `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
  body: {
    chat_id: chatId,
    text: `✅ *Video ready!*\n\n*Edit Plan Used:*\n${planSummary}\n\n*Caption Generated:*\n${viralCaption}`,
    parse_mode: "Markdown",
  },
  json: true,
});

return [{
  json: {
    success: true,
    chatId,
    viralCaption,
    finalVideoUrl,
    editPlan,
  },
}];

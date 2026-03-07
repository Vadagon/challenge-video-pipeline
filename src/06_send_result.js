// NODE: Generate Caption & Send Final Video
// Enriches the raw caption with AI, adds viral hashtags,
// then uploads the local video file to Telegram.

const { execSync } = require('child_process');
const fs = require('fs');

const OPENROUTER_API_KEY = "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";
const TELEGRAM_BOT_TOKEN = "8754596174:AAHVBRlpbtevRd0Lo55dK1rlleIyXJ6bXfc";

const { chatId, outputFilePath, rawCaption, transcription, editPlan } = $input.first().json;

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
  body: {
    model: "openai/gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are a viral social media content strategist specializing in short-form video (TikTok, Instagram Reels, YouTube Shorts).\nYour job: take a raw video caption idea + transcript and turn it into a hook-driven, engaging caption with viral hashtags.\n\nRules:\n- Start with a strong hook (first line = stop-the-scroll)\n- Keep it under 150 words\n- Natural, conversational tone\n- End with 5-8 highly relevant hashtags (mix of niche + broad)\n- Do not use emojis excessively (2-3 max)\n- Return ONLY the final caption text, no explanations",
      },
      {
        role: "user",
        content: `Raw caption idea: "${rawCaption}"\n\nVideo transcription (what I say in the video):\n"${transcription}"\n\nWrite the viral caption with hashtags:`,
      },
    ],
    max_tokens: 400,
  },
});

const viralCaption = captionResp.choices[0].message.content.trim();

// ── Step 2: Build edit plan summary ───────────────────────────────────────
const planSummary = editPlan
  .map(
    (p, i) =>
      `• B-roll ${p.clipIndex + 1} at ${p.startTime}s for ${p.duration}s — ${p.reason}`
  )
  .join("\n");

// ── Step 3: Upload video file to Telegram ─────────────────────────────────
// Write caption to a temp file to avoid shell-escaping issues with curl
const captionFile = `/tmp/caption_${chatId}.txt`;
fs.writeFileSync(captionFile, viralCaption);

try {
  const curlResult = execSync(
    `curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo" ` +
    `-F "chat_id=${chatId}" ` +
    `-F "video=@${outputFilePath}" ` +
    `-F "caption=<${captionFile}" ` +
    `-F "parse_mode=Markdown" ` +
    `-F "supports_streaming=true"`,
    { timeout: 60000 }
  ).toString();

  const parsed = JSON.parse(curlResult);
  if (!parsed.ok) {
    throw new Error(`Telegram API error: ${curlResult}`);
  }
} catch (err) {
  throw new Error(`Failed to send video to Telegram: ${err.message}`);
}

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

// ── Step 5: Clean up temp files ───────────────────────────────────────────
try { fs.unlinkSync(outputFilePath); } catch (e) { }
try { fs.unlinkSync(captionFile); } catch (e) { }

return [{
  json: {
    success: true,
    chatId,
    viralCaption,
    editPlan,
  },
}];

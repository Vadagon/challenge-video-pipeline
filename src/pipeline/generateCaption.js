const axios = require('axios');

async function generateCaption(rawCaption, transcription) {
    const token = process.env.OPENROUTER_API_KEY;
    if (!token) throw new Error("OPENROUTER_API_KEY missing");

    const captionResp = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
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
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://example.com/video-editor",
                "X-Title": "Video Caption Generator",
            }
        }
    );

    return captionResp.data.choices[0].message.content.trim();
}

module.exports = { generateCaption };

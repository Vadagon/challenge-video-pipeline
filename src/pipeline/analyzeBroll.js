const axios = require('axios');

async function analyzeBRoll(brollClips, transcription) {
    const token = process.env.OPENROUTER_API_KEY;
    if (!token) throw new Error("OPENROUTER_API_KEY missing");

    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://example.com/video-editor",
        "X-Title": "Video Editor Bot",
    };

    // Step 1: Describe each b-roll video
    const videoDescriptions = [];
    for (const vid of brollClips) {
        try {
            const descResp = await axios.post(
                "https://openrouter.ai/api/v1/chat/completions",
                {
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
                { headers }
            );

            let desc = { description: "b-roll clip", keywords: [], suggestedDuration: 3 };
            const content = descResp.data.choices[0].message.content;
            try {
                const raw = content.replace(/```json|```/g, "").trim();
                desc = JSON.parse(raw);
            } catch (e) {
                desc.description = content || "b-roll clip";
            }

            videoDescriptions.push({ ...vid, ...desc });
        } catch (err) {
            console.error("Failed to analyze b-roll clip", err.message);
            videoDescriptions.push({ ...vid, description: "b-roll clip", keywords: [], suggestedDuration: 3 });
        }
    }

    // Step 2: Create edit plan using transcription
    const brollSummary = videoDescriptions
        .map((v, i) => `Clip ${i}: "${v.description}" | keywords: ${v.keywords.join(", ")} | suggested: ${v.suggestedDuration}s`)
        .join("\n");

    let editPlan = [];
    try {
        const planResp = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
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
            { headers }
        );

        const raw = planResp.data.choices[0].message.content.replace(/```json|```/g, "").trim();
        editPlan = JSON.parse(raw);
    } catch (err) {
        console.error("Failed to generate edit plan", err.message);
        // fallback: insert clips evenly
        editPlan = videoDescriptions.map((v, i) => ({
            startTime: 4 + i * 6,
            duration: v.suggestedDuration || 3,
            clipIndex: i,
            reason: "evenly distributed fallback",
        }));
    }

    return { brolls: videoDescriptions, editPlan };
}

module.exports = { analyzeBRoll };

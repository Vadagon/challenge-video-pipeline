const { withRetry } = require('../utils/retry');

/**
 * Helper to get the OpenRouter SDK client.
 * Since the SDK is ESM-only, we use dynamic import.
 */
async function getOpenRouterClient() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

    // Dynamic import to handle ESM module in CJS
    const { OpenRouter } = await import("@openrouter/sdk");
    return new OpenRouter({ apiKey });
}

/**
 * Step 1: Describe each b-roll video clip using multimodal video analysis
 */
async function describeBRolls(brollClips) {
    const openrouter = await getOpenRouterClient();
    const videoDescriptions = [];

    for (const vid of brollClips) {
        try {
            console.log(`\n[AI] Analyzing B-Roll: ${vid.url}`);

            const fullContent = await withRetry(async () => {
                const stream = await openrouter.chat.send({
                    chatGenerationParams: {
                        model: "google/gemini-2.5-pro",
                        messages: [
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "text",
                                        text: `You are analyzing a b-roll video clip for a social media video editor.
Describe the following video clip in detail.
Topics: mood, setting, visual content, and duration.

Return ONLY a valid JSON object:
{
  "description": "detailed visual description",
  "keywords": ["tag1", "tag2"],
  "suggestedDuration": 3
}`
                                    },
                                    {
                                        type: "video_url",
                                        video_url: {
                                            url: vid.url
                                        }
                                    }
                                ]
                            }
                        ],
                        stream: true
                    }
                });

                let accumulated = "";
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content;
                    if (delta) {
                        accumulated += delta;
                        process.stdout.write(delta);
                    }
                }
                return accumulated;
            });

            let desc = { description: "b-roll clip", keywords: [], suggestedDuration: 3 };

            if (fullContent) {
                console.log(`\n[AI Response] Finished accumulation.`);
                try {
                    const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        desc = JSON.parse(jsonMatch[0]);
                    }
                } catch (e) {
                    console.warn("JSON Parse failed for clip description, using raw content");
                    desc.description = fullContent.replace(/```json|```/g, "").trim();
                }
            }

            videoDescriptions.push({ ...vid, ...desc });
        } catch (err) {
            console.error("\nFailed to analyze b-roll clip:", err.message);
            videoDescriptions.push({ ...vid, description: "b-roll clip", keywords: [], suggestedDuration: 3 });
        }
    }
    return videoDescriptions;
}

/**
 * Step 2: Create edit plan using transcription and descriptions
 */
async function planEdit(videoDescriptions, transcription) {
    const openrouter = await getOpenRouterClient();
    const brollSummary = videoDescriptions
        .map((v, i) => `Clip ${i}: "${v.description}" | keywords: ${v.keywords.join(", ")} | suggested: ${v.suggestedDuration}s`)
        .join("\n");

    const transcriptionText = typeof transcription === 'string' ? transcription : transcription.text;

    let editPlan = [];
    try {
        console.log(`\n[AI] Planning edit sequence...`);

        const fullContent = await withRetry(async () => {
            const stream = await openrouter.chat.send({
                chatGenerationParams: {
                    model: "google/gemini-2.5-pro",
                    messages: [
                        {
                            role: "system",
                            content: `You are a social media video editor. Plan b-roll inserts over an a-roll.
Rules:
- First 3 seconds: always show speaker (a-roll)
- B-roll should match speech
- Inserts: 2-5 seconds
- Return ONLY JSON`
                        },
                        {
                            role: "user",
                            content: `TRANSCRIPTION:
"${transcriptionText}"

AVAILABLE B-ROLL CLIPS:
${brollSummary}

Create a b-roll edit plan.
Return JSON array: [{"startTime": 5, "duration": 3, "clipIndex": 0, "reason": "..."}]`
                        }
                    ],
                    stream: true
                }
            });

            let accumulated = "";
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content;
                if (delta) {
                    accumulated += delta;
                    process.stdout.write(delta);
                }
            }
            return accumulated;
        });

        if (fullContent) {
            console.log(`\n[AI Plan Response] Finished accumulation.`);
            const raw = fullContent.replace(/```json|```/g, "").trim();
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            editPlan = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
        }
    } catch (err) {
        console.error("\nFailed to generate edit plan:", err.message);
        // fallback: insert clips evenly
        editPlan = videoDescriptions.map((v, i) => ({
            startTime: 4 + i * 6,
            duration: v.suggestedDuration || 3,
            clipIndex: i,
            reason: "evenly distributed fallback",
        }));
    }
    return editPlan;
}

async function analyzeBRoll(brollClips, transcription) {
    const brolls = await describeBRolls(brollClips);
    const editPlan = await planEdit(brolls, transcription);
    return { brolls, editPlan };
}

module.exports = { analyzeBRoll, describeBRolls, planEdit };

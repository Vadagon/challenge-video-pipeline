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
                                        text: `You are analyzing a b-roll media item (video clip or photo) for a social media video editor.
Describe the following media in detail.
Topics: mood, setting, visual content. If it's a video, also mention motion.

Return ONLY a valid JSON object:
{
  "description": "detailed visual description",
  "keywords": ["tag1", "tag2"],
  "suggestedDuration": 3
}`
                                    },
                                    {
                                        type: vid.type === "photo" ? "image_url" : "video_url",
                                        [vid.type === "photo" ? "imageUrl" : "videoUrl"]: {
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
        .map((v, i) => `Clip ${i}: "${v.description}" | keywords: ${v.keywords.join(", ")} | available duration: ${v.duration?.toFixed(1) || '?'}s`)
        .join("\n");

    const transcriptionText = typeof transcription === 'string' ? transcription : transcription.text;
    const totalDuration = typeof transcription === 'string' ? '?' : (transcription.segments?.at(-1)?.end ?? 5).toFixed(1);

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
                            content: `You are a social media video editor. Plan b-roll inserts over an a-roll video.
Rules:
- Prefer keeping the first 3 seconds as a-roll (speaker on camera), but for short clips under 5s you may start b-roll at 1s
- B-roll clips should visually match or complement the speech topic
- Each insert MUST be between 2-5 seconds long
- IMPORTANT: An insert duration CANNOT exceed the available duration of the clip
- Always return AT LEAST ONE b-roll insert — never return an empty array
- If the transcription is very short, insert a single b-roll clip early (e.g. startTime: 1 or 2)
- Return ONLY a raw JSON array with no markdown, no code fences`
                        },
                        {
                            role: "user",
                            content: `TRANSCRIPTION (total duration ≈ ${totalDuration}s):
"${transcriptionText}"

AVAILABLE B-ROLL CLIPS:
${brollSummary}

Create a b-roll edit plan. You MUST include at least one entry.
Return a JSON array only: [{"startTime": 1, "duration": 3, "clipIndex": 0, "reason": "..."}]`
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
            const jsonMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/); // Robust array detection
            try {
                editPlan = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
            } catch (e) {
                console.warn("[AI] JSON Parse failed for edit plan, falling back to distribution.");
            }
        }
    } catch (err) {
        console.error("\nFailed to generate edit plan:", err.message);
    }

    // Final safety check: if editPlan is empty or invalid, generate a simple distribution fallback
    if (!Array.isArray(editPlan) || editPlan.length === 0) {
        console.log("[AI] No valid edit plan found. Generating fallback distribution...");
        editPlan = videoDescriptions.slice(0, 5).map((v, i) => ({
            startTime: 3 + i * 5,
            duration: Math.min(v.duration || 3, 4),
            clipIndex: i,
            reason: "safety fallback distribution",
        }));
    }

    console.log(`[AI] Final Edit Plan:`, JSON.stringify(editPlan, null, 2));
    return editPlan;
}

async function analyzeBRoll(brollClips, transcription) {
    const brolls = await describeBRolls(brollClips);
    const editPlan = await planEdit(brolls, transcription);
    return { brolls, editPlan };
}

module.exports = { analyzeBRoll, describeBRolls, planEdit };

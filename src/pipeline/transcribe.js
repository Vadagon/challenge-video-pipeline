const axios = require('axios');

async function transcribeAudio(audioUrl) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN missing");

    // Step 1: Submit Transcription to Replicate
    const submitResp = await axios.post(
        "https://api.replicate.com/v1/models/openai/whisper/predictions",
        {
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
            }
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "Prefer": "wait",
            }
        }
    );

    let transcription = "";
    let status = submitResp.data.status;
    let pollUrl = submitResp.data.urls?.get;

    // Step 2: Handle Immediate Success or Poll
    if (status === "succeeded") {
        transcription = submitResp.data.output?.transcription || submitResp.data.output || "";
    } else {
        if (!pollUrl) throw new Error("Replicate did not return a poll URL");

        for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 5000));

            const statusResp = await axios.get(pollUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (statusResp.data.status === "succeeded") {
                transcription = statusResp.data.output?.transcription || statusResp.data.output || "";
                break;
            }

            if (statusResp.data.status === "failed") {
                throw new Error("Replicate transcription failed: " + (statusResp.data.error || JSON.stringify(statusResp.data)));
            }
        }
    }

    if (!transcription) {
        throw new Error("Failed to obtain transcription result");
    }

    return transcription;
}

module.exports = { transcribeAudio };

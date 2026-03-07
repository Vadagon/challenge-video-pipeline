const axios = require('axios');

async function generateARoll(audioUrl, aRollSourceUrl) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN missing");

    const submitResp = await axios.post(
        "https://api.replicate.com/v1/models/pixverse/lipsync/predictions",
        {
            input: {
                video: aRollSourceUrl,
                audio: audioUrl,
            }
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            }
        }
    );

    const predictionId = submitResp.data.id;
    const pollUrl = submitResp.data.urls?.get;

    if (!predictionId || !pollUrl) {
        throw new Error("Replicate did not return prediction information");
    }

    let aRollUrl = null;
    for (let i = 0; i < 60; i++) { // Max 10 minutes
        await new Promise((r) => setTimeout(r, 10000)); // Poll every 10s

        const statusResp = await axios.get(pollUrl, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (statusResp.data.status === "succeeded") {
            aRollUrl = statusResp.data.output;
            break;
        }

        if (statusResp.data.status === "failed") {
            throw new Error("Replicate prediction failed: " + statusResp.data.error);
        }

        if (statusResp.data.status === "canceled") {
            throw new Error("Replicate prediction was canceled.");
        }
    }

    if (!aRollUrl) {
        throw new Error("Timeout waiting for Replicate lip-sync result");
    }

    return aRollUrl;
}

module.exports = { generateARoll };

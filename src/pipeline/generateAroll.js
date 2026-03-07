const Replicate = require("replicate");

async function generateARoll(audioUrl, aRollSourceUrl) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN missing");

    const { withRetry } = require('../utils/retry');

    const replicate = new Replicate({
        auth: token,
    });

    const output = await withRetry(() => replicate.run(
        "pixverse/lipsync", // Or the specific version hash if required by their API
        {
            input: {
                video: aRollSourceUrl,
                audio: audioUrl,
            }
        }
    ));

    // The SDK waits for the prediction to finish and returns the final output.
    const aRollUrl = output;

    if (!aRollUrl) {
        throw new Error("Failed to obtain Replicate lip-sync result");
    }

    return aRollUrl;
}

module.exports = { generateARoll };

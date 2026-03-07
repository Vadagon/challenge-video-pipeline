const Replicate = require("replicate");

async function transcribeAudio(audioUrl) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN missing");

    const { withRetry } = require('../utils/retry');

    const replicate = new Replicate({
        auth: token,
    });

    const output = await withRetry(() => replicate.run(
        "villesau/whisper-timestamped:c5b122b7e513b1b5a6ef849891c538869b77cc932cbd0f8203e11d3b357553b8",
        {
            input: {
                audio_file: audioUrl,
                language: "auto",
                task: "transcribe",
                vad: true,
                verbose: false,
                translate: false,
                temperature: 0,
                suppress_tokens: "-1",
                logprob_threshold: -1,
                detect_disfluencies: false,
                no_speech_threshold: 0.6,
                compute_word_confidence: true,
                condition_on_previous_text: true,
                compression_ratio_threshold: 2.4,
            }
        }
    ));

    // The timestamped model returns an object with text and segments
    if (!output || !output.text) {
        throw new Error("Failed to obtain transcription result. Invalid output structure.");
    }

    return {
        text: output.text,
        segments: output.segments || []
    };
}

module.exports = { transcribeAudio };

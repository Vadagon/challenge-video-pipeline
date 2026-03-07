const Replicate = require("replicate");

async function transcribeAudio(audioUrl) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error("REPLICATE_API_TOKEN missing");

    const { withRetry } = require('../utils/retry');

    const replicate = new Replicate({
        auth: token,
    });

    const output = await withRetry(() => replicate.run(
        "victor-upmeet/whisperx:84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb",
        {
            input: {
                debug: false,
                vad_onset: 0.5,
                audio_file: audioUrl,
                batch_size: 64,
                vad_offset: 0.363,
                diarization: false,
                temperature: 0,
                align_output: false
            }
        }
    ));

    // whisperx model returns an object with segments array
    if (!output || !output.segments) {
        throw new Error("Failed to obtain transcription result. Invalid output structure.");
    }

    const fullText = output.segments.map(s => s.text).join(" ").trim();

    return {
        text: fullText,
        segments: output.segments
    };
}

module.exports = { transcribeAudio };

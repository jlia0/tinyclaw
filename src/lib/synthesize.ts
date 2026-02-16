import https from 'https';
import fs from 'fs';

const MAX_POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

/** Make an HTTPS request and return the response body. */
function httpsRequest(options: https.RequestOptions, body?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => { data += chunk; });
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

/** Download a file from a URL, following one redirect. */
function downloadUrl(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                file.close();
                fs.unlinkSync(destPath);
                const file2 = fs.createWriteStream(destPath);
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file2);
                    file2.on("finish", () => { file2.close(); resolve(); });
                }).on("error", reject);
                return;
            }
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

/**
 * Synthesize text to speech using Replicate's MiniMax Speech-02-Turbo model.
 * Creates a prediction, polls until succeeded/failed, downloads the audio.
 * Returns the local file path of the generated MP3, or null on failure.
 */
export async function synthesizeSpeech(text: string, destPath: string): Promise<string | null> {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return null;

    // Speech-02-Turbo has a 10k character limit
    const trimmed = text.length > 10000 ? text.substring(0, 10000) : text;

    try {
        // 1. Create the prediction
        const body = JSON.stringify({
            input: {
                text: trimmed,
                pitch: 0,
                speed: 1,
                volume: 1,
                bitrate: 128000,
                channel: "mono",
                emotion: "auto",
                voice_id: "Wise_Woman",
                sample_rate: 32000,
                audio_format: "mp3",
                language_boost: "None",
                subtitle_enable: false,
                english_normalization: true,
            },
        });

        const createResult = await httpsRequest(
            {
                hostname: "api.replicate.com",
                path: "/v1/models/minimax/speech-02-turbo/predictions",
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
            },
            body,
        );

        let prediction = JSON.parse(createResult);

        // 2. Poll until terminal state
        for (let i = 0; i < MAX_POLL_ATTEMPTS && prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled"; i++) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

            const pollUrl: string | undefined = prediction.urls?.get;
            if (!pollUrl) break;

            const parsed = new URL(pollUrl);
            const pollResult = await httpsRequest({
                hostname: parsed.hostname,
                path: parsed.pathname,
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${token}`,
                },
            });
            prediction = JSON.parse(pollResult);
        }

        if (prediction.status !== "succeeded") return null;

        const audioUrl: string | undefined = prediction.output;
        if (!audioUrl) return null;

        // 3. Download the audio file
        await downloadUrl(audioUrl, destPath);
        return destPath;
    } catch {
        try { fs.unlinkSync(destPath); } catch {}
        return null;
    }
}

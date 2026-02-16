import https from 'https';

/**
 * Transcribe audio using Replicate's incredibly-fast-whisper model.
 * Returns the transcribed text, or null on failure (non-blocking).
 */
export async function transcribeAudio(audioUrl: string): Promise<string | null> {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) return null;

    try {
        const body = JSON.stringify({
            version: "3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
            input: {
                task: "transcribe",
                audio: audioUrl,
                language: "None",
                batch_size: 64,
            },
        });

        const result = await new Promise<string>((resolve, reject) => {
            const req = https.request(
                {
                    hostname: "api.replicate.com",
                    path: "/v1/predictions",
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "Prefer": "wait",
                        "Content-Length": Buffer.byteLength(body),
                    },
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk: Buffer) => { data += chunk; });
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(data);
                        } else {
                            reject(new Error(`Replicate API ${res.statusCode}: ${data}`));
                        }
                    });
                },
            );
            req.on("error", reject);
            req.write(body);
            req.end();
        });

        const parsed = JSON.parse(result);
        const text = parsed?.output?.text;
        return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
    } catch {
        return null;
    }
}

import https from 'https';

// Models available for image generation via generateContent endpoint
// Priority order: nano-banana first (most capable for this use case), then fallbacks
const IMAGE_MODELS = [
  'nano-banana-pro-preview',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
];

// generateContent response shape (image gen subset)
interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }>;
    };
    finishReason?: string;
  }>;
  error?: { message: string; code: number };
}

function post(url: string, body: string, headers: Record<string, string>): Promise<GenerateContentResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error(`Parse error: ${data.slice(0, 300)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

export async function generateFrameImage(
  prompt: string,
  _targetWidth: number,
  _targetHeight: number
): Promise<Buffer | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      // Request high quality output
    },
  });

  for (const model of IMAGE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const result = await post(url, requestBody, { 'Content-Type': 'application/json' });

      if (result.error) {
        console.log(`  ⚠ ${model}: ${result.error.message.slice(0, 100)}`);
        continue;
      }

      // Find inline image data in the response parts
      const parts = result.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          console.log(`  ✓ Generated via ${model}`);
          return Buffer.from(part.inlineData.data, 'base64');
        }
      }

      const reason = result.candidates?.[0]?.finishReason;
      console.log(`  ⚠ ${model}: no image in response (finishReason: ${reason})`);
    } catch (e) {
      console.log(`  ⚠ ${model}: ${e}`);
    }
  }

  return null;
}

export async function generateBatch(
  requests: Array<{ prompt: string; width: number; height: number; key: string }>,
  concurrency = 3
): Promise<Map<string, Buffer | null>> {
  const results = new Map<string, Buffer | null>();

  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (req) => ({
        key: req.key,
        buf: await generateFrameImage(req.prompt, req.width, req.height),
      }))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.set(r.value.key, r.value.buf);
    }
    if (i + concurrency < requests.length) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  return results;
}

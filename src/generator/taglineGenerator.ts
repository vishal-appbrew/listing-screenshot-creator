import https from 'https';
import { BrandAnalysis } from '../analyzer/brandAnalyzer';
import { costTracker, GeminiUsage } from '../utils/costTracker';

const DEFAULT_TAGLINES = [
  'Style at your fingertips',
  'Every detail, one tap away',
  'Curated just for you',
  'Navigate your next look',
];

const TEXT_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
];

interface GeminiResult { text: string; model: string; usage: GeminiUsage | undefined; }

async function geminiPostWithFallback(apiKey: string, body: object): Promise<GeminiResult> {
  for (const model of TEXT_MODELS) {
    try {
      return await geminiPost(apiKey, model, body);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('no longer available') || msg.includes('not found') || msg.includes('404')) continue;
      throw e;
    }
  }
  throw new Error('No available Gemini text models');
}

function geminiPost(apiKey: string, model: string, body: object): Promise<GeminiResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload).toString() } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
              reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
              return;
            }
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            resolve({ text, model, usage: parsed?.usageMetadata as GeminiUsage | undefined });
          } catch { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

const CATEGORY_HINTS: Record<string, string> = {
  'ethnic-wear': 'Use words that evoke: tradition, craft, heritage, handloom, artisan, festive, elegance, desi, grace, weave, drape, handcrafted',
  'western-fashion': 'Use words that evoke: style, trend, curated, look, outfit, statement, closet, fresh, discover, collection, wardrobe',
  'luxury': 'Use words that evoke: refined, exclusive, timeless, discerning, atelier, curated, bespoke, impeccable, distinguished, elevated',
  'streetwear': 'Use words that evoke: bold, drop, limited, culture, authentic, raw, fresh, hype, street, movement',
  'sportswear': 'Use words that evoke: performance, push, train, endure, active, unleash, stronger, faster, gear, move',
  'beauty': 'Use words that evoke: glow, ritual, radiant, skin, nourish, transform, luminous, care, beauty, reveal',
  'home-decor': 'Use words that evoke: home, nest, space, cozy, curated, crafted, living, design, sanctuary',
  'jewelry': 'Use words that evoke: shine, adorn, heirloom, sparkle, wear, cherish, gem, gold, precious, timeless',
  'kids': 'Use words that evoke: play, grow, joy, explore, bright, fun, soft, little, imagine, colorful',
};

export async function generateTaglines(
  brandName: string,
  brandDescription: string,
  brandAnalysis?: BrandAnalysis
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return DEFAULT_TAGLINES;

  const category = brandAnalysis?.brandCategory || 'western-fashion';
  const tone = brandAnalysis?.taglineTone || 'premium and aspirational';
  const categoryHint = CATEGORY_HINTS[category] || CATEGORY_HINTS['western-fashion'];

  try {
    const result = await geminiPostWithFallback(apiKey, {
      contents: [{
        parts: [{
          text: `You write ultra-concise app store marketing taglines. You match the brand's voice exactly and never write generic copy.

BRAND: "${brandName}"
DESCRIPTION: ${brandDescription || 'A premium e-commerce brand'}
CATEGORY: ${category}
TONE: ${tone}
${categoryHint}

Write exactly 4 taglines for app store screenshots. Each tagline:
- Maximum 5-6 words
- Matches the brand's tone (${tone})
- Feels premium, specific, and aspirational — not generic
- Is relevant to its specific screen

The 4 screens:
1. HOMEPAGE — first impression, brand promise, discovery
2. PRODUCT DETAIL — product quality, craftsmanship, decision moment
3. PRODUCT LISTING — variety, curation, finding options
4. CATEGORIES — easy navigation, finding favorites

BAD (generic, could be any app): "Shop now", "Best app ever", "Download today"
GOOD (specific, branded for ethnic wear): "Your desi wardrobe, elevated", "Woven with love, worn daily", "Handpicked for you", "Every category, one place"

Return ONLY a JSON array of exactly 4 strings. No markdown, no backticks, no explanation.`,
        }],
      }],
      generationConfig: { maxOutputTokens: 300 },
    });
    costTracker.track('tagline_generation', result.model, result.usage, brandName);
    const match = result.text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed) && parsed.length === 4) {
        return parsed.map(t => String(t));
      }
    }
    return DEFAULT_TAGLINES;
  } catch (e) {
    console.log(`  ⚠ Tagline generation failed: ${String(e).slice(0, 120)}. Using defaults.`);
    return DEFAULT_TAGLINES;
  }
}

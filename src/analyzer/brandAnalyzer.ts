import https from 'https';
import sharp from 'sharp';
import { costTracker, GeminiUsage } from '../utils/costTracker';

export interface BrandAnalysis {
  // Core (backward-compat)
  aesthetic: 'luxury-minimal' | 'bold-modern' | 'traditional-elegant' | 'playful-vibrant' | 'earthy-organic' | 'tech-sleek' | 'artisan-craft' | 'streetwear-edgy' | 'boho-chic' | 'classic-refined';
  colorMood: string;
  primaryColorHex: string;
  secondaryColorHex: string;
  accentColorHex: string;
  backgroundTone: 'warm-cream' | 'cool-white' | 'dark-luxury' | 'bright-clean' | 'muted-earth' | 'vibrant-pop';
  typographyStyle: string;
  visualElements: string[];
  targetAudience: string;
  designInspiration: string;
  cornerRadiusStyle: 'sharp' | 'slightly-rounded' | 'rounded' | 'very-rounded';
  overallVibe: string;

  // v4 additions
  brandCategory: 'ethnic-wear' | 'western-fashion' | 'luxury' | 'streetwear' | 'sportswear' | 'beauty' | 'home-decor' | 'jewelry' | 'kids' | 'multi-category';
  colorTemperature: 'warm' | 'cool' | 'neutral';
  taglineTone: string;
  fontRecommendation?: { display: string; body: string };
  screenshotBackground?: {
    cleanStyle: {
      backgroundColor: string;
      textColor: string;
      accentDecoration: string;
    };
    fancyStyle: {
      gradientStart: string;
      gradientMiddle: string;
      gradientEnd: string;
      gradientAngle: number;
      textColor: string;
      decorationColor: string;
      decorationStyle: 'organic-circles' | 'geometric-shapes' | 'floral-elements' | 'glass-morphism' | 'confetti' | 'minimal-dots';
    };
    boldStyle: {
      dominantColor: string;
      supportingColors: string[];
    };
  };
}

// FALLBACK uses neutral/dark tones — NEVER hardcoded blue/indigo
const FALLBACK_ANALYSIS: BrandAnalysis = {
  aesthetic: 'bold-modern',
  colorMood: 'warm and inviting',
  primaryColorHex: '#1A1A1A',
  secondaryColorHex: '#F5F0E8',
  accentColorHex: '#C47A3A',
  backgroundTone: 'warm-cream',
  typographyStyle: 'bold sans-serif with clean body text',
  visualElements: ['organic shapes', 'warm gradients', 'subtle textures'],
  targetAudience: 'fashion-forward shoppers',
  designInspiration: 'Warm gradient background using brand accent colors',
  cornerRadiusStyle: 'rounded',
  overallVibe: 'A modern e-commerce brand with warm inviting colors.',
  brandCategory: 'western-fashion',
  colorTemperature: 'warm',
  taglineTone: 'warm, inviting, aspirational',
  screenshotBackground: {
    cleanStyle: { backgroundColor: '#FDF6EC', textColor: '#1A1A1A', accentDecoration: '#C47A3A' },
    fancyStyle: {
      gradientStart: '#8B4513', gradientMiddle: '#3D1C02', gradientEnd: '#1A1510',
      gradientAngle: 135, textColor: '#FFFFFF', decorationColor: '#D4742C', decorationStyle: 'organic-circles',
    },
    boldStyle: { dominantColor: '#8B4513', supportingColors: ['#5C2D0A', '#1A1510'] },
  },
};

/** Derive screenshotBackground colors from extracted brand colors (used when Gemini analysis fails) */
function deriveScreenshotBackground(
  primaryHex: string,
  accentHex: string
): NonNullable<BrandAnalysis['screenshotBackground']> {
  const warm = isWarmHex(accentHex) || isWarmHex(primaryHex);
  const cool = !warm && (isCoolHex(accentHex) || isCoolHex(primaryHex));

  const base = warm ? accentHex : (cool ? primaryHex : accentHex);
  const decorStyle = warm ? 'organic-circles' : (cool ? 'minimal-dots' : 'organic-circles');

  return {
    cleanStyle: {
      backgroundColor: lightenHex(base, 0.93),
      textColor: '#1A1A1A',
      accentDecoration: base,
    },
    fancyStyle: {
      gradientStart: darkenHex(base, 0.10),
      gradientMiddle: darkenHex(base, 0.48),
      gradientEnd: warm ? darkenHex(base, 0.70) : darkenHex(accentHex, 0.45),
      gradientAngle: 135,
      textColor: '#FFFFFF',
      decorationColor: warm ? lightenHex(base, 0.5) : '#FFFFFF',
      decorationStyle: decorStyle,
    },
    boldStyle: {
      dominantColor: darkenHex(base, 0.05),
      supportingColors: [darkenHex(base, 0.50), darkenHex(base, 0.70)],
    },
  };
}

// Try models in order until one works
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
            const candidate = parsed?.candidates?.[0];
            const finishReason = candidate?.finishReason;
            const text = candidate?.content?.parts?.[0]?.text ?? '';
            if (!text && finishReason && finishReason !== 'STOP') {
              reject(new Error(`Gemini finishReason: ${finishReason}`));
              return;
            }
            resolve({ text, model, usage: parsed?.usageMetadata as GeminiUsage | undefined });
          } catch { reject(new Error(`Parse error: ${data.slice(0, 300)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

// Validate that screenshotBackground colors match the brand's color temperature
function validateColors(analysis: BrandAnalysis): BrandAnalysis {
  if (!analysis.screenshotBackground) return analysis;
  const { colorTemperature, screenshotBackground: bg } = analysis;
  const fancy = bg.fancyStyle;

  if (colorTemperature === 'warm') {
    // Check if any gradient color is cool (blue/purple hue)
    if (isCoolHex(fancy.gradientStart) || isCoolHex(fancy.gradientMiddle)) {
      console.log('  ⚠ Correcting cool gradient colors for warm brand');
      const p = analysis.primaryColorHex;
      fancy.gradientStart = p;
      fancy.gradientMiddle = darkenHex(p, 0.35);
      fancy.gradientEnd = darkenHex(analysis.accentColorHex || p, 0.4);
    }
    if (isCoolHex(bg.cleanStyle.backgroundColor)) {
      bg.cleanStyle.backgroundColor = lightenHex(analysis.primaryColorHex, 0.94);
    }
    if (isCoolHex(bg.boldStyle.dominantColor)) {
      bg.boldStyle.dominantColor = analysis.primaryColorHex;
      bg.boldStyle.supportingColors = [darkenHex(analysis.primaryColorHex, 0.45), darkenHex(analysis.primaryColorHex, 0.65)];
    }
  } else if (colorTemperature === 'cool') {
    if (isWarmHex(fancy.gradientStart) || isWarmHex(fancy.gradientMiddle)) {
      console.log('  ⚠ Correcting warm gradient colors for cool brand');
      const p = analysis.primaryColorHex;
      fancy.gradientStart = p;
      fancy.gradientMiddle = darkenHex(p, 0.35);
      fancy.gradientEnd = darkenHex(analysis.secondaryColorHex || p, 0.3);
    }
  }

  return analysis;
}

function isCoolHex(hex: string): boolean {
  try {
    const { h, s } = hexToHsl(hex);
    return s > 12 && h > 175 && h < 315;
  } catch { return false; }
}

function isWarmHex(hex: string): boolean {
  try {
    const { h, s } = hexToHsl(hex);
    return s > 12 && (h < 55 || h > 330);
  } catch { return false; }
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s: s * 100, l: l * 100 };
}

function darkenHex(hex: string, factor: number): string {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const dr = Math.round(r * (1 - factor));
    const dg = Math.round(g * (1 - factor));
    const db = Math.round(b * (1 - factor));
    return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
  } catch { return hex; }
}

function lightenHex(hex: string, factor: number): string {
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const lr = Math.round(r + (255 - r) * factor);
    const lg = Math.round(g + (255 - g) * factor);
    const lb = Math.round(b + (255 - b) * factor);
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  } catch { return '#F8F8F8'; }
}

export async function analyzeBrand(
  brandName: string,
  homepageScreenshotBuffer: Buffer,
  description: string,
  extractedColors: { primaryColor: string; secondaryColor: string; accentColor: string }
): Promise<BrandAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Helper to build a fallback analysis using the ACTUAL extracted colors
  const buildFallback = (): BrandAnalysis => {
    const p = extractedColors.primaryColor.startsWith('#') ? extractedColors.primaryColor : FALLBACK_ANALYSIS.primaryColorHex;
    const a = extractedColors.accentColor.startsWith('#') ? extractedColors.accentColor : FALLBACK_ANALYSIS.accentColorHex;
    const warm = isWarmHex(a) || isWarmHex(p);
    return {
      ...FALLBACK_ANALYSIS,
      primaryColorHex: p,
      secondaryColorHex: extractedColors.secondaryColor.startsWith('#') ? extractedColors.secondaryColor : FALLBACK_ANALYSIS.secondaryColorHex,
      accentColorHex: a,
      colorTemperature: warm ? 'warm' : (isCoolHex(a) ? 'cool' : 'neutral'),
      screenshotBackground: deriveScreenshotBackground(p, a),
    };
  };

  if (!apiKey) {
    console.log('  No GEMINI_API_KEY — deriving colors from extracted palette');
    return buildFallback();
  }

  const prompt = `Analyze this e-commerce website for "${brandName}" and return a brand profile as compact JSON. No markdown, no newlines inside strings, no explanation — pure JSON only.

CSS colors found: primary=${extractedColors.primaryColor} secondary=${extractedColors.secondaryColor} accent=${extractedColors.accentColor}

{"aesthetic":"luxury-minimal|bold-modern|traditional-elegant|playful-vibrant|earthy-organic|tech-sleek|artisan-craft|streetwear-edgy|boho-chic|classic-refined","colorMood":"3-5 words","primaryColorHex":"#hex from screenshot","secondaryColorHex":"#hex","accentColorHex":"#hex","backgroundTone":"warm-cream|cool-white|dark-luxury|bright-clean|muted-earth|vibrant-pop","typographyStyle":"5 words","visualElements":["element1","element2"],"targetAudience":"one phrase","designInspiration":"one sentence","cornerRadiusStyle":"sharp|slightly-rounded|rounded|very-rounded","overallVibe":"one sentence","brandCategory":"ethnic-wear|western-fashion|luxury|streetwear|sportswear|beauty|home-decor|jewelry|kids|multi-category","colorTemperature":"warm|cool|neutral","taglineTone":"5-8 words describing tone","fontRecommendation":{"display":"Google Font name","body":"Google Font name"},"screenshotBackground":{"cleanStyle":{"backgroundColor":"#hex light tint of brand color","textColor":"#hex dark","accentDecoration":"#hex brand color"},"fancyStyle":{"gradientStart":"#hex medium-dark brand color","gradientMiddle":"#hex darker","gradientEnd":"#hex complementary","gradientAngle":135,"textColor":"#FFFFFF","decorationColor":"#FFFFFF","decorationStyle":"organic-circles|geometric-shapes|floral-elements|glass-morphism|confetti|minimal-dots"},"boldStyle":{"dominantColor":"#hex saturated brand color","supportingColors":["#hex darker","#hex darkest"]}}}

RULES: 1) Warm brands (rust/orange/terracotta): all background colors must be warm - no blue/purple. 2) Ethnic/traditional brands: decorationStyle=floral-elements or organic-circles. 3) cleanStyle.backgroundColor must be a very light warm cream or off-white matching brand temperature. 4) Bold/fancy gradients use dark saturated versions of brand colors.`;

  try {
    // Resize screenshot to max 800px wide before sending — reduces payload size significantly
    const resizedBuffer = homepageScreenshotBuffer.length > 0
      ? await sharp(homepageScreenshotBuffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
      : homepageScreenshotBuffer;

    const result = await geminiPostWithFallback(apiKey, {
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: resizedBuffer.toString('base64') } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: 2500 },
    });
    costTracker.track('brand_analysis', result.model, result.usage, brandName);
    const text = result.text;

    let clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!clean) throw new Error('Empty response from Gemini');
    // Repair: remove literal newlines inside JSON string values
    clean = clean.replace(/:\s*"([^"]*?)[\r\n]+([^"]*?)"/g, (_m, a, b) => `: "${a} ${b}"`);
    const parsed = JSON.parse(clean) as BrandAnalysis;

    // Fill missing v4 fields with fallback values
    if (!parsed.brandCategory) parsed.brandCategory = 'western-fashion';
    if (!parsed.colorTemperature) parsed.colorTemperature = 'neutral';
    if (!parsed.taglineTone) parsed.taglineTone = 'premium and aspirational';

    // Ensure screenshotBackground has all required fields
    if (!parsed.screenshotBackground) {
      parsed.screenshotBackground = FALLBACK_ANALYSIS.screenshotBackground!;
    } else {
      const bg = parsed.screenshotBackground;
      const fb = FALLBACK_ANALYSIS.screenshotBackground!;
      if (!bg.cleanStyle) bg.cleanStyle = fb.cleanStyle;
      if (!bg.fancyStyle) bg.fancyStyle = fb.fancyStyle;
      if (!bg.boldStyle) bg.boldStyle = fb.boldStyle;
      if (!bg.fancyStyle.gradientAngle) bg.fancyStyle.gradientAngle = 135;
      if (!Array.isArray(bg.boldStyle.supportingColors)) bg.boldStyle.supportingColors = fb.boldStyle.supportingColors;
    }

    return validateColors(parsed);
  } catch (e) {
    console.log(`  ⚠ Brand analysis failed: ${String(e).slice(0, 120)}. Deriving colors from extracted palette.`);
    return buildFallback();
  }
}

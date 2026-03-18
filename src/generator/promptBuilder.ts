import { BrandAnalysis } from '../analyzer/brandAnalyzer';
import { ScreenName, Style, DeviceType } from '../config/dimensions';

const SCREEN_PURPOSE: Record<ScreenName, string> = {
  home: 'Homepage — first impression, brand experience, hero discovery',
  pdp: 'Product detail — craftsmanship, quality, decision-making moment',
  plp: 'Product listing — variety, curation, product discovery',
  category: 'Category navigation — organized browsing, finding favorites effortlessly',
};

export function buildFramePrompt(
  brand: BrandAnalysis,
  brandName: string,
  tagline: string,
  screenName: ScreenName,
  deviceType: DeviceType,
  style: Style,
  isFirstScreen: boolean,
  canvasWidth: number,
  canvasHeight: number
): string {
  const deviceDesc =
    deviceType === 'ipad'
      ? 'a modern tablet (iPad Pro style, portrait orientation) with very thin bezels and rounded corners'
      : 'a modern smartphone (iPhone 15 Pro style) with ultra-thin bezels, Dynamic Island notch, and rounded corners';

  const textBlock = isFirstScreen
    ? `BRAND NAME: "${brandName}" — display prominently above the tagline\nTAGLINE: "${tagline}"`
    : `TAGLINE: "${tagline}"`;

  const screenBg = buildStyleSection(style, brand, brandName, deviceDesc);

  return `Generate a premium app store listing screenshot image for a mobile shopping app.

BRAND: ${brandName}
BRAND AESTHETIC: ${brand.overallVibe}
SCREEN PURPOSE: ${SCREEN_PURPOSE[screenName]}

${textBlock}

${screenBg}

DEVICE PLACEMENT:
- Draw ${deviceDesc} centered horizontally, occupying the LOWER 60-65% of the image height
- The device SCREEN AREA (inside the bezels) MUST be filled with solid pure white (#FFFFFF) — this will be programmatically replaced with a real screenshot
- The white screen area must have clean, sharp rectangular edges (slightly rounded to match device)
- Device should have a realistic drop shadow beneath it

LAYOUT:
- Upper 30-35% of image: brand name${isFirstScreen ? ' and' : ' or'} tagline text, clearly legible
- Lower 65-70%: device mockup centered, with enough bottom padding so it doesn't touch the edge

HARD RULES:
1. The device screen interior MUST be solid white — no UI content, no mockup app screenshots inside
2. All text must be fully legible at small display sizes
3. No stock photography, no human faces, no real product images
4. No app store chrome (status bars, back buttons)
5. Output should look like a professional app store listing from a premium Indian fashion brand
6. Image size: ${canvasWidth}×${canvasHeight} pixels

NEGATIVE: avoid amateur composition, blurry text, cluttered backgrounds, generic templates, cold blue gradients on warm brands, dark backgrounds for clean style`;
}

function buildStyleSection(style: Style, brand: BrandAnalysis, brandName: string, deviceDesc: string): string {
  if (style === 'clean') {
    const bgDesc =
      brand.backgroundTone === 'warm-cream'
        ? 'warm cream/ivory (#F8F3ED or #FDF6EC)'
        : brand.backgroundTone === 'dark-luxury'
        ? 'very soft off-white (#FAFAF8) — NEVER dark for clean style'
        : brand.backgroundTone === 'muted-earth'
        ? 'soft warm beige (#F0EBE3)'
        : 'clean light neutral (#F6F7F8)';

    return `STYLE: Clean Minimal
BACKGROUND: Solid ${bgDesc}. Extremely minimal decoration — at most one or two very subtle geometric shapes at 3-5% opacity in the brand's primary color.
TEXT TREATMENT: Bold dark text (#1A1A1A or #111111). Clean typography. ${brand.typographyStyle}
MOOD: Apple-level minimalism. Breathable white space. Sophisticated restraint.
DEVICE FRAME COLOR: Dark graphite/black, ultra-realistic`;
  }

  if (style === 'premium') {
    const gradDesc = buildGradientDesc(brand, 'premium');
    return `STYLE: Premium Polished
BACKGROUND: ${gradDesc}
DECORATIVE ELEMENTS: Soft bokeh circles at 3-5% opacity, subtle light flares, gentle glass-morphism effect on edges. ${brand.aesthetic.includes('organic') || brand.aesthetic.includes('artisan') ? 'Add subtle organic texture — fabric grain or paper texture at very low opacity.' : 'Floating geometric shapes at low opacity.'}
TEXT TREATMENT: White text with elegant soft drop shadow. ${brand.typographyStyle}
MOOD: ${brand.designInspiration}
DEVICE FRAME: Dark, with subtle reflection and premium drop shadow`;
  }

  // bold
  const gradDesc = buildGradientDesc(brand, 'bold');
  const boldElements = buildBoldElements(brand);
  return `STYLE: Bold Editorial
BACKGROUND: ${gradDesc}
DECORATIVE ELEMENTS: ${boldElements}
TEXT TREATMENT: Large, bold, expressive white text. Strong shadow or glow. Maximum impact — would stop someone scrolling in the App Store.
MOOD: Premium editorial. Magazine-quality. Dynamic and dimensional — NOT flat.
DEVICE FRAME: Dark with dramatic drop shadow, device appears to float in the scene`;
}

function buildGradientDesc(brand: BrandAnalysis, style: 'premium' | 'bold'): string {
  const p = brand.primaryColorHex;
  const a = brand.accentColorHex;
  const s = brand.secondaryColorHex;

  switch (brand.backgroundTone) {
    case 'warm-cream':
    case 'muted-earth':
      return style === 'bold'
        ? `Rich warm gradient: deep amber/burnt orange → dark mahogany/near-black → deep bronze. Colors drawn from: ${p}, ${a}. Warm luxurious lighting.`
        : `Warm elegant gradient: ${p} deepened by 30% → soft dark warm brown → ${a} deepened. Sophisticated, warm-lit.`;

    case 'dark-luxury':
      return `Dramatic dark-luxury gradient: deepened ${p} → near-black → darkened ${a}. Gold/metallic accents at low opacity. Premium, high-fashion.`;

    case 'vibrant-pop':
      return style === 'bold'
        ? `Electric vibrant gradient: ${p} → ${a} → shifted hue of ${s}. Bold color energy, strong saturation.`
        : `Elevated vibrant gradient: ${p} → deeper ${p} → ${a}. Rich and lively but not garish.`;

    default:
      return style === 'bold'
        ? `Dynamic brand gradient: ${p} → darkened ${p} (40%) → hue-shifted ${s} (+25°). Dimensional and alive.`
        : `Polished brand gradient: ${p} → deepened ${p} (30%) → ${a} at low opacity end stop.`;
  }
}

function buildBoldElements(brand: BrandAnalysis): string {
  switch (brand.aesthetic) {
    case 'traditional-elegant':
    case 'artisan-craft':
      return 'Rich jewel-toned 3D-like floating orbs and soft light rays. Subtle ornate border pattern at edges. Gold/bronze accent highlights at low opacity.';
    case 'bold-modern':
    case 'streetwear-edgy':
      return 'Dynamic geometric shapes — bold angled planes and floating rectangles. Energy lines. Strong contrast shapes.';
    case 'earthy-organic':
    case 'boho-chic':
      return 'Organic flowing shapes — soft curved blobs and leaf-like forms. Warm bokeh circles. Natural texture overlays.';
    case 'playful-vibrant':
      return 'Confetti-like color pops, playful floating dots and stars, dynamic splashes of color, energetic composition.';
    case 'luxury-minimal':
    case 'classic-refined':
      return 'Minimalist dimensional elements — single large soft sphere with glass-like quality. Subtle gradient planes. Clean and elevated.';
    default:
      return 'Soft 3D floating spheres, bokeh circles at various opacities, and gentle light flares for depth and dimension.';
  }
}

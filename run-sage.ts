#!/usr/bin/env npx tsx
/**
 * One-off launcher: start the Mockup Studio editor pre-loaded with
 * the 4 Sage by Mala screenshots.
 */
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { startEditor } from './src/editor/server';
import { ensureFonts } from './src/generator/fallbackRenderer';
import type { BrandAssets } from './src/scraper/assetExtractor';

// ── Screenshots (Home, PLP, PDP, Category) ────────────────────────────────
const SHOTS = [
  { key: 'home',     file: '/Users/vishal/Downloads/IMG_5543.PNG' }, // Home feed
  { key: 'plp',      file: '/Users/vishal/Downloads/IMG_5542.PNG' }, // Dresses listing
  { key: 'pdp',      file: '/Users/vishal/Downloads/IMG_5541.PNG' }, // Collection editorial
  { key: 'category', file: '/Users/vishal/Downloads/IMG_5540.PNG' }, // Category / new arrivals
];

async function main() {
  const tempDir = path.join(os.tmpdir(), `sage-studio-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // Copy screenshots to temp, create both mobile + tablet slots from same file
  const screenshots: Record<string, string> = {};
  for (const { key, file } of SHOTS) {
    const dest = path.join(tempDir, `${key}.png`);
    fs.copyFileSync(file, dest);
    screenshots[`${key}-mobile`] = dest;
    screenshots[`${key}-tablet`] = dest;
  }

  // Brand assets (hand-coded from sagebymala.com visual identity)
  const brandAssets: BrandAssets = {
    brandName: 'Sage by Mala',
    description: 'Contemporary Indian women\'s fashion with timeless, editorial aesthetics. Known for dresses, tops, and curated separates.',
    logoPath: null,
    colors: {
      primaryColor:   '#1A1A1A',
      secondaryColor: '#F5F0E8',
      accentColor:    '#C8B89A',
      backgroundColor:'#FFFFFF',
      textColor:      '#1A1A1A',
    },
    colorProfile: 'light',
  };

  // Brand analysis — derived from extracted colors, no AI
  const brandAnalysis = {
    aesthetic: 'editorial-minimal' as const,
    colorMood: 'neutral',
    primaryColorHex: '#1A1A1A',
    secondaryColorHex: '#F5F0E8',
    accentColorHex: '#C8B89A',
    backgroundTone: 'bright-clean' as const,
    typographyStyle: 'elegant serif / clean sans',
    visualElements: [] as string[],
    targetAudience: 'fashion-forward women',
    designInspiration: 'Minimal editorial with black & ivory tones',
    cornerRadiusStyle: 'subtle' as const,
    overallVibe: 'Timeless, editorial Indian womenswear.',
    brandCategory: 'western-fashion' as const,
    colorTemperature: 'cool' as const,
    taglineTone: 'refined and aspirational',
  };

  // Taglines — defaults, user edits in dashboard
  const taglines = [
    'Effortless elegance, every day',
    'Discover your signature look',
    'Curated for the modern woman',
    'Style that speaks for itself',
  ];
  console.log('Taglines (edit in dashboard):', taglines);

  await ensureFonts();

  const outputDir = path.resolve('./output');
  fs.mkdirSync(outputDir, { recursive: true });

  // Build previews
  const previewDir = path.join(tempDir, 'previews');
  fs.mkdirSync(previewDir, { recursive: true });

  const { renderFallback } = await import('./src/generator/fallbackRenderer');
  const { SCREEN_NAMES } = await import('./src/config/dimensions');
  const screenMap: Record<string, string> = { home: 'home', pdp: 'pdp', plp: 'plp', category: 'category' };
  const tasks: Promise<void>[] = [];
  for (const [i, name] of SCREEN_NAMES.entries()) {
    const tagline = taglines[i] || taglines[0];
    const base = { brandLogoPath: null, brandName: brandAssets.brandName, colors: brandAssets.colors, colorProfile: brandAssets.colorProfile, brandAnalysis, showLogo: i === 0 };
    const mPath = screenshots[`${name}-mobile`];
    if (mPath) {
      tasks.push(renderFallback({ ...base, screenshotPath: mPath, outputPath: path.join(previewDir, `${name}-clean.png`), width: 414, height: 896, style: 'clean', tagline, deviceType: 'iphone' }).catch(console.warn));
      tasks.push(renderFallback({ ...base, screenshotPath: mPath, outputPath: path.join(previewDir, `${name}-premium.png`), width: 414, height: 896, style: 'premium', tagline, deviceType: 'iphone' }).catch(console.warn));
    }
  }
  await Promise.all(tasks);
  console.log('Previews ready.');

  await startEditor({
    brandAssets,
    brandAnalysis,
    taglines,
    screenshots,
    previewDir,
    outputDir,
    exportConfig: {
      brandAssets,
      brandAnalysis,
      taglines,
      screenshots,
      outputDir,
      styles: ['clean', 'premium', 'bold'],
      useAI: false,
    },
  });

  const port = process.env.PORT || 3456;
  console.log(`\n🖥️  Editor: http://localhost:${port}`);
  console.log('   Edit taglines and colors, then Export All.\n');
}

main().catch(err => { console.error(err); process.exit(1); });

import path from 'path';
import fs from 'fs';
import { BrandAssets } from '../scraper/assetExtractor';
import { BrandAnalysis } from '../analyzer/brandAnalyzer';
import { DIMENSIONS, SCREEN_NAMES, ScreenName, Style } from '../config/dimensions';
import { renderFallback, ensureFonts } from '../generator/fallbackRenderer';
import { renderFeatureGraphic } from '../generator/featureGraphicRenderer';

export interface ExportConfig {
  brandAssets: BrandAssets;
  brandAnalysis: BrandAnalysis;
  taglines: string[];
  screenshots: Record<string, string>;
  outputDir: string;
  styles: Style[];
  useAI: boolean; // reserved for future texture gen; not used in v4
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
}

export async function exportAll(config: ExportConfig): Promise<string> {
  const { brandAssets, brandAnalysis, taglines, screenshots, outputDir, styles } = config;
  const brandSlug = sanitizeName(brandAssets.brandName);
  const brandDir = path.join(outputDir, brandSlug);

  await ensureFonts();

  const dimensionsList = Object.values(DIMENSIONS);
  const tasks: Promise<void>[] = [];

  for (const dim of dimensionsList) {
    for (const style of styles) {
      for (let i = 0; i < SCREEN_NAMES.length; i++) {
        const screenName = SCREEN_NAMES[i] as ScreenName;
        const tagline = taglines[i] || taglines[0];
        const screenshotPath = screenshots[`${screenName}-${dim.viewport}`];

        if (!screenshotPath || !fs.existsSync(screenshotPath)) {
          console.warn(`  ⚠ Missing screenshot: ${screenName}-${dim.viewport}`);
          continue;
        }

        const filename = `${String(i + 1).padStart(2, '0')}-${screenName}.png`;
        const outputPath = path.join(brandDir, dim.label, style, filename);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        tasks.push(
          renderFallback({
            screenshotPath,
            outputPath,
            width: dim.width,
            height: dim.height,
            style,
            tagline,
            brandLogoPath: brandAssets.logoPath,
            brandName: brandAssets.brandName,
            colors: brandAssets.colors,
            colorProfile: brandAssets.colorProfile,
            brandAnalysis,
            showLogo: i === 0,
            deviceType: dim.deviceType,
          }).catch(err => console.warn(`  ⚠ Render failed ${filename}: ${err}`))
        );
      }
    }
  }

  await Promise.all(tasks);

  // Feature graphic (Play Store 1024×500)
  await renderFeatureGraphic({
    logoPath: brandAssets.logoPath,
    brandName: brandAssets.brandName,
    outputPath: path.join(brandDir, 'playstore', 'feature-graphic.png'),
  }).catch(err => console.warn(`  ⚠ Feature graphic failed: ${err}`));

  // Copy raw screenshots
  const rawDir = path.join(brandDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  for (const [key, srcPath] of Object.entries(screenshots)) {
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(rawDir, `${key}.png`));
    }
  }

  // Assets
  const assetsDir = path.join(brandDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  if (brandAssets.logoPath && fs.existsSync(brandAssets.logoPath)) {
    fs.copyFileSync(brandAssets.logoPath, path.join(assetsDir, 'logo.png'));
  }
  fs.writeFileSync(path.join(assetsDir, 'colors.json'), JSON.stringify(brandAssets.colors, null, 2));
  fs.writeFileSync(path.join(assetsDir, 'brand-analysis.json'), JSON.stringify(brandAnalysis, null, 2));

  fs.writeFileSync(path.join(brandDir, 'metadata.json'), JSON.stringify({
    brandName: brandAssets.brandName,
    colors: brandAssets.colors,
    colorProfile: brandAssets.colorProfile,
    brandCategory: brandAnalysis.brandCategory,
    colorTemperature: brandAnalysis.colorTemperature,
    taglines,
    styles,
    generatedAt: new Date().toISOString(),
  }, null, 2));

  return brandDir;
}

#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { captureAll } from './scraper/screenshotCapture';
import { generateTaglines } from './generator/taglineGenerator';
import { costTracker } from './utils/costTracker';
import { analyzeBrand } from './analyzer/brandAnalyzer';
import { exportAll, ExportConfig } from './output/exporter';
import { startEditor } from './editor/server';
import { closeBrowser } from './scraper/browser';
import { Style, STYLES, SCREEN_NAMES } from './config/dimensions';
import { renderFallback, ensureFonts } from './generator/fallbackRenderer';

// Load .env from project directory
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

program
  .name('screenshot-gen')
  .description('App Store Screenshot Generator v3 — AI-powered')
  .argument('<url>', 'E-commerce website URL')
  .option('--skip-editor', 'Export immediately without opening editor')
  .option('--styles <list>', 'Comma-separated: clean,premium,bold', 'clean,premium,bold')
  .option('--no-ai', 'Skip AI image generation, use canvas fallback only')
  .option('--output <dir>', 'Output directory', './output')
  .option('--no-taglines', 'Use default taglines instead of Claude API')
  .parse(process.argv);

const opts = program.opts();
const [url] = program.args;

async function main() {
  if (!url) { console.error(chalk.red('Error: URL required')); process.exit(1); }
  try { new URL(url); } catch { console.error(chalk.red('Error: Invalid URL')); process.exit(1); }

  const hostname = new URL(url).hostname.replace('www.', '');
  const tempDir = path.join(os.tmpdir(), `appstore-v3-${Date.now()}`);
  const outputDir = path.resolve(opts.output as string);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(chalk.bold(`\n🚀 App Store Screenshot Generator v4\n`));
  console.log(chalk.gray(`   ${url}\n`));

  // ── Step 1: Scrape ──────────────────────────────────────────────
  const captureSpinner = ora('Discovering pages and capturing screenshots...').start();
  let captureResult: Awaited<ReturnType<typeof captureAll>>;
  try {
    captureResult = await captureAll(url, tempDir);
    captureSpinner.succeed(chalk.green('8 screenshots captured (4 pages × 2 viewports)'));
    const { discoveredUrls } = captureResult;
    console.log(chalk.gray(`  Homepage: ${hostname}`));
    if (discoveredUrls.pdp && discoveredUrls.pdp !== url)
      console.log(chalk.gray(`  PDP: ${new URL(discoveredUrls.pdp).pathname}`));
    if (discoveredUrls.plp && discoveredUrls.plp !== url)
      console.log(chalk.gray(`  PLP: ${new URL(discoveredUrls.plp).pathname}`));
    console.log(chalk.gray(`  Category: ${discoveredUrls.category === 'HAMBURGER_MENU' ? 'hamburger menu state' : discoveredUrls.category ? new URL(discoveredUrls.category).pathname : 'fallback to PLP'}`));
  } catch (err) {
    captureSpinner.fail('Capture failed');
    console.error(err);
    await closeBrowser();
    process.exit(1);
  }

  const { assets } = captureResult;
  console.log(chalk.bold('\n🎨 Brand assets:'));
  console.log(chalk.gray(`  Name:  ${assets.brandName || 'Unknown'}`));
  console.log(chalk.gray(`  Logo:  ${assets.logoPath ? '✓ found' : '✗ not found (text fallback)'}`));
  console.log(chalk.gray(`  Color: ${assets.colors.primaryColor} (${assets.colorProfile})`));

  // ── Step 2: Brand Analysis (AI disabled — user sets color/logo in editor) ──
  const brandAnalysis: Awaited<ReturnType<typeof analyzeBrand>> = {
    aesthetic: 'bold-modern', colorMood: 'vibrant', primaryColorHex: assets.colors.primaryColor,
    secondaryColorHex: assets.colors.secondaryColor, accentColorHex: assets.colors.accentColor,
    backgroundTone: 'bright-clean', typographyStyle: 'bold sans-serif',
    visualElements: [], targetAudience: 'online shoppers',
    designInspiration: 'Premium gradient with brand colors', cornerRadiusStyle: 'rounded',
    overallVibe: 'A modern e-commerce brand.',
    brandCategory: 'western-fashion', colorTemperature: 'neutral', taglineTone: 'premium and aspirational',
  };

  // ── Step 3: Taglines (defaults — user edits in editor) ───────────────────
  const taglines = ['Style at your fingertips', 'Every detail, one tap away', 'Curated just for you', 'Navigate your next look'];
  console.log(chalk.gray('\n  Taglines: edit in the dashboard'));

  await closeBrowser();

  // Parse styles
  const styleInput = (opts.styles as string) || 'clean,premium,bold';
  const styles: Style[] = styleInput
    .split(',')
    .map(s => s.trim())
    .filter((s): s is Style => STYLES.includes(s as Style));

  if (styles.length === 0) { console.error(chalk.red('No valid styles')); process.exit(1); }

  const useAI = false; // v4: programmatic hybrid rendering (AI texture reserved for future)
  console.log(chalk.gray('\n  Rendering: hybrid (brand-color backgrounds + device frames)'));

  await ensureFonts();

  const exportConfig: ExportConfig = {
    brandAssets: assets,
    brandAnalysis,
    taglines,
    screenshots: captureResult.screenshots,
    outputDir,
    styles,
    useAI,
  };

  if (opts.skipEditor) {
    const total = styles.length * SCREEN_NAMES.length * 3;
    const exportSpinner = ora(`Generating ${total} images...`).start();
    try {
      const brandDir = await exportAll(exportConfig);
      exportSpinner.succeed(chalk.green(`${total} images ready`));
      console.log(chalk.bold(`\n✅ Output: ${brandDir}\n`));
      costTracker.printSummary();
      costTracker.saveToFile(brandDir);
      costTracker.appendToCSV(path.resolve('./cost-history.csv'));
    } catch (err) {
      exportSpinner.fail('Export failed');
      console.error(err);
      process.exit(1);
    }
    return;
  }

  // ── Step 4: Previews + Editor ────────────────────────────────────
  const previewDir = path.join(tempDir, 'previews');
  fs.mkdirSync(previewDir, { recursive: true });

  const previewSpinner = ora('Generating preview images...').start();
  const previewTasks = SCREEN_NAMES.flatMap((name, i) => {
    const tagline = taglines[i] || taglines[0];
    const base = { brandLogoPath: assets.logoPath, brandName: assets.brandName, colors: assets.colors, colorProfile: assets.colorProfile, brandAnalysis, showLogo: i === 0 };
    const tasks: Promise<void>[] = [];
    for (const style of ['clean', 'premium'] as Style[]) {
      const mobilePath = captureResult.screenshots[`${name}-mobile`] || '';
      if (mobilePath) {
        tasks.push(renderFallback({ ...base, screenshotPath: mobilePath, outputPath: path.join(previewDir, `${name}-${style}.png`), width: 414, height: 896, style, tagline, deviceType: 'iphone' }).catch(err => console.warn(`Preview failed ${name}-${style}: ${err}`)));
      }
      const tabletPath = captureResult.screenshots[`${name}-tablet`] || '';
      if (tabletPath) {
        tasks.push(renderFallback({ ...base, screenshotPath: tabletPath, outputPath: path.join(previewDir, `${name}-${style}-ipad.png`), width: 834, height: 1112, style, tagline, deviceType: 'ipad' }).catch(err => console.warn(`iPad preview failed ${name}-${style}: ${err}`)));
      }
    }
    return tasks;
  });
  await Promise.all(previewTasks);
  previewSpinner.succeed('Previews ready');

  await startEditor({
    brandAssets: assets,
    brandAnalysis,
    taglines,
    screenshots: captureResult.screenshots,
    previewDir,
    outputDir,
    exportConfig,
  });

  const port = process.env.PORT || 3456;
  console.log(chalk.bold(`\n🖥️  Editor: http://localhost:${port}`));
  console.log(chalk.gray('   Edit taglines and colors, click Export All when ready'));
  console.log(chalk.gray('   Press Ctrl+C to export and exit\n'));

  process.on('SIGINT', async () => {
    console.log(chalk.bold('\n\n📤 Exporting...'));
    try {
      const brandDir = await exportAll(exportConfig);
      console.log(chalk.bold(`✅ Output: ${brandDir}\n`));
      costTracker.printSummary();
      costTracker.saveToFile(brandDir);
      costTracker.appendToCSV(path.resolve('./cost-history.csv'));
    } catch (err) {
      console.error(chalk.red('Export failed:'), err);
    }
    process.exit(0);
  });
}

main().catch(err => {
  console.error(chalk.red('\nFatal error:'), err);
  process.exit(1);
});

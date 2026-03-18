import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import open from 'open';
import { getBrowser, createPage, closeBrowser } from '../scraper/browser';
import { costTracker } from '../utils/costTracker';
import { extractAssets, classifyColorProfile } from '../scraper/assetExtractor';
import { renderFallback, ensureFonts } from '../generator/fallbackRenderer';
import { exportAll, ExportConfig } from '../output/exporter';
import { SCREEN_NAMES, Style, STYLES, DIMENSIONS } from '../config/dimensions';
import { BrandAssets } from '../scraper/assetExtractor';
import { BrandAnalysis } from '../analyzer/brandAnalyzer';

// ── Kept for backward compatibility — index.ts calls startEditor(EditorState) ─

export interface EditorState {
  brandAssets: BrandAssets;
  brandAnalysis: BrandAnalysis;
  taglines: string[];
  screenshots: Record<string, string>;
  previewDir: string;
  outputDir: string;
  exportConfig: ExportConfig;
}

// ── Studio state (module-level, survives requests) ───────────────────────────

interface StudioState {
  tempDir: string | null;
  outputDir: string;
  screenshotPaths: Record<string, string>; // e.g. 'home-mobile' | 'home-tablet' → abs path
  brandName: string;
  brandColor: string;
  logoPath: string | null;
  headlines: Record<string, string>; // s1→s4
  brandAssets: BrandAssets | null;
  brandAnalysis: BrandAnalysis | null;
}

let studio: StudioState = {
  tempDir: null,
  outputDir: path.resolve('./output'),
  screenshotPaths: {},
  brandName: '',
  brandColor: '#D4742C',
  logoPath: null,
  headlines: {
    s1: 'Style at your fingertips',
    s2: 'Every detail, one tap away',
    s3: 'Curated just for you',
    s4: 'Navigate your next look',
  },
  brandAssets: null,
  brandAnalysis: null,
};

// ── Constants ────────────────────────────────────────────────────────────────

// Dashboard screen IDs → pipeline screen names
const SCREEN_MAP: Record<string, string> = {
  s1: 'home',
  s2: 'pdp',
  s3: 'plp',
  s4: 'category',
};

// Dashboard template IDs → renderFallback style names
const TEMPLATE_STYLE: Record<string, Style> = {
  minimal: 'clean',
  gradient: 'premium',
  dark: 'bold',
  editorial: 'premium',
};

const DEFAULT_BRAND_ANALYSIS: BrandAnalysis = {
  aesthetic: 'bold-modern',
  colorMood: 'vibrant',
  primaryColorHex: '#D4742C',
  secondaryColorHex: '#F5F0E8',
  accentColorHex: '#D4742C',
  backgroundTone: 'bright-clean',
  typographyStyle: 'bold sans-serif',
  visualElements: [],
  targetAudience: 'online shoppers',
  designInspiration: 'Premium gradient with brand colors',
  cornerRadiusStyle: 'rounded',
  overallVibe: 'A modern e-commerce brand.',
  brandCategory: 'western-fashion',
  colorTemperature: 'warm',
  taglineTone: 'premium and aspirational',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brand';
}

function countFilesInDir(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.png')) n++;
    }
  };
  walk(dir);
  return n;
}

function makeBrandColors(color: string) {
  return {
    primaryColor: color,
    secondaryColor: '#F5F0E8',
    accentColor: color,
    backgroundColor: '#FAFAF8',
    textColor: '#1A1A1A',
  };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function startEditor(initialState?: EditorState): Promise<void> {
  // Backward compat: CLI pipeline passes full EditorState
  if (initialState) {
    studio = {
      tempDir: initialState.previewDir ? path.dirname(initialState.previewDir) : null,
      outputDir: initialState.outputDir,
      screenshotPaths: initialState.screenshots,
      brandName: initialState.brandAssets.brandName,
      brandColor: initialState.brandAssets.colors.primaryColor,
      logoPath: initialState.brandAssets.logoPath,
      headlines: Object.fromEntries(
        ['s1', 's2', 's3', 's4'].map((id, i) => [id, initialState.taglines[i] || ''])
      ),
      brandAssets: initialState.brandAssets,
      brandAnalysis: initialState.brandAnalysis,
    };
  }

  const app = express();
  app.use(express.json({ limit: '50mb' })); // large limit for base64 images

  // CORS for local development
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── POST /api/generate ───────────────────────────────────────────────────
  // Body: { url?, screenshots: { s1?: base64, s2?: base64, s3?: base64, s4?: base64 },
  //         brandName?, brandColor?, logoBase64? }
  // Returns: { ok, brandName, brandColor, logoUrl? }
  app.post('/api/generate', async (req, res) => {
    const { url, screenshots: shots64 = {}, brandName, brandColor, logoBase64 } = req.body;

    try {
      const tempDir = studio.tempDir || path.join(os.tmpdir(), `studio-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      studio.tempDir = tempDir;

      // Save user-uploaded screenshots
      for (const [screenId, base64] of Object.entries(shots64 as Record<string, string>)) {
        const screenName = SCREEN_MAP[screenId];
        if (!screenName) continue;
        const buf = Buffer.from(base64, 'base64');
        const mobileP = path.join(tempDir, `${screenName}-mobile.png`);
        const tabletP = path.join(tempDir, `${screenName}-tablet.png`);
        fs.writeFileSync(mobileP, buf);
        fs.writeFileSync(tabletP, buf); // same source for all device sizes
        studio.screenshotPaths[`${screenName}-mobile`] = mobileP;
        studio.screenshotPaths[`${screenName}-tablet`] = tabletP;
      }

      // Save uploaded logo
      if (logoBase64) {
        const logoPath = path.join(tempDir, 'logo.png');
        fs.writeFileSync(logoPath, Buffer.from(logoBase64, 'base64'));
        studio.logoPath = logoPath;
      }

      // Optionally scrape URL for brand info
      let scrapedName: string | null = null;
      let scrapedColor: string | null = null;

      if (url) {
        try {
          const browser = await getBrowser();
          const page = await createPage(browser, 390, 844, 3);
          const fullUrl = url.startsWith('http') ? url : `https://${url}`;
          await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 25000 });
          await new Promise(r => setTimeout(r, 1500));
          const assets = await extractAssets(page, tempDir);
          await page.close();
          await closeBrowser();

          scrapedName = assets.brandName || null;
          scrapedColor = assets.colors.primaryColor || null;
          studio.brandAssets = assets;

          // Use scraped logo only if user didn't upload one
          if (!studio.logoPath && assets.logoPath && fs.existsSync(assets.logoPath)) {
            studio.logoPath = assets.logoPath;
          }
        } catch (err) {
          console.warn(`Brand scrape failed for ${url}: ${err}`);
        }
      }

      // User input overrides scraped data
      studio.brandName = brandName || scrapedName || studio.brandName || 'Brand';
      studio.brandColor = brandColor || scrapedColor || studio.brandColor;

      res.json({
        ok: true,
        brandName: studio.brandName,
        brandColor: studio.brandColor,
        logoUrl: studio.logoPath && fs.existsSync(studio.logoPath) ? '/logo' : null,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── PUT /api/config ──────────────────────────────────────────────────────
  // Body: { brandName?, brandColor?, headlines? }
  app.put('/api/config', (req, res) => {
    const { brandName, brandColor, headlines } = req.body;
    if (brandName !== undefined) studio.brandName = brandName;
    if (brandColor !== undefined) studio.brandColor = brandColor;
    if (headlines && typeof headlines === 'object') {
      studio.headlines = { ...studio.headlines, ...headlines };
    }
    res.json({ ok: true });
  });

  // ── POST /api/logo ───────────────────────────────────────────────────────
  // Body: { logoBase64: string }
  app.post('/api/logo', async (req, res) => {
    const { logoBase64 } = req.body;
    if (!logoBase64) { res.status(400).json({ error: 'No image data' }); return; }
    try {
      const dir = studio.tempDir || os.tmpdir();
      fs.mkdirSync(dir, { recursive: true });
      const logoPath = path.join(dir, 'logo.png');
      fs.writeFileSync(logoPath, Buffer.from(logoBase64, 'base64'));
      studio.logoPath = logoPath;
      if (studio.brandAssets) {
        studio.brandAssets = { ...studio.brandAssets, logoPath };
      }
      res.json({ ok: true, logoUrl: '/logo' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /logo ────────────────────────────────────────────────────────────
  app.get('/logo', (_req, res) => {
    if (studio.logoPath && fs.existsSync(studio.logoPath)) {
      res.sendFile(studio.logoPath);
    } else {
      res.status(404).end();
    }
  });

  // ── POST /api/screenshot/:screenId ──────────────────────────────────────
  // Replaces a single uploaded screenshot in the preview view
  // Body: { base64: string }
  app.post('/api/screenshot/:screenId', async (req, res) => {
    const { screenId } = req.params;
    const { base64 } = req.body;
    const screenName = SCREEN_MAP[screenId];
    if (!screenName) { res.status(400).json({ error: 'Invalid screenId' }); return; }
    if (!base64) { res.status(400).json({ error: 'No image data' }); return; }
    try {
      const dir = studio.tempDir || path.join(os.tmpdir(), `studio-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      studio.tempDir = dir;
      const buf = Buffer.from(base64, 'base64');
      const mobileP = path.join(dir, `${screenName}-mobile.png`);
      const tabletP = path.join(dir, `${screenName}-tablet.png`);
      fs.writeFileSync(mobileP, buf);
      fs.writeFileSync(tabletP, buf);
      studio.screenshotPaths[`${screenName}-mobile`] = mobileP;
      studio.screenshotPaths[`${screenName}-tablet`] = tabletP;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── POST /api/export/all ─────────────────────────────────────────────────
  // Body: { template, brandName?, brandColor?, headlines? }
  // Renders all 4 screens × 3 devices for the selected template
  app.post('/api/export/all', async (req, res) => {
    const { template = 'minimal', brandName, brandColor, headlines } = req.body;
    if (brandName) studio.brandName = brandName;
    if (brandColor) studio.brandColor = brandColor;
    if (headlines) studio.headlines = { ...studio.headlines, ...headlines };

    try {
      await ensureFonts();
      const style: Style = TEMPLATE_STYLE[template] || 'clean';
      const colors = makeBrandColors(studio.brandColor);
      const colorProfile = classifyColorProfile(studio.brandColor);
      const brandAnalysis = studio.brandAnalysis || { ...DEFAULT_BRAND_ANALYSIS, primaryColorHex: studio.brandColor };
      const outDir = path.join(studio.outputDir, sanitize(studio.brandName));

      const tasks: Promise<void>[] = [];
      let count = 0;

      for (const dim of Object.values(DIMENSIONS)) {
        for (const [screenId, screenName] of Object.entries(SCREEN_MAP)) {
          const ssPath = studio.screenshotPaths[`${screenName}-${dim.viewport}`];
          if (!ssPath || !fs.existsSync(ssPath)) continue;

          const idx = Object.keys(SCREEN_MAP).indexOf(screenId);
          const outPath = path.join(outDir, dim.label, style, `${String(idx + 1).padStart(2, '0')}-${screenName}.png`);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          count++;

          tasks.push(
            renderFallback({
              screenshotPath: ssPath,
              outputPath: outPath,
              width: dim.width,
              height: dim.height,
              style,
              tagline: studio.headlines[screenId] || '',
              brandLogoPath: studio.logoPath,
              brandName: studio.brandName,
              colors,
              colorProfile,
              brandAnalysis,
              showLogo: screenId === 's1',
              deviceType: dim.deviceType,
            }).catch(err => console.warn(`Export failed ${outPath}: ${err}`))
          );
        }
      }

      await Promise.all(tasks);
      res.json({ ok: true, outputPath: outDir, count });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── POST /api/export/single ──────────────────────────────────────────────
  // Body: { screenId, template, device, brandName?, brandColor?, headline? }
  // Returns: PNG file download
  app.post('/api/export/single', async (req, res) => {
    const { screenId, template = 'minimal', device = 'iphone', brandName, brandColor, headline } = req.body;
    if (!screenId) { res.status(400).json({ error: 'screenId required' }); return; }

    if (brandName) studio.brandName = brandName;
    if (brandColor) studio.brandColor = brandColor;
    if (headline !== undefined) studio.headlines[screenId] = headline;

    try {
      await ensureFonts();
      const screenName = SCREEN_MAP[screenId];
      if (!screenName) { res.status(400).json({ error: 'Invalid screenId' }); return; }

      const style: Style = TEMPLATE_STYLE[template] || 'clean';
      const dim = device === 'ipad' ? DIMENSIONS.iPad
        : device === 'android' ? DIMENSIONS.playStore
        : DIMENSIONS.iOS;

      const ssPath = studio.screenshotPaths[`${screenName}-${dim.viewport}`];
      if (!ssPath || !fs.existsSync(ssPath)) {
        res.status(404).json({ error: `No screenshot for ${screenId} (${device}). Upload it first.` }); return;
      }

      const outPath = path.join(studio.outputDir, `single-${screenId}-${template}-${device}.png`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });

      await renderFallback({
        screenshotPath: ssPath,
        outputPath: outPath,
        width: dim.width,
        height: dim.height,
        style,
        tagline: studio.headlines[screenId] || '',
        brandLogoPath: studio.logoPath,
        brandName: studio.brandName,
        colors: makeBrandColors(studio.brandColor),
        colorProfile: classifyColorProfile(studio.brandColor),
        brandAnalysis: studio.brandAnalysis || { ...DEFAULT_BRAND_ANALYSIS, primaryColorHex: studio.brandColor },
        showLogo: screenId === 's1',
        deviceType: dim.deviceType,
      });

      res.setHeader('Content-Disposition', `attachment; filename="${screenId}-${template}-${device}.png"`);
      res.sendFile(outPath);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── GET /api/cost ─────────────────────────────────────────────────────────
  app.get('/api/cost', (_req, res) => {
    res.json({ summary: costTracker.getSessionTotal(), breakdown: costTracker.getBreakdown() });
  });

  // ── GET /api/export — legacy compat for index.ts SIGINT handler ──────────
  app.get('/api/export', async (_req, res) => {
    if (!studio.brandAssets) { res.status(400).json({ error: 'No pipeline data' }); return; }
    try {
      const cfg: ExportConfig = {
        brandAssets: studio.brandAssets,
        brandAnalysis: studio.brandAnalysis || { ...DEFAULT_BRAND_ANALYSIS, primaryColorHex: studio.brandColor },
        taglines: ['s1','s2','s3','s4'].map(id => studio.headlines[id] || ''),
        screenshots: studio.screenshotPaths,
        outputDir: studio.outputDir,
        styles: STYLES,
        useAI: false,
      };
      const brandDir = await exportAll(cfg);
      res.json({ ok: true, outputDir: brandDir });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const port = parseInt(process.env.PORT || '3456', 10);
  await new Promise<void>(resolve => app.listen(port, () => resolve()));
  try { await open(`http://localhost:${port}`); } catch { /* ignore */ }
}

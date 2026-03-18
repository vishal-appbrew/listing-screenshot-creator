import { Page } from 'puppeteer';
import sharp from 'sharp';
import Vibrant from 'node-vibrant';
import Color from 'color';
import path from 'path';
import fs from 'fs';
import https from 'https';
import http from 'http';

export interface BrandColors {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
}

export type ColorProfile = 'dark-primary' | 'light-primary' | 'vibrant-primary' | 'warm-primary' | 'cool-primary';

export interface BrandAssets {
  logoPath: string | null;
  logoBuffer: Buffer | null;
  brandName: string;
  colors: BrandColors;
  colorProfile: ColorProfile;
  description: string;
}

// Emergency fallback: neutral warm (NEVER blue — it's wrong for most brands)
const DEFAULT_COLORS: BrandColors = {
  primaryColor: '#1A1A1A',
  secondaryColor: '#F5F0E8',
  accentColor: '#C47A3A',   // warm amber — safe neutral
  backgroundColor: '#FAFAF8',
  textColor: '#1A1A1A',
};

/** Convert CSS color values to #hex. Handles: #hex, rgb(), rgba(), and Shopify's space-separated "R G B" format */
function parseCssColorToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  value = value.trim();
  if (!value || value === 'transparent' || value === 'inherit' || value === 'initial') return null;
  if (value === 'rgba(0, 0, 0, 0)' || value === 'rgba(0,0,0,0)') return null;

  // Already hex
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;

  // rgb() / rgba()
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    if (r === 255 && g === 255 && b === 255) return null; // pure white — skip
    if (r === 0 && g === 0 && b === 0) return null;       // pure black — skip
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // Shopify Dawn: "212 116 44" (space-separated R G B)
  const spaceMatch = value.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (spaceMatch) {
    const r = parseInt(spaceMatch[1]);
    const g = parseInt(spaceMatch[2]);
    const b = parseInt(spaceMatch[3]);
    if (r === 255 && g === 255 && b === 255) return null;
    if (r === 0 && g === 0 && b === 0) return null;
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // hsl() format
  const hslMatch = value.match(/hsl\(\s*(\d+\.?\d*)\s*,\s*(\d+\.?\d*)%\s*,\s*(\d+\.?\d*)%/);
  if (hslMatch) {
    try { return Color.hsl(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3])).hex(); } catch { return null; }
  }

  return null;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (url.startsWith('data:')) {
      // Data URL
      const base64Data = url.split(',')[1];
      fs.writeFileSync(dest, Buffer.from(base64Data, 'base64'));
      resolve();
      return;
    }
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

export function classifyColorProfile(primary: string): ColorProfile {
  try {
    const [h, s, l] = Color(primary).hsl().array();

    if (l < 20 || (s < 15 && l < 35)) return 'dark-primary';
    if (l > 80) return 'light-primary';
    if (h >= 0 && h < 60 || h >= 330) return 'warm-primary';
    if (h >= 60 && h < 200) return 'cool-primary';
    return 'vibrant-primary';
  } catch {
    return 'vibrant-primary';
  }
}

export async function extractAssets(page: Page, tempDir: string): Promise<BrandAssets> {
  fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });

  // --- Extract brand name and description ---
  const { logoUrl, brandName, description } = await page.evaluate(() => {
    let brandName = '';
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    const titleText = document.title || '';
    if (ogSiteName) {
      brandName = ogSiteName.trim();
    } else {
      brandName = titleText.split(/[-|—:|·]/)[0].trim();
    }
    // Fallback: parse from hostname when all meta/title extraction fails
    if (!brandName || brandName.toLowerCase().includes('.com') || brandName.toLowerCase().includes('.in')) {
      const host = window.location.hostname.replace(/^www\./, '').split('.')[0];
      // Split on hyphens if present
      if (host.includes('-')) {
        brandName = host.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      } else {
        // Try splitting common short words: "sagebymala" → check for "by", "the", "and"
        const words = ['bythe', 'by', 'the', 'and', 'de', 'for', 'co'];
        let split = host;
        for (const w of words) {
          const idx = split.toLowerCase().indexOf(w);
          if (idx > 0 && idx < split.length - w.length) {
            const parts = [split.slice(0, idx), w, split.slice(idx + w.length)];
            brandName = parts.filter(Boolean).map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
            break;
          }
        }
        if (!brandName || brandName === host) {
          brandName = host.charAt(0).toUpperCase() + host.slice(1);
        }
      }
    }

    let logoUrl: string | null = null;

    // Strategy 1: img with "logo" in class/id/alt/src inside header/nav
    const headerArea = document.querySelector('header') || document.querySelector('nav') || document.body || document.documentElement;
    if (!headerArea) return { logoUrl: null, brandName, description: '' };

    // Try direct logo selectors first (covers Shopify, Squarespace, Wix, WooCommerce)
    const directLogoSelectors = [
      '[class*="logo"] img', '[id*="logo"] img',
      '.site-logo img', '.header-logo img', '.brand-logo img',
      '.header-title-logo img', '.header-branding img',  // Squarespace
      '.site-header__logo img', '.site-header__heading img',
      '.custom-logo', 'img.logo', 'a.logo img',
      'a.header__heading-link img', '.header__heading-logo', // Shopify
      '.navbar-brand img', '.site-name img',
    ];
    for (const sel of directLogoSelectors) {
      const el = document.querySelector(sel) as HTMLImageElement | null;
      if (el?.src) { logoUrl = el.src; break; }
    }

    if (!logoUrl) {
      const imgs = Array.from(headerArea.querySelectorAll('img')) as HTMLImageElement[];
      const logoImg = imgs.find(img => {
        const src = (img.getAttribute('src') || '').toLowerCase();
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const cls = (img.className || '').toLowerCase();
        const parent = img.closest('[class*="logo"], [id*="logo"]');
        return src.includes('logo') || alt.includes('logo') || cls.includes('logo') || parent !== null;
      });
      if (logoImg && logoImg.src) logoUrl = logoImg.src;
    }

    // Strategy 2: SVG logo
    if (!logoUrl) {
      const svgs = Array.from(headerArea.querySelectorAll('svg')) as SVGElement[];
      const logoSvg = svgs.find(svg => {
        const parent = svg.closest('[class*="logo"], [id*="logo"], a[href="/"]');
        return parent !== null;
      });
      if (logoSvg) {
        try {
          const s = new XMLSerializer();
          const svgStr = s.serializeToString(logoSvg);
          logoUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
        } catch {}
      }
    }

    // Strategy 3: apple-touch-icon
    if (!logoUrl) {
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
      if (appleIcon) logoUrl = appleIcon.href;
    }

    // Strategy 4: PNG favicon
    if (!logoUrl) {
      const favicon = document.querySelector('link[rel="icon"][type="image/png"]') as HTMLLinkElement;
      if (favicon) logoUrl = favicon.href;
    }

    let description = '';
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
    const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
    description = metaDesc || ogDesc || '';

    return { logoUrl, brandName, description };
  });

  // --- Download and process logo ---
  let logoPath: string | null = null;
  let logoBuffer: Buffer | null = null;
  const pngPath = path.join(tempDir, 'assets', 'logo.png');

  // Strategy A: download the logo URL found via page.evaluate
  if (logoUrl) {
    try {
      const rawPath = path.join(tempDir, 'assets', 'logo-raw.tmp');
      await downloadFile(logoUrl, rawPath);
      const sharpImg = sharp(rawPath);
      const meta = await sharpImg.metadata();
      console.log(`  Logo source: ${meta.width}×${meta.height} ${meta.format}`);
      await sharpImg.png().toFile(pngPath);
      logoBuffer = await fs.promises.readFile(pngPath);
      logoPath = pngPath;
      const finalMeta = await sharp(pngPath).metadata();
      console.log(`  ✓ Logo extracted: ${finalMeta.width}×${finalMeta.height}`);
    } catch (e) {
      console.log(`  ⚠ Logo download failed: ${e}`);
      logoPath = null;
    }
  }

  // Strategy B: screenshot-crop the logo element from the rendered page
  if (!logoPath) {
    try {
      const logoBounds = await page.evaluate(() => {
        const selectors = [
          '[class*="logo"] img', '[id*="logo"] img',
          '.site-logo img', '.header-logo img', '.brand-logo img',
          '.header-title-logo img', '.header-branding img', // Squarespace
          '.site-header__logo img', '.site-header__heading img',
          '.custom-logo', 'img.logo',
          'a.header__heading-link img', 'a.header__heading-link svg',
          '.header__heading-logo', '#logo img', '#logo svg',
          '[class*="logo"] svg', '[class*="brand"] img',
          'header a[href="/"] img',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 30 && rect.height > 10) {
              return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), found: true };
            }
          }
        }
        // Fallback: any header image that looks like a logo (wide, short, near top)
        const header = document.querySelector('header');
        if (header) {
          for (const img of Array.from(header.querySelectorAll('img'))) {
            const rect = img.getBoundingClientRect();
            if (rect.width > 60 && rect.height > 15 && rect.height < 150 && rect.top < 200) {
              return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), found: true };
            }
          }
        }
        return { found: false, x: 0, y: 0, width: 0, height: 0 };
      });

      if (logoBounds.found && logoBounds.width > 30) {
        const padding = 4;
        const cropBuf = await page.screenshot({
          type: 'png',
          clip: {
            x: Math.max(0, logoBounds.x - padding),
            y: Math.max(0, logoBounds.y - padding),
            width: logoBounds.width + padding * 2,
            height: logoBounds.height + padding * 2,
          },
        });
        await sharp(cropBuf as unknown as Buffer).png().toFile(pngPath);
        logoBuffer = cropBuf as unknown as Buffer;
        logoPath = pngPath;
        console.log(`  ✓ Logo via screenshot crop (${logoBounds.width}×${logoBounds.height})`);
      } else {
        console.log('  ⚠ No logo found — will use brand name text as fallback');
      }
    } catch (e) {
      console.log(`  ⚠ Logo screenshot crop failed: ${e}`);
    }
  }

  // --- Extract colors ---
  let colors = DEFAULT_COLORS;
  try {
    const rawColors = await page.evaluate(() => {
      const root = document.documentElement;
      const rootStyle = getComputedStyle(root);

      // === CSS custom properties ===
      // Standard + Shopify Dawn/Debut/OS2 theme vars
      const cssVarNames = [
        // Standard
        '--primary-color', '--primary', '--brand-color', '--accent', '--accent-color',
        '--color-primary', '--main-color', '--theme-color', '--color-accent', '--color-brand',
        '--link-color', '--btn-color', '--highlight-color',
        // Shopify Dawn / OS2.0
        '--color-base-accent-1', '--color-base-accent-2', '--color-button',
        '--color-foreground', '--color-base-text', '--color-link',
        '--color-base-background-1', '--color-base-background-2',
        // Shopify Debut / Brooklyn
        '--color-body-text', '--color-site-button-background', '--color-small-button-background',
        '--color-header-text',
      ];
      const cssVarMap: Record<string, string> = {};
      for (const name of cssVarNames) {
        const val = rootStyle.getPropertyValue(name).trim();
        if (val && val !== '' && val !== 'inherit' && val !== 'initial' && val !== 'unset') {
          cssVarMap[name] = val;
        }
      }

      // === Key UI element colors ===
      const uiColors: Record<string, string> = {};

      const headerEl = document.querySelector('header') || document.querySelector('[class*="header"]');
      if (headerEl) {
        const bg = getComputedStyle(headerEl).backgroundColor;
        const fg = getComputedStyle(headerEl).color;
        if (bg && bg !== 'rgba(0, 0, 0, 0)') uiColors.headerBg = bg;
        if (fg) uiColors.headerFg = fg;
      }

      // CTA/primary buttons (widest possible selector set)
      const btnSelectors = [
        'button[class*="primary"]', '[class*="btn-primary"]', '[class*="button--primary"]',
        '[class*="add-to-cart"]', '[class*="cta"]', 'a[class*="primary"]',
        'button[class*="button-primary"]', '[type="submit"]', 'button.button', 'a.button',
        '[class*="shopify-payment"]', '[name="add"]',
      ];
      for (const sel of btnSelectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          const bg = getComputedStyle(btn).backgroundColor;
          const fg = getComputedStyle(btn).color;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !bg.includes('255, 255, 255')) {
            uiColors.buttonBg = bg;
            if (fg) uiColors.buttonFg = fg;
            break;
          }
        }
      }

      // Links
      const linkSels = ['a[class*="link"]', 'nav a', 'header a', '.navigation a'];
      for (const sel of linkSels) {
        const el = document.querySelector(sel);
        if (el) {
          const col = getComputedStyle(el).color;
          if (col && col !== 'rgb(0, 0, 0)' && col !== 'rgba(0, 0, 0, 0)') {
            uiColors.linkColor = col;
            break;
          }
        }
      }

      // Body/page background
      const bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : null;
      if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)') uiColors.bodyBg = bodyBg;

      return { cssVarMap, uiColors };
    });

    // Resolve colors in priority order: CSS vars → UI elements → fallback
    const v = rawColors.cssVarMap;
    const u = rawColors.uiColors;
    console.log(`  CSS vars found: ${Object.keys(v).length}, UI colors: ${Object.keys(u).length}`);

    // Primary: prefer accent/brand CSS var, else header/link color
    const primaryHex =
      parseCssColorToHex(v['--color-base-accent-1'] || v['--color-button'] || v['--accent'] || v['--primary-color'] || v['--primary'] || v['--brand-color'] || v['--color-primary']) ||
      parseCssColorToHex(u.buttonBg) ||
      parseCssColorToHex(u.linkColor) ||
      parseCssColorToHex(u.headerFg) ||
      null;

    // Accent: CTA button color
    const accentHex =
      parseCssColorToHex(v['--color-button'] || v['--color-base-accent-1'] || v['--accent'] || v['--accent-color'] || v['--color-accent']) ||
      parseCssColorToHex(u.buttonBg) ||
      primaryHex;

    // Background
    const bgHex =
      parseCssColorToHex(v['--color-base-background-1'] || v['--color-background']) ||
      parseCssColorToHex(u.bodyBg) ||
      '#FAFAF8';

    // Secondary
    const secondaryHex =
      parseCssColorToHex(v['--color-base-accent-2']) ||
      parseCssColorToHex(u.headerBg) ||
      null;

    // === SOURCE 4: Vibrant analysis of the rendered page screenshot ===
    // Most reliable — analyzes what's actually visible on screen
    let pageVibrant: string | null = null;
    let pageDarkVibrant: string | null = null;
    let pageMuted: string | null = null;
    try {
      const screenshotBuf = await page.screenshot({ type: 'jpeg', quality: 80 } as any);
      const resized = await sharp(screenshotBuf as unknown as Buffer).resize({ width: 400 }).jpeg({ quality: 75 }).toBuffer();
      const palette = await Vibrant.from(resized).getPalette();
      pageVibrant = palette.Vibrant?.hex || null;
      pageDarkVibrant = palette.DarkVibrant?.hex || null;
      pageMuted = palette.LightMuted?.hex || null;
      console.log(`  Page Vibrant: ${pageVibrant}, DarkVibrant: ${pageDarkVibrant}`);
    } catch (e) {
      console.log(`  ⚠ Page Vibrant failed: ${e}`);
    }

    // Helper: is a hex color near-gray (very low saturation)?
    const isNearGray = (hex: string | null): boolean => {
      if (!hex) return true;
      try {
        const [, s] = Color(hex).hsl().array();
        return s < 12;
      } catch { return true; }
    };

    // Build final colors — prefer saturated/chromatic over gray
    const resolvedPrimary =
      (!isNearGray(primaryHex) ? primaryHex : null) ||
      (!isNearGray(accentHex) ? accentHex : null) ||
      pageVibrant || pageDarkVibrant || DEFAULT_COLORS.primaryColor;

    const resolvedAccent =
      (!isNearGray(accentHex) ? accentHex : null) ||
      (!isNearGray(primaryHex) ? primaryHex : null) ||
      pageVibrant || DEFAULT_COLORS.accentColor;

    if (resolvedPrimary !== DEFAULT_COLORS.primaryColor || resolvedAccent !== DEFAULT_COLORS.accentColor) {
      colors = {
        primaryColor: resolvedPrimary,
        secondaryColor: (!isNearGray(secondaryHex) ? secondaryHex : null) || pageMuted || DEFAULT_COLORS.secondaryColor,
        accentColor: resolvedAccent,
        backgroundColor: bgHex,
        textColor: '#1A1A1A',
      };
      console.log(`  FINAL colors: primary=${colors.primaryColor} accent=${colors.accentColor}`);
    } else if (logoBuffer) {
      try {
        const palette = await Vibrant.from(logoBuffer).getPalette();
        colors = {
          primaryColor: palette.DarkVibrant?.hex || palette.Vibrant?.hex || DEFAULT_COLORS.primaryColor,
          secondaryColor: palette.Muted?.hex || DEFAULT_COLORS.secondaryColor,
          accentColor: palette.Vibrant?.hex || palette.LightVibrant?.hex || DEFAULT_COLORS.accentColor,
          backgroundColor: palette.LightMuted?.hex || '#FAFAF8',
          textColor: '#1A1A1A',
        };
        console.log(`  Colors from logo Vibrant: primary=${colors.primaryColor} accent=${colors.accentColor}`);
      } catch {
        colors = DEFAULT_COLORS;
      }
    } else {
      console.log(`  ⚠ No colors extracted — using neutral fallback`);
    }
  } catch {
    colors = DEFAULT_COLORS;
  }

  const colorProfile = classifyColorProfile(colors.primaryColor);

  fs.writeFileSync(path.join(tempDir, 'assets', 'colors.json'), JSON.stringify(colors, null, 2));
  fs.writeFileSync(path.join(tempDir, 'assets', 'brand-context.txt'), description);

  return { logoPath, logoBuffer, brandName, colors, colorProfile, description };
}

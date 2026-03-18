/**
 * Canvas-based renderer — primary rendering path in v4 (hybrid approach).
 * Backgrounds are driven by brand analysis colors (guaranteed to match brand).
 * Device frames are drawn programmatically at precise proportions.
 */
import { createCanvas, loadImage, GlobalFonts, Image } from '@napi-rs/canvas';
import { SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { BrandColors, ColorProfile } from '../scraper/assetExtractor';
import { BrandAnalysis } from '../analyzer/brandAnalyzer';
import { DeviceType, Style } from '../config/dimensions';
import { drawCleanBackground, drawFancyBackground, drawBoldBackground } from './backgrounds';
import { drawDeviceFrame } from './deviceFrames';

let fontsReady = false;
const FONT_PATH = path.join(__dirname, '../../assets/fonts/Outfit-Bold.ttf');

export async function ensureFonts(): Promise<void> {
  if (fontsReady) return;
  const dir = path.dirname(FONT_PATH);
  fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(FONT_PATH)) {
    await new Promise<void>((resolve) => {
      const url = 'https://github.com/Outfitio/Outfit-Fonts/raw/main/fonts/static/Outfit-Bold.ttf';
      const file = fs.createWriteStream(FONT_PATH);
      https.get(url, (res) => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        } else {
          file.close();
          fs.unlink(FONT_PATH, () => {});
          resolve();
        }
      }).on('error', () => { file.close(); fs.unlink(FONT_PATH, () => {}); resolve(); });
    });
  }

  if (fs.existsSync(FONT_PATH)) {
    try { GlobalFonts.registerFromPath(FONT_PATH, 'Outfit'); } catch { /* ok */ }
  }
  fontsReady = true;
}

/**
 * Renders tagline text with automatic font size reduction to prevent overflow.
 * Returns the Y position after the last line of text.
 */
function renderTagline(
  ctx: SKRSContext2D,
  text: string,
  centerX: number,
  topY: number,
  maxWidth: number,
  fontSize: number,
  depth = 0
): number {
  if (depth > 5) return topY + fontSize; // safety stop
  const fontSpec = `800 ${fontSize}px Outfit, "Helvetica Neue", Arial, sans-serif`;
  ctx.font = fontSpec;

  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth * 0.88 && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  // If more than 3 lines, reduce font size and retry
  if (lines.length > 3) {
    return renderTagline(ctx, text, centerX, topY, maxWidth, Math.round(fontSize * 0.85), depth + 1);
  }

  const lineH = fontSize * 1.25;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, topY + i * lineH);
  }
  return topY + lines.length * lineH;
}

export interface FallbackOptions {
  screenshotPath: string;
  outputPath: string;
  width: number;
  height: number;
  style: Style;
  tagline: string;
  brandLogoPath: string | null;
  brandName: string;
  colors: BrandColors;
  colorProfile: ColorProfile;
  brandAnalysis: BrandAnalysis;
  showLogo: boolean;
  deviceType: DeviceType;
}

export async function renderFallback(opts: FallbackOptions): Promise<void> {
  await ensureFonts();

  const { width, height, style, tagline, brandLogoPath, brandName, showLogo, deviceType, screenshotPath, outputPath, brandAnalysis } = opts;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d') as unknown as SKRSContext2D;

  // Draw background using brand analysis colors
  let textColor: string;
  if (style === 'clean') {
    textColor = drawCleanBackground(ctx, width, height, brandAnalysis);
  } else if (style === 'bold') {
    textColor = drawBoldBackground(ctx, width, height, brandAnalysis);
  } else {
    // premium
    textColor = drawFancyBackground(ctx, width, height, brandAnalysis);
  }

  const topPad = height * 0.06;
  const logoZoneH = height * 0.07;
  let currentY = topPad;

  // Logo / brand name
  if (showLogo) {
    if (brandLogoPath && fs.existsSync(brandLogoPath)) {
      try {
        const logo: Image = await loadImage(brandLogoPath);
        const scale = Math.min((width * 0.55) / logo.width, (logoZoneH * 0.85) / logo.height, 1);
        const lw = logo.width * scale;
        const lh = logo.height * scale;
        ctx.drawImage(logo, (width - lw) / 2, currentY + (logoZoneH - lh) / 2, lw, lh);
      } catch {
        ctx.font = `900 ${Math.round(logoZoneH * 0.65)}px Outfit, "Helvetica Neue", Arial, sans-serif`;
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(brandName.toUpperCase(), width / 2, currentY + logoZoneH / 2);
      }
    } else {
      ctx.font = `900 ${Math.round(logoZoneH * 0.65)}px Outfit, "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(brandName.toUpperCase(), width / 2, currentY + logoZoneH / 2);
    }
    currentY += logoZoneH + height * 0.025;
  } else {
    currentY += height * 0.03;
  }

  // Tagline
  const fontSize = Math.round(width * 0.062);
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (style !== 'clean') {
    (ctx as any).shadowColor = 'rgba(0,0,0,0.35)';
    (ctx as any).shadowBlur = 28;
    (ctx as any).shadowOffsetY = 4;
  }

  const textEndY = renderTagline(ctx, tagline, width / 2, currentY, width, fontSize);

  if (style !== 'clean') {
    (ctx as any).shadowColor = 'transparent';
    (ctx as any).shadowBlur = 0;
    (ctx as any).shadowOffsetY = 0;
  }

  currentY = textEndY + height * 0.03;

  // Device frame with screenshot
  if (fs.existsSync(screenshotPath)) {
    const remaining = height - currentY - height * 0.05;
    let frameH: number, frameW: number;
    if (deviceType === 'ipad') {
      frameH = Math.min(remaining, height * 0.65);
      frameW = frameH * (1024 / 1366);
    } else {
      frameH = Math.min(remaining, height * 0.63);
      frameW = frameH * (390 / 844);
    }
    const frameX = (width - frameW) / 2;
    const screenshot: Image = await loadImage(screenshotPath);
    drawDeviceFrame(ctx, frameX, currentY, frameW, frameH, screenshot, deviceType);
  }

  const buffer = canvas.toBuffer('image/png');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(buffer).png({ quality: 95 }).toFile(outputPath);
}

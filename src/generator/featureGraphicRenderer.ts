/**
 * Renders a Play Store Feature Graphic (1024×500px).
 * Background: sampled from the logo's corner pixels (its own bg color).
 * If the logo is transparent-edged or unreadable, falls back to white.
 * Logo is centred with generous padding on all sides.
 */
import { createCanvas, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const W = 1024;
const H = 500;

/** Sample corner pixels of the logo to detect its background colour. */
async function detectLogoBgColor(logoPath: string): Promise<string> {
  try {
    const { data, info } = await sharp(logoPath)
      .resize(100, 100, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels; // always 4 after ensureAlpha
    const corners = [[0, 0], [99, 0], [0, 99], [99, 99]] as const;

    const samples = corners.map(([cx, cy]) => {
      const idx = (cy * 100 + cx) * channels;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
    });

    // If all corners are transparent, the logo has no solid background
    if (samples.every(c => c.a < 30)) return '#FFFFFF';

    const opaque = samples.filter(c => c.a > 200);
    if (opaque.length === 0) return '#FFFFFF';

    const avg = opaque.reduce(
      (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
      { r: 0, g: 0, b: 0 }
    );
    const n = opaque.length;
    const r = Math.round(avg.r / n).toString(16).padStart(2, '0');
    const g = Math.round(avg.g / n).toString(16).padStart(2, '0');
    const b = Math.round(avg.b / n).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  } catch {
    return '#FFFFFF';
  }
}

/** Returns true if a hex colour is perceptually light (luma > 0.5). */
function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5;
}

export interface FeatureGraphicOptions {
  logoPath: string | null;
  brandName: string;
  outputPath: string;
}

export async function renderFeatureGraphic(options: FeatureGraphicOptions): Promise<void> {
  const { logoPath, brandName, outputPath } = options;

  // ── Background colour ────────────────────────────────────────────────────
  let bgColor = '#FFFFFF';
  if (logoPath && fs.existsSync(logoPath)) {
    bgColor = await detectLogoBgColor(logoPath);
  }

  // ── Canvas ───────────────────────────────────────────────────────────────
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // ── Logo or text fallback ────────────────────────────────────────────────
  if (logoPath && fs.existsSync(logoPath)) {
    const logo = await loadImage(logoPath);

    // Max 46% of width and 58% of height so there is breathing room all around
    const maxW = W * 0.46;
    const maxH = H * 0.58;
    const aspect = logo.width / logo.height;

    let logoW = maxW;
    let logoH = logoW / aspect;
    if (logoH > maxH) {
      logoH = maxH;
      logoW = logoH * aspect;
    }

    const x = Math.round((W - logoW) / 2);
    const y = Math.round((H - logoH) / 2);
    ctx.drawImage(logo, x, y, logoW, logoH);
  } else {
    // Text fallback when no logo is available
    const textColor = isLight(bgColor) ? '#1A1A1A' : '#FFFFFF';
    ctx.fillStyle = textColor;
    ctx.font = 'bold 80px Outfit, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(brandName, W / 2, H / 2);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const buffer = canvas.toBuffer('image/png');
  await sharp(buffer).png().toFile(outputPath);
}

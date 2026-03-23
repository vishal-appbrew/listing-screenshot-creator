import Color from 'color';
import { SKRSContext2D } from '@napi-rs/canvas';
import { BrandAnalysis } from '../analyzer/brandAnalyzer';

// ── Color helpers ─────────────────────────────────────────────────────────────

export function lightenColor(hex: string, lightness = 0.95): string {
  try {
    const c = Color(hex);
    const [h, s] = c.hsl().array();
    return Color.hsl(h, Math.max(s - 20, 5), lightness * 100).hex();
  } catch { return '#F8FAFC'; }
}

export function darkenColor(hex: string, factor = 0.3): string {
  try { return Color(hex).darken(factor).hex(); }
  catch { return '#1a1a2e'; }
}

export function adjustAlpha(hex: string, alpha: number): string {
  try {
    const [r, g, b] = Color(hex).rgb().array();
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  } catch { return `rgba(255,255,255,${alpha})`; }
}

export function shiftHue(hex: string, degrees: number): string {
  try {
    const [h, s, l] = Color(hex).hsl().array();
    return Color.hsl((h + degrees) % 360, s, l).hex();
  } catch { return hex; }
}

// ── Canvas helper ─────────────────────────────────────────────────────────────

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Deterministic seeds for decoration positions ──────────────────────────────

const SA = [0.12, 0.67, 0.34, 0.89, 0.45, 0.23, 0.78, 0.56, 0.11, 0.92];
const SB = [0.20, 0.50, 0.80, 0.10, 0.40, 0.70, 0.30, 0.60, 0.90, 0.15];

function drawFourPointStar(ctx: SKRSContext2D, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 4;
    const radius = i % 2 === 0 ? r : r * 0.25;
    if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Decoration style renderers ────────────────────────────────────────────────

function drawOrganicCircles(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  for (let i = 0; i < 7; i++) {
    const x = ((SA[i] * 1.3 + 0.1) % 1) * w;
    const y = ((SB[(i + 2) % 10] * 1.7 + 0.05) % 1) * h;
    const r = 30 + SA[(i + 1) % 10] * 90;
    ctx.fillStyle = adjustAlpha(color, bold ? 0.05 + SA[i] * 0.06 : 0.03 + SA[i] * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 18; i++) {
    const x = ((SB[i % 10] * 1.5 + 0.05) % 1) * w;
    const y = ((SA[(i + 5) % 10] * 1.8 + 0.05) % 1) * h;
    const r = 1.5 + SB[(i + 3) % 10] * 3;
    ctx.fillStyle = adjustAlpha(color, bold ? 0.15 + SB[i % 10] * 0.2 : 0.10 + SB[i % 10] * 0.15);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFloralElements(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const sx = SA[i] * w;
    const sy = SB[(i + 1) % 10] * h;
    ctx.strokeStyle = adjustAlpha(color, bold ? 0.09 : 0.05);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(
      sx + w * 0.14, sy - h * 0.06,
      sx + w * 0.28, sy + h * 0.10,
      sx + w * 0.38, sy - h * 0.02
    );
    ctx.stroke();
  }
  for (let cluster = 0; cluster < 6; cluster++) {
    const cx = SB[cluster % 10] * w;
    const cy = SA[(cluster + 3) % 10] * h;
    for (let d = 0; d < 5; d++) {
      const dx = cx + (SA[(cluster + d) % 10] - 0.5) * w * 0.06;
      const dy = cy + (SB[(cluster + d) % 10] - 0.5) * h * 0.04;
      ctx.fillStyle = adjustAlpha(color, bold ? 0.13 + SA[d] * 0.12 : 0.07 + SA[d] * 0.08);
      ctx.beginPath();
      ctx.arc(dx, dy, 2 + SB[d] * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawGeometricShapes(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  ctx.strokeStyle = adjustAlpha(color, bold ? 0.045 : 0.03);
  ctx.lineWidth = 1;
  const step = w * 0.07;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const x = SA[i] * w;
    const y = SB[(i + 2) % 10] * h;
    const size = 30 + SA[(i + 1) % 10] * 60;
    ctx.fillStyle = adjustAlpha(color, bold ? 0.05 : 0.03);
    ctx.fillRect(x, y, size, size);
  }
}

function drawGlassMorphism(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  for (let i = 0; i < 3; i++) {
    const px = SA[(i * 3) % 10] * w * 0.8;
    const py = SB[(i * 3 + 1) % 10] * h * 0.8;
    const pw = w * (0.28 + SA[(i + 2) % 10] * 0.18);
    const ph = h * (0.14 + SB[(i + 2) % 10] * 0.08);
    ctx.fillStyle = adjustAlpha(color, bold ? 0.07 : 0.05);
    roundedRect(ctx, px, py, pw, ph, 20);
    ctx.fill();
  }
}

function drawMinimalDots(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  for (let i = 0; i < 15; i++) {
    const x = ((SA[i % 10] * 1.5 + 0.05) % 1) * w;
    const y = ((SB[(i + 5) % 10] * 1.8 + 0.05) % 1) * h;
    const r = 1.5 + SA[(i + 3) % 10] * 4;
    ctx.fillStyle = adjustAlpha(color, bold ? 0.14 + SB[i % 10] * 0.18 : 0.08 + SB[i % 10] * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const starSeeds = [0.18, 0.52, 0.76, 0.33];
  for (let i = 0; i < 4; i++) {
    const x = ((starSeeds[i] * 1.4 + 0.1) % 1) * w;
    const y = ((starSeeds[(i + 2) % 4] * 1.6 + 0.1) % 1) * h;
    const r = 4 + SA[(i + 1) % 10] * 7;
    drawFourPointStar(ctx, x, y, r, adjustAlpha(color, bold ? 0.16 : 0.11));
  }
}

function drawConfetti(ctx: SKRSContext2D, w: number, h: number, color: string, bold: boolean): void {
  for (let i = 0; i < 20; i++) {
    const x = ((SA[i % 10] * 1.6 + 0.05) % 1) * w;
    const y = ((SB[(i + 3) % 10] * 1.9 + 0.02) % 1) * h;
    const r = 3 + SB[(i + 2) % 10] * 6;
    ctx.fillStyle = adjustAlpha(color, bold ? 0.18 + SA[i % 10] * 0.2 : 0.12 + SA[i % 10] * 0.14);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const x = SA[(i + 4) % 10] * w;
    const y = SB[(i + 2) % 10] * h;
    const r = 5 + SB[(i + 1) % 10] * 8;
    drawFourPointStar(ctx, x, y, r, adjustAlpha(color, bold ? 0.20 : 0.14));
  }
}

function drawDecorations(
  ctx: SKRSContext2D,
  w: number,
  h: number,
  color: string,
  style: string,
  bold = false
): void {
  switch (style) {
    case 'organic-circles': drawOrganicCircles(ctx, w, h, color, bold); break;
    case 'floral-elements': drawFloralElements(ctx, w, h, color, bold); break;
    case 'geometric-shapes': drawGeometricShapes(ctx, w, h, color, bold); break;
    case 'glass-morphism': drawGlassMorphism(ctx, w, h, color, bold); break;
    case 'confetti': drawConfetti(ctx, w, h, color, bold); break;
    default: drawMinimalDots(ctx, w, h, color, bold); break;
  }
}

// ── Public background functions ───────────────────────────────────────────────

export function drawCleanBackground(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  brandAnalysis: BrandAnalysis
): string {
  const clean = brandAnalysis.screenshotBackground?.cleanStyle;
  const bgColor = clean?.backgroundColor ?? lightenColor(brandAnalysis.primaryColorHex, 0.96);
  const accentHex = clean?.accentDecoration ?? brandAnalysis.primaryColorHex;
  const textColor = clean?.textColor ?? '#1A1A1A';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  return textColor;
}

export function drawFancyBackground(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  brandAnalysis: BrandAnalysis
): string {
  const fancy = brandAnalysis.screenshotBackground?.fancyStyle;
  const g0 = fancy?.gradientStart ?? darkenColor(brandAnalysis.primaryColorHex, 0.05);
  const g1 = fancy?.gradientMiddle ?? darkenColor(brandAnalysis.primaryColorHex, 0.4);
  const g2 = fancy?.gradientEnd ?? darkenColor(brandAnalysis.secondaryColorHex ?? brandAnalysis.primaryColorHex, 0.35);
  const angle = fancy?.gradientAngle ?? 135;
  const textColor = fancy?.textColor ?? '#FFFFFF';
  const decorColor = fancy?.decorationColor ?? '#FFFFFF';
  const decorStyle = fancy?.decorationStyle ?? 'minimal-dots';

  // Gradient with proper angle
  const rad = (angle - 90) * Math.PI / 180;
  const len = Math.sqrt(width * width + height * height);
  const x0 = width / 2 - Math.cos(rad) * len / 2;
  const y0 = height / 2 - Math.sin(rad) * len / 2;
  const x1 = width / 2 + Math.cos(rad) * len / 2;
  const y1 = height / 2 + Math.sin(rad) * len / 2;

  const grad = (ctx as any).createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, g0);
  grad.addColorStop(0.5, g1);
  grad.addColorStop(1, g2);
  ctx.fillStyle = grad as unknown as string;
  ctx.fillRect(0, 0, width, height);

  drawDecorations(ctx, width, height, decorColor, decorStyle, false);
  return textColor;
}

export function drawBoldBackground(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  brandAnalysis: BrandAnalysis
): string {
  const bold = brandAnalysis.screenshotBackground?.boldStyle;
  const fancy = brandAnalysis.screenshotBackground?.fancyStyle;
  const dominant = bold?.dominantColor ?? brandAnalysis.primaryColorHex;
  const support0 = bold?.supportingColors?.[0] ?? darkenColor(dominant, 0.5);
  const decorColor = fancy?.decorationColor ?? '#FFFFFF';
  const decorStyle = fancy?.decorationStyle ?? 'organic-circles';

  // Bold diagonal gradient — more dramatic than fancy
  const grad = (ctx as any).createLinearGradient(0, 0, width * 0.45, height);
  grad.addColorStop(0, dominant);
  grad.addColorStop(0.45, darkenColor(dominant, 0.35));
  grad.addColorStop(1, support0);
  ctx.fillStyle = grad as unknown as string;
  ctx.fillRect(0, 0, width, height);

  // Subtle corner accent glow
  const cornerGrad = (ctx as any).createRadialGradient(0, 0, 0, 0, 0, width * 0.55);
  cornerGrad.addColorStop(0, adjustAlpha(decorColor, 0.12));
  cornerGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = cornerGrad as unknown as string;
  ctx.fillRect(0, 0, width, height);

  drawDecorations(ctx, width, height, decorColor, decorStyle, true);
  return '#FFFFFF';
}

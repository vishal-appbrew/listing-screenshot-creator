import { SKRSContext2D, Image } from '@napi-rs/canvas';
import { DeviceType } from '../config/dimensions';

function roundRect(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
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

export function drawDeviceFrame(
  ctx: SKRSContext2D,
  x: number, y: number,
  width: number, height: number,
  screenshot: Image,
  deviceType: DeviceType
): void {
  if (deviceType === 'ipad') {
    drawIPadFrame(ctx, x, y, width, height, screenshot);
  } else if (deviceType === 'android') {
    drawAndroidFrame(ctx, x, y, width, height, screenshot);
  } else {
    drawIPhoneFrame(ctx, x, y, width, height, screenshot);
  }
}

function drawIPhoneFrame(
  ctx: SKRSContext2D,
  x: number, y: number,
  width: number, height: number,
  screenshot: Image
): void {
  const cornerRadius = width * 0.175; // iPhone 15 Pro: 17.5% of width
  const bezelW = width * 0.012;
  const bezelH = width * 0.012;

  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.40)';
  ctx.shadowBlur = width * 0.18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = height * 0.025;
  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();
  ctx.restore();

  // Device body — #1C1C1E (Apple's dark gray, not pure black)
  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();

  // Metallic edge highlight (simulates titanium/aluminum frame)
  ctx.save();
  ctx.strokeStyle = '#3A3A3C';
  ctx.lineWidth = Math.max(1.5, width * 0.008);
  roundRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, cornerRadius - 0.5);
  ctx.stroke();
  ctx.restore();

  // Inner edge (thin light line just inside the frame)
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  roundRect(ctx, x + bezelW, y + bezelH, width - bezelW * 2, height - bezelH * 2, cornerRadius - bezelW);
  ctx.stroke();
  ctx.restore();

  // Screen area
  const screenX = x + bezelW;
  const screenY = y + bezelH;
  const screenW = width - bezelW * 2;
  const screenH = height - bezelH * 2;
  const screenR = cornerRadius - bezelW;

  ctx.save();
  roundRect(ctx, screenX, screenY, screenW, screenH, screenR);
  ctx.clip();
  ctx.drawImage(screenshot, screenX, screenY, screenW, screenH);
  ctx.restore();

  // Dynamic Island — pill/capsule shape (iPhone 15 Pro style)
  // Height relative to screenW (not device height) so it stays a thin pill
  const islandW = screenW * 0.30;
  const islandH = screenW * 0.035;
  const islandX = screenX + (screenW - islandW) / 2;
  const islandY = screenY + screenH * 0.012;
  const islandR = islandH / 2; // fully rounded ends = pill

  ctx.fillStyle = '#000000';
  roundRect(ctx, islandX, islandY, islandW, islandH, islandR);
  ctx.fill();

  // Side buttons — right side volume/power
  const btnW = width * 0.018;
  const btn1H = height * 0.08;
  const btn1Y = y + height * 0.22;
  ctx.fillStyle = '#2C2C2E';
  roundRect(ctx, x + width - btnW * 0.5, btn1Y, btnW, btn1H, btnW / 2);
  ctx.fill();

  // Left side volume buttons
  const volBtnH = height * 0.06;
  const vol1Y = y + height * 0.19;
  const vol2Y = y + height * 0.27;
  ctx.fillStyle = '#2C2C2E';
  roundRect(ctx, x - btnW * 0.5, vol1Y, btnW, volBtnH, btnW / 2);
  ctx.fill();
  roundRect(ctx, x - btnW * 0.5, vol2Y, btnW, volBtnH, btnW / 2);
  ctx.fill();

  // Home indicator bar
  const barW = width * 0.35;
  const barH = Math.max(2, height * 0.004);
  const barX = x + (width - barW) / 2;
  const barY = y + height - bezelH - barH - height * 0.008;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
}

function drawAndroidFrame(
  ctx: SKRSContext2D,
  x: number, y: number,
  width: number, height: number,
  screenshot: Image
): void {
  const cornerRadius = width * 0.16;
  const bezelW = width * 0.018;
  const bezelH = width * 0.022;

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.40)';
  ctx.shadowBlur = width * 0.18;
  ctx.shadowOffsetY = height * 0.025;
  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#3A3A3C';
  ctx.lineWidth = Math.max(1, width * 0.007);
  roundRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, cornerRadius - 0.5);
  ctx.stroke();
  ctx.restore();

  // Screen
  const screenX = x + bezelW;
  const screenY = y + bezelH;
  const screenW = width - bezelW * 2;
  const screenH = height - bezelH * 2;

  ctx.save();
  roundRect(ctx, screenX, screenY, screenW, screenH, cornerRadius - bezelW);
  ctx.clip();
  ctx.drawImage(screenshot, screenX, screenY, screenW, screenH);
  ctx.restore();

  // Hole-punch camera
  const camR = width * 0.02;
  const camX = x + width / 2;
  const camY = y + bezelH + camR * 1.5;
  ctx.fillStyle = '#1C1C1E';
  ctx.beginPath();
  ctx.arc(camX, camY, camR * 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.arc(camX, camY, camR, 0, Math.PI * 2);
  ctx.fill();

  // Home indicator
  const barW = width * 0.3;
  const barH = Math.max(2, height * 0.004);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  roundRect(ctx, x + (width - barW) / 2, y + height - bezelH - barH - height * 0.006, barW, barH, barH / 2);
  ctx.fill();
}

function drawIPadFrame(
  ctx: SKRSContext2D,
  x: number, y: number,
  width: number, height: number,
  screenshot: Image
): void {
  const cornerRadius = width * 0.025; // iPad Pro: gentle corners (~2.5%)
  const bezelW = width * 0.018;
  const bezelH = width * 0.018;

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.40)';
  ctx.shadowBlur = width * 0.15;
  ctx.shadowOffsetY = height * 0.02;
  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#1C1C1E';
  roundRect(ctx, x, y, width, height, cornerRadius);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = '#3A3A3C';
  ctx.lineWidth = Math.max(1, width * 0.006);
  roundRect(ctx, x + 0.5, y + 0.5, width - 1, height - 1, cornerRadius - 0.5);
  ctx.stroke();
  ctx.restore();

  // Screen
  const screenX = x + bezelW;
  const screenY = y + bezelH;
  const screenW = width - bezelW * 2;
  const screenH = height - bezelH * 2;

  ctx.save();
  roundRect(ctx, screenX, screenY, screenW, screenH, cornerRadius - bezelW);
  ctx.clip();
  ctx.drawImage(screenshot, screenX, screenY, screenW, screenH);
  ctx.restore();

  // Front camera — tiny dot, barely visible (iPad Pro has no notch/Dynamic Island)
  const camR = width * 0.004; // ~0.4% of width — nearly invisible at thumbnail size
  const camX = x + width / 2;
  const camY = y + bezelH / 2; // centered in top bezel
  ctx.fillStyle = '#2C2C2E'; // slightly lighter than frame — very subtle
  ctx.beginPath();
  ctx.arc(camX, camY, camR, 0, Math.PI * 2);
  ctx.fill();

  // Home indicator
  const barW = width * 0.22;
  const barH = Math.max(2, height * 0.003);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  roundRect(ctx, x + (width - barW) / 2, y + height - bezelH * 0.5 - barH, barW, barH, barH / 2);
  ctx.fill();
}

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { DeviceType } from '../config/dimensions';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scan raw pixel data for the largest contiguous white rectangle.
 * Returns the bounding box of the white region most likely to be the device screen.
 */
export async function detectWhiteRectangle(
  imageBuffer: Buffer,
  imgWidth: number,
  imgHeight: number
): Promise<ScreenRect | null> {
  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(imgWidth, imgHeight, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const whiteThreshold = 235; // near-white

    // Build binary mask: 1 = white pixel
    const mask = new Uint8Array(imgWidth * imgHeight);
    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const idx = (y * imgWidth + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
          mask[y * imgWidth + x] = 1;
        }
      }
    }

    // Find rows where >50% of pixels in the central 60% of width are white
    const leftBound = Math.floor(imgWidth * 0.2);
    const rightBound = Math.floor(imgWidth * 0.8);
    const checkWidth = rightBound - leftBound;

    let bestRect: ScreenRect | null = null;
    let bestArea = 0;

    // Sliding window: find the largest contiguous vertical band of white rows
    let startRow = -1;
    let longestStart = -1;
    let longestLen = 0;

    for (let y = 0; y < imgHeight; y++) {
      let whiteCount = 0;
      for (let x = leftBound; x < rightBound; x++) {
        if (mask[y * imgWidth + x]) whiteCount++;
      }
      const whiteFraction = whiteCount / checkWidth;

      if (whiteFraction > 0.7) {
        if (startRow === -1) startRow = y;
        const len = y - startRow + 1;
        if (len > longestLen) {
          longestLen = len;
          longestStart = startRow;
        }
      } else {
        startRow = -1;
      }
    }

    if (longestLen < imgHeight * 0.3) {
      return null; // Not a meaningful white region
    }

    // Now find horizontal extent within those rows
    const midY = Math.floor(longestStart + longestLen / 2);
    let xMin = imgWidth;
    let xMax = 0;

    for (let scan = longestStart; scan < longestStart + longestLen; scan += Math.max(1, Math.floor(longestLen / 10))) {
      let rowMin = imgWidth;
      let rowMax = 0;
      for (let x = 0; x < imgWidth; x++) {
        if (mask[scan * imgWidth + x]) {
          if (x < rowMin) rowMin = x;
          if (x > rowMax) rowMax = x;
        }
      }
      if (rowMin < xMin) xMin = rowMin;
      if (rowMax > xMax) xMax = rowMax;
    }

    if (xMax <= xMin) return null;

    const rect: ScreenRect = {
      x: xMin,
      y: longestStart,
      width: xMax - xMin + 1,
      height: longestLen,
    };

    // Sanity check: screen should be in the lower half and reasonable proportions
    const screenAspect = rect.width / rect.height;
    if (screenAspect < 0.3 || screenAspect > 1.5) return null;
    if (rect.y < imgHeight * 0.15) return null; // Too high up — not a phone screen
    if (rect.width < imgWidth * 0.1) return null; // Too narrow

    return rect;
  } catch {
    return null;
  }
}

function estimateScreenPosition(canvasW: number, canvasH: number, device: DeviceType): ScreenRect {
  if (device === 'ipad') {
    const frameH = canvasH * 0.60;
    const frameW = frameH * (1024 / 1366);
    const frameX = (canvasW - frameW) / 2;
    const frameY = canvasH * 0.30;
    const bezelW = frameW * 0.022;
    const bezelH = frameH * 0.025;
    return {
      x: Math.round(frameX + bezelW),
      y: Math.round(frameY + bezelH),
      width: Math.round(frameW - bezelW * 2),
      height: Math.round(frameH - bezelH * 2),
    };
  } else {
    const frameH = canvasH * 0.62;
    const frameW = frameH * 0.49;
    const frameX = (canvasW - frameW) / 2;
    const frameY = canvasH * 0.30;
    const bezelW = frameW * 0.025;
    return {
      x: Math.round(frameX + bezelW),
      y: Math.round(frameY + bezelW),
      width: Math.round(frameW - bezelW * 2),
      height: Math.round(frameH - bezelW * 2),
    };
  }
}

async function applyRoundedCorners(
  buffer: Buffer,
  width: number,
  height: number,
  radius: number
): Promise<Buffer> {
  const svgMask = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/>
  </svg>`;

  return sharp(buffer)
    .resize(width, height, { fit: 'fill' })
    .composite([{ input: Buffer.from(svgMask), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

export async function compositeScreenshot(
  frameBuffer: Buffer,
  screenshotPath: string,
  outputPath: string,
  outputWidth: number,
  outputHeight: number,
  deviceType: DeviceType
): Promise<void> {
  if (!fs.existsSync(screenshotPath)) {
    throw new Error(`Screenshot not found: ${screenshotPath}`);
  }

  // Resize frame to exact output dimensions
  const resizedFrame = await sharp(frameBuffer)
    .resize(outputWidth, outputHeight, { fit: 'fill' })
    .toBuffer();

  // Detect white screen area
  let screenRect = await detectWhiteRectangle(resizedFrame, outputWidth, outputHeight);

  if (!screenRect) {
    console.log(`  ⚠ White rectangle not detected, using estimated position`);
    screenRect = estimateScreenPosition(outputWidth, outputHeight, deviceType);
  }

  // Resize screenshot to fit screen area
  const cornerRadius =
    deviceType === 'ipad'
      ? Math.round(screenRect.width * 0.04)
      : Math.round(screenRect.width * 0.10);

  const screenshotBuffer = await sharp(screenshotPath)
    .resize(screenRect.width, screenRect.height, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  const rounded = await applyRoundedCorners(screenshotBuffer, screenRect.width, screenRect.height, cornerRadius);

  // Composite
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(resizedFrame)
    .composite([{ input: rounded, left: screenRect.x, top: screenRect.y }])
    .png({ quality: 95 })
    .toFile(outputPath);
}

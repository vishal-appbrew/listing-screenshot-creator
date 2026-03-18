import { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { costTracker } from '../utils/costTracker';
import { getBrowser, createPage } from './browser';
import { discoverPages, DiscoveredPages } from './pageDiscovery';
import { extractAssets, BrandAssets } from './assetExtractor';
import { cleanPage, autoScroll } from './pageCleaner';
import { VIEWPORTS } from '../config/dimensions';

export interface CaptureResult {
  screenshots: Record<string, string>;
  assets: BrandAssets;
  discoveredUrls: Omit<DiscoveredPages, 'hamburgerSelector'>;
}

async function navigateAndClean(page: Page, url: string): Promise<boolean> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));
    // Force content visible (Squarespace/Wix load behind opacity:0 transitions)
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = 'html, body { opacity: 1 !important; visibility: visible !important; }';
      document.head?.appendChild(s);
    });
    // Scroll down and back to trigger lazy-loaded images/content
    await page.evaluate(() => { window.scrollTo(0, 300); });
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await new Promise(r => setTimeout(r, 400));
    await cleanPage(page);
    await new Promise(r => setTimeout(r, 500));
    return true;
  } catch {
    return false;
  }
}

async function alignViewport(page: Page, pageType: 'home' | 'pdp' | 'plp' | 'category'): Promise<void> {
  switch (pageType) {
    case 'home':
    case 'category':
      await page.evaluate(() => window.scrollTo(0, 0));
      break;
    case 'pdp':
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        // Try to scroll the product info section into view if it's off-screen
        const productEl = document.querySelector(
          '[class*="product__info"], [class*="product-info"], [class*="product__main"], ' +
          '[class*="product-details"], .product-main, main .product, [data-section-type="product"]'
        ) as HTMLElement | null;
        if (productEl) {
          const rect = productEl.getBoundingClientRect();
          if (rect.top > window.innerHeight * 0.8 || rect.top < -100) {
            productEl.scrollIntoView({ block: 'start', behavior: 'instant' });
          }
        }
      });
      break;
    case 'plp':
      // Start from top: shows collection title + filter bar + product grid
      await page.evaluate(() => window.scrollTo(0, 0));
      break;
  }
  await new Promise(r => setTimeout(r, 500));
}

// ── Screenshot verification via Gemini Vision ─────────────────────────────────

async function verifyScreenshot(
  buffer: Buffer,
  pageType: 'home' | 'pdp' | 'plp' | 'category'
): Promise<{ isCorrect: boolean; issue: string | null; suggestion: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { isCorrect: true, issue: null, suggestion: null };

  const expectedContent: Record<string, string> = {
    home: 'Hero banner or marketing imagery, brand navigation, product carousel or categories visible. Header with brand logo at the top.',
    pdp: 'A SINGLE product showing its main product image, product name, price, and ideally Add to Cart button. Must NOT be showing product reviews, FAQ section, or footer content.',
    plp: 'A grid of products with images, names, and prices. Collection or category title visible at top.',
    category: 'A navigation menu or drawer showing category list, OR a categories overview page. Must be visually different from a product listing grid.',
  };

  const payload = JSON.stringify({
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/png', data: buffer.toString('base64') } },
        { text: `This screenshot was captured from a ${pageType.toUpperCase()} page for an app store listing.\n\nExpected: ${expectedContent[pageType]}\n\nIs this screenshot showing the right content? Reply with JSON only:\n{"isCorrect": true or false, "issue": null or brief description, "suggestion": null or one of "scroll_to_top", "scroll_up_400", "scroll_down_300"}` },
      ],
    }],
    generationConfig: { maxOutputTokens: 150 },
  });

  return new Promise((resolve) => {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload).toString() } },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            costTracker.track('screenshot_verification', 'gemini-2.0-flash', parsed?.usageMetadata);
            const clean = text.replace(/```json\s*/i, '').replace(/```\s*/i, '').replace(/```/g, '').trim();
            const result = JSON.parse(clean);
            resolve({ isCorrect: result.isCorrect !== false, issue: result.issue ?? null, suggestion: result.suggestion ?? null });
          } catch {
            resolve({ isCorrect: true, issue: null, suggestion: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ isCorrect: true, issue: null, suggestion: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ isCorrect: true, issue: null, suggestion: null }); });
    req.write(payload);
    req.end();
  });
}

async function applySuggestion(page: Page, suggestion: string | null): Promise<void> {
  if (!suggestion) return;
  if (suggestion === 'scroll_to_top') {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else if (suggestion === 'scroll_up_400') {
    await page.evaluate(() => window.scrollBy(0, -400));
  } else if (suggestion === 'scroll_down_300') {
    await page.evaluate(() => window.scrollBy(0, 300));
  }
  await new Promise(r => setTimeout(r, 600));
}

// ── Main capture function ─────────────────────────────────────────────────────

export async function captureAll(homepageUrl: string, tempDir: string): Promise<CaptureResult> {
  fs.mkdirSync(path.join(tempDir, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });

  const browser = await getBrowser();

  // Initial page: discover + extract assets
  const discoverPage = await createPage(browser, VIEWPORTS.mobile.width, VIEWPORTS.mobile.height, 1);
  await discoverPage.goto(homepageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  await discoverPage.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'html, body { opacity: 1 !important; visibility: visible !important; }';
    document.head?.appendChild(s);
    window.scrollTo(0, 400);
  });
  await new Promise(r => setTimeout(r, 700));
  await discoverPage.evaluate(() => { window.scrollTo(0, 0); });
  await new Promise(r => setTimeout(r, 400));
  await cleanPage(discoverPage);

  const [pages, assets] = await Promise.all([
    discoverPages(discoverPage, homepageUrl),
    extractAssets(discoverPage, tempDir),
  ]);
  await discoverPage.close();

  const screenshots: Record<string, string> = {};

  for (const [viewportName, dims] of Object.entries(VIEWPORTS) as [keyof typeof VIEWPORTS, typeof VIEWPORTS[keyof typeof VIEWPORTS]][]) {
    const page = await createPage(browser, dims.width, dims.height, dims.deviceScaleFactor);

    // ── Home ──────────────────────────────────────────────────────────────────
    const homeFile = path.join(tempDir, 'screenshots', `home-${viewportName}.png`);
    await navigateAndClean(page, pages.homepage);
    await alignViewport(page, 'home');
    await page.screenshot({ path: homeFile as `${string}.png`, fullPage: false });
    screenshots[`home-${viewportName}`] = homeFile;

    // ── PDP (with verification + retry) ──────────────────────────────────────
    const pdpFile = path.join(tempDir, 'screenshots', `pdp-${viewportName}.png`);
    if (pages.pdp) {
      const ok = await navigateAndClean(page, pages.pdp);
      if (ok) {
        await alignViewport(page, 'pdp');
        await page.screenshot({ path: pdpFile as `${string}.png`, fullPage: false });

        // Screenshot verification via AI disabled — user reviews in editor
        screenshots[`pdp-${viewportName}`] = pdpFile;
      }
    }
    if (!screenshots[`pdp-${viewportName}`]) {
      fs.copyFileSync(homeFile, pdpFile);
      screenshots[`pdp-${viewportName}`] = pdpFile;
    }

    // ── PLP ───────────────────────────────────────────────────────────────────
    const plpFile = path.join(tempDir, 'screenshots', `plp-${viewportName}.png`);
    if (pages.plp) {
      const ok = await navigateAndClean(page, pages.plp);
      if (ok) {
        await alignViewport(page, 'plp');
        await page.screenshot({ path: plpFile as `${string}.png`, fullPage: false });
        screenshots[`plp-${viewportName}`] = plpFile;
      }
    }
    if (!screenshots[`plp-${viewportName}`]) {
      fs.copyFileSync(homeFile, plpFile);
      screenshots[`plp-${viewportName}`] = plpFile;
    }

    // ── Category ──────────────────────────────────────────────────────────────
    const catFile = path.join(tempDir, 'screenshots', `category-${viewportName}.png`);
    let catCaptured = false;

    if (viewportName === 'mobile') {
      // Mobile strategy 1: open hamburger/drawer menu (visually distinct from PLP)
      await navigateAndClean(page, pages.homepage);
      const hamburgerSel = pages.hamburgerSelector ||
        'button[aria-label*="menu" i], [class*="hamburger"], [class*="menu-toggle"], .header__icon--menu, button[data-action="toggle-menu"]';
      try {
        await page.click(hamburgerSel);
        await new Promise(r => setTimeout(r, 900));
        // Verify menu actually opened (something shifted or appeared)
        const menuVisible = await page.evaluate(() => {
          const drawers = document.querySelectorAll('[class*="drawer"], [class*="mobile-nav"], [class*="nav-drawer"], [id*="menu"], [class*="menu-open"]');
          for (const d of Array.from(drawers)) {
            const style = getComputedStyle(d);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') return true;
          }
          return false;
        });
        if (menuVisible) {
          await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
          screenshots[`category-${viewportName}`] = catFile;
          catCaptured = true;
          console.log('  ✓ Category: hamburger menu opened');
        }
      } catch { /* fall through */ }

      // Mobile strategy 2: navigate to a different collection than PLP
      if (!catCaptured) {
        const altUrl = await findAlternativeCollectionUrl(page, pages.homepage, pages.plp);
        if (altUrl) {
          const ok = await navigateAndClean(page, altUrl);
          if (ok) {
            await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
            screenshots[`category-${viewportName}`] = catFile;
            catCaptured = true;
            console.log(`  ✓ Category: alternative collection (${altUrl})`);
          }
        }
      }

      // Mobile strategy 3: /collections index
      if (!catCaptured) {
        const collectionsUrl = new URL('/collections', pages.homepage).href;
        const ok = await navigateAndClean(page, collectionsUrl).catch(() => false);
        if (ok) {
          await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
          screenshots[`category-${viewportName}`] = catFile;
          catCaptured = true;
          console.log('  ✓ Category: /collections index');
        }
      }
    } else {
      // Tablet strategy 1: prefer a DIFFERENT collection from PLP
      const tabletCatUrl = await findTabletCategoryUrl(page, pages.homepage, pages.plp);
      if (tabletCatUrl) {
        const ok = await navigateAndClean(page, tabletCatUrl);
        if (ok) {
          await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
          screenshots[`category-${viewportName}`] = catFile;
          catCaptured = true;
        }
      }
      // Tablet strategy 2: /collections index
      if (!catCaptured) {
        const collectionsUrl = new URL('/collections', pages.homepage).href;
        const ok = await navigateAndClean(page, collectionsUrl).catch(() => false);
        if (ok) {
          await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
          screenshots[`category-${viewportName}`] = catFile;
          catCaptured = true;
        }
      }
      // Tablet strategy 3: homepage scrolled to category section
      if (!catCaptured) {
        const ok = await navigateAndClean(page, pages.homepage);
        if (ok) {
          await page.evaluate(() => {
            const sections = Array.from(document.querySelectorAll('section, [class*="collection"], [class*="category"]'));
            for (const sec of sections) {
              const text = (sec.textContent || '').toLowerCase();
              if (text.includes('category') || text.includes('shop by') || text.includes('collection')) {
                (sec as HTMLElement).scrollIntoView({ block: 'start' });
                return;
              }
            }
            window.scrollTo(0, window.innerHeight * 1.5);
          });
          await new Promise(r => setTimeout(r, 500));
          await page.screenshot({ path: catFile as `${string}.png`, fullPage: false });
          screenshots[`category-${viewportName}`] = catFile;
          catCaptured = true;
        }
      }
    }

    if (!catCaptured) {
      fs.copyFileSync(plpFile, catFile);
      screenshots[`category-${viewportName}`] = catFile;
    }

    await page.close();
  }

  return {
    screenshots,
    assets,
    discoveredUrls: {
      homepage: pages.homepage,
      pdp: pages.pdp,
      plp: pages.plp,
      category: pages.category,
    },
  };
}

async function findAlternativeCollectionUrl(
  page: Page,
  homepageUrl: string,
  plpUrl: string | null
): Promise<string | null> {
  try {
    const base = new URL(homepageUrl).origin;
    return await page.evaluate((baseUrl: string, excludeUrl: string | null) => {
      const patterns = [/\/collections?\//i, /\/categor(y|ies)\//i, /\/shop\//i, /\/c\//i];
      const excludePatterns = [/sale/i, /clearance/i, /cart/i, /account/i, /login/i, /wishlist/i];
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const seen = new Set<string>();
      if (excludeUrl) seen.add(excludeUrl);
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (excludePatterns.some(p => p.test(href))) continue;
        if (!patterns.some(p => p.test(href))) continue;
        try {
          const full = href.startsWith('http') ? href : new URL(href, baseUrl).href;
          if (!seen.has(full)) return full;
        } catch { /* skip */ }
      }
      return null;
    }, base, plpUrl);
  } catch {
    return null;
  }
}

async function findTabletCategoryUrl(
  page: Page,
  homepageUrl: string,
  plpUrl: string | null
): Promise<string | null> {
  try {
    await page.goto(homepageUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    const base = new URL(homepageUrl).origin;

    return await page.evaluate((baseUrl: string, excludeUrl: string | null) => {
      const patterns = [/\/collections?\//i, /\/categor(y|ies)\//i, /\/shop\//i, /\/c\//i];
      const excludePatterns = [/sale/i, /clearance/i, /cart/i, /account/i, /login/i];
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const seen = new Set<string>();
      if (excludeUrl) seen.add(excludeUrl);

      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (excludePatterns.some(p => p.test(href))) continue;
        if (!patterns.some(p => p.test(href))) continue;
        const full = href.startsWith('http') ? href : new URL(href, baseUrl).href;
        if (!seen.has(full)) return full;
        seen.add(full);
      }
      return null;
    }, base, plpUrl);
  } catch {
    return null;
  }
}

import puppeteer, { Browser, Page } from 'puppeteer';

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--lang=en-US,en',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled', // bypass bot detection
        '--window-size=430,932',
      ],
    });
  }
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function createPage(
  browser: Browser,
  width: number,
  height: number,
  deviceScaleFactor = 1
): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor });
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  // Spoof navigator.webdriver to bypass bot detection (Squarespace, Cloudflare, etc.)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    (window as any).chrome = { runtime: {} };
  });
  // Block analytics, tracking, and ads for faster loads
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const blockPatterns = [
      /google-analytics/i, /googletagmanager/i, /facebook\.net/i,
      /hotjar/i, /segment\.io/i, /mixpanel/i, /amplitude/i,
      /ads\./i, /doubleclick/i, /adservice/i,
    ];
    if (blockPatterns.some(p => p.test(url))) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

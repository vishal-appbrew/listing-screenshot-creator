import { Page } from 'puppeteer';

export async function cleanPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    // 1. Remove announcement bars, promo bars, sticky top bars
    const topBarSelectors = [
      '[class*="announcement"]', '[class*="top-bar"]', '[class*="promo-bar"]',
      '[class*="sitewide"]', '[class*="alert-bar"]', '[class*="notification-bar"]',
      '[class*="header-banner"]', '[class*="sticky-bar"]', '[class*="marquee"]',
      '[id*="announcement"]', '[id*="top-bar"]', '[id*="promo-bar"]',
      'div[data-section-type="announcement-bar"]',
      '.announcement-bar', '#shopify-section-announcement-bar',
      '[class*="free-shipping"]', '[class*="ticker"]',
    ];

    // 2. Remove popups, modals, overlays
    // NOTE: '[class*="overlay"]' is intentionally excluded — too broad, breaks Squarespace content blocks
    const popupSelectors = [
      '[class*="popup"]', '[class*="modal"]',
      '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
      '[class*="newsletter"]', '[class*="subscribe"]', '[class*="signup-modal"]',
      '[class*="exit-intent"]', '[class*="klaviyo"]', '[class*="privy"]',
      '.needsclick', '[id*="popup"]', '[id*="modal"]',
      '[id*="cookie"]', '[class*="lightbox"]',
    ];

    // 3. Remove chat widgets
    const chatSelectors = [
      '[class*="chat-widget"]', '[class*="chat-bubble"]', '[class*="chat-launcher"]',
      '[id*="intercom"]', '[id*="crisp"]', '[id*="drift"]', '[id*="freshchat"]',
      '[id*="tawk"]', '[id*="zendesk"]', '[id*="helpshift"]',
      '[class*="whatsapp"]', '[id*="whatsapp"]',
      'iframe[src*="chat"]', 'iframe[src*="intercom"]',
      '#hubspot-messages-iframe-container', '[id*="fc_widget"]',
      '[class*="tidio"]', '[id*="tidio"]',
    ];

    const allSelectors = [...topBarSelectors, ...popupSelectors, ...chatSelectors];
    for (const sel of allSelectors) {
      try {
        document.querySelectorAll(sel).forEach(el => el.remove());
      } catch { /* ignore invalid selectors */ }
    }

    // 4. Remove fixed/sticky elements at top or bottom that aren't nav/header
    document.querySelectorAll('*').forEach(el => {
      try {
        const style = getComputedStyle(el as Element);
        const rect = (el as Element).getBoundingClientRect();
        if (
          (style.position === 'fixed' || style.position === 'sticky') &&
          rect.height < 150 &&
          !(el as Element).closest('nav') &&
          !(el as Element).closest('header') &&
          !(el as Element).querySelector('nav') &&
          (el as Element).tagName !== 'NAV' &&
          (el as Element).tagName !== 'HEADER'
        ) {
          if (rect.top < 80 || rect.bottom > window.innerHeight - 80) {
            (el as Element).remove();
          }
        }
      } catch { /* ignore */ }
    });

    // 5. Restore scroll
    if (document.body) document.body.style.overflow = 'auto';
    if (document.documentElement) document.documentElement.style.overflow = 'auto';

    // 6. Force-reveal content hidden by loading transitions (Squarespace, Wix, etc.)
    // These platforms animate opacity/visibility on body/html during load and
    // headless Chrome sometimes catches the page mid-transition
    if (document.body) {
      document.body.style.opacity = '1';
      document.body.style.visibility = 'visible';
    }
    if (document.documentElement) {
      (document.documentElement as HTMLElement).style.opacity = '1';
      (document.documentElement as HTMLElement).style.visibility = 'visible';
    }
    // Remove Squarespace / common preloader elements
    const preloaderSelectors = [
      '[class*="preloader"]', '[class*="pre-loader"]', '[class*="page-loader"]',
      '[class*="loading-screen"]', '[class*="splash-screen"]', '#loading', '#preloader',
      '.sqs-skip-link', // Squarespace skip-to-content overlays
    ];
    for (const sel of preloaderSelectors) {
      try { document.querySelectorAll(sel).forEach(el => (el as HTMLElement).remove()); } catch {}
    }
  });

  await new Promise(r => setTimeout(r, 300));
}

export async function autoScroll(page: Page, times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    await new Promise(r => setTimeout(r, 600));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));
}

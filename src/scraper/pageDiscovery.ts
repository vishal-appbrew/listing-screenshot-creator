import { Page } from 'puppeteer';
import { cleanPage, autoScroll } from './pageCleaner';

export interface DiscoveredPages {
  homepage: string;
  pdp: string | null;
  plp: string | null;
  category: string | 'HAMBURGER_MENU' | null;
  hamburgerSelector: string | null;
}

export async function discoverPages(page: Page, homepageUrl: string): Promise<DiscoveredPages> {
  const result: DiscoveredPages = {
    homepage: homepageUrl,
    pdp: null,
    plp: null,
    category: null,
    hamburgerSelector: null,
  };

  // Scroll to trigger lazy loading
  await autoScroll(page, 3);

  const base = new URL(homepageUrl).origin;

  // --- Find PDP ---
  const pdpHref = await page.evaluate((baseUrl: string) => {
    const productPatterns = [
      /\/products?\//i, /\/p\//i, /\/item\//i, /\/detail\//i,
      /\/dp\//i, /\/sku\//i,
    ];
    const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const productLinks = allLinks.filter(a => {
      const href = a.getAttribute('href') || '';
      return productPatterns.some(p => p.test(href)) && href !== '/' && href !== baseUrl;
    });

    // Prefer links inside product card elements
    const cardLinks = productLinks.filter(a => {
      return !!(a.closest('[class*="product"], [class*="card"], [class*="item"], [data-product-id], [data-product]'));
    });

    // Try second then first (second avoids featured hero products with unusual layouts)
    const link = cardLinks[1] || cardLinks[0] || productLinks[1] || productLinks[0];
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('http')) return href;
    try { return new URL(href, baseUrl).href; } catch { return null; }
  }, base);
  result.pdp = pdpHref;

  // --- Find PLP ---
  const plpHref = await page.evaluate((baseUrl: string) => {
    const collectionPatterns = [
      /\/collections?\//i, /\/categor(y|ies)\//i,
      /\/shop\/?$/i, /\/shop\/[^\/]+\/?$/i,
      /\/c\//i, /\/new(-arrivals?)?\/?$/i, /\/arrivals\//i,
      /\/all\/?$/i, /\/catalog/i,
    ];
    const excludePatterns = [/sale/i, /clearance/i, /cart/i, /account/i, /login/i, /wishlist/i, /search/i];

    const allLinks = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const collectionLinks = allLinks.filter(a => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      return (
        collectionPatterns.some(p => p.test(href)) &&
        !excludePatterns.some(p => p.test(href)) &&
        href !== '/' && text.length > 0
      );
    });

    // Sort by preference
    const priority = ['new', 'arrival', 'all', 'collection', 'women', 'men', 'shop'];
    const sorted = collectionLinks.sort((a, b) => {
      const aText = (a.textContent || '').toLowerCase();
      const bText = (b.textContent || '').toLowerCase();
      const aScore = priority.filter(p => aText.includes(p)).length;
      const bScore = priority.filter(p => bText.includes(p)).length;
      return bScore - aScore;
    });

    const link = sorted[0];
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('http')) return href;
    try { return new URL(href, baseUrl).href; } catch { return null; }
  }, base);
  result.plp = plpHref;

  // --- Find Category / Hamburger ---
  const hamburgerSel = await page.evaluate(() => {
    const selectors = [
      'button[aria-label*="menu" i]',
      'button[aria-label*="Menu" i]',
      'button[aria-label*="nav" i]',
      '[class*="hamburger"]',
      '[class*="menu-toggle"]',
      '[class*="mobile-menu"]',
      '[class*="mobile-menu-toggle"]',
      '[class*="nav-toggle"]',
      '[class*="drawer-toggle"]',
      '.header__icon--menu',
      'button[data-action="toggle-menu"]',
      '[class*="burger"]',
      '[data-drawer-open]',
      '[class*="js-mobile-nav"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return sel;
    }
    // Last resort: find first small button in header (hamburger buttons are typically small/square)
    const headerBtns = Array.from(document.querySelectorAll('header button, [class*="header"] button, nav button'));
    for (const btn of headerBtns) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 20 && rect.width < 65 && rect.height > 20 && rect.height < 65) {
        // Give it a unique selector via its classes
        const cls = (btn.className || '').split(' ').filter(Boolean)[0];
        return cls ? `.${cls}` : 'header button:first-of-type';
      }
    }
    return null;
  });

  if (hamburgerSel) {
    result.category = 'HAMBURGER_MENU';
    result.hamburgerSelector = hamburgerSel;
  } else {
    // Look for a categories page link
    const catHref = await page.evaluate((baseUrl: string) => {
      const catPatterns = [/\/categories/i, /\/shop-all/i, /\/all\/?$/i, /\/brands/i, /\/departments/i];
      const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      const catLink = links.find(a => {
        const href = a.getAttribute('href') || '';
        return catPatterns.some(p => p.test(href));
      });
      if (!catLink) return null;
      const href = catLink.getAttribute('href') || '';
      if (href.startsWith('http')) return href;
      try { return new URL(href, baseUrl).href; } catch { return null; }
    }, base);
    result.category = catHref;
  }

  return result;
}

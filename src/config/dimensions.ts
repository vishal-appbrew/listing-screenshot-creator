export const DIMENSIONS = {
  iOS: {
    width: 1242,
    height: 2688,
    label: 'ios-6.5',
    deviceType: 'iphone' as const,
    viewport: 'mobile' as const,
  },
  playStore: {
    width: 1080,
    height: 1920,
    label: 'playstore',
    deviceType: 'android' as const,
    viewport: 'mobile' as const,
  },
  iPad: {
    width: 2048,
    height: 2732,
    label: 'ipad',
    deviceType: 'ipad' as const,
    viewport: 'tablet' as const,
  },
} as const;

export const VIEWPORTS = {
  mobile: { width: 393, height: 852, deviceScaleFactor: 3 },
  tablet: { width: 1024, height: 1366, deviceScaleFactor: 2 },
} as const;

export type DeviceType = 'iphone' | 'android' | 'ipad';
export type Style = 'clean' | 'premium' | 'bold';

export const STYLES: Style[] = ['clean', 'premium', 'bold'];

export const SCREEN_NAMES = ['home', 'pdp', 'plp', 'category'] as const;
export type ScreenName = typeof SCREEN_NAMES[number];

export const SCREEN_LABELS: Record<ScreenName, string> = {
  home: 'Homepage',
  pdp: 'Product Detail',
  plp: 'Product Listing',
  category: 'Categories',
};

import { ElementResolver } from '../src/modules/browserstack/element-resolver';

const PAGE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.LinearLayout bounds="[0,0][1080,2400]" clickable="false">
    <android.widget.EditText text="" content-desc="Email" bounds="[40,400][1040,500]" clickable="true" />
    <android.widget.EditText text="" content-desc="Password" bounds="[40,600][1040,700]" clickable="true" />
    <android.widget.Button text="Sign in" bounds="[40,800][1040,900]" clickable="true" />
    <android.widget.Button text="Forgot password?" bounds="[40,950][1040,1020]" clickable="true" />
  </android.widget.LinearLayout>
</hierarchy>`;

function makeDriver(pageSource: string, findElement?: jest.Mock) {
  return {
    getPageSource: jest.fn().mockResolvedValue(pageSource),
    findElement: findElement ?? jest.fn().mockRejectedValue(new Error('not found')),
  };
}

describe('ElementResolver — Tier 1 (page source fuzzy match)', () => {
  it('resolves a button by visible text → coords from bounds center', async () => {
    const r = new ElementResolver();
    const driver = makeDriver(PAGE_SOURCE);
    const result = await r.resolve(
      { driver, platform: 'android', intent: 'tap', disableAiTier: true },
      'Sign in',
    );
    expect(result.kind).toBe('coords');
    if (result.kind === 'coords') {
      expect(result.x).toBe(540);
      expect(result.y).toBe(850);
      expect(result.tier).toBe(1);
      expect(result.source).toBe('page-source');
    }
  });

  it('resolves an input by content-desc when no visible text', async () => {
    const r = new ElementResolver();
    const driver = makeDriver(PAGE_SOURCE);
    const result = await r.resolve(
      { driver, platform: 'android', intent: 'type', disableAiTier: true },
      'Email',
    );
    expect(result.kind).toBe('coords');
    if (result.kind === 'coords') {
      expect(result.y).toBe(450);
    }
  });

  it('fuzzy-matches partial hints like "Forgot pw" against "Forgot password?"', async () => {
    const r = new ElementResolver();
    const driver = makeDriver(PAGE_SOURCE);
    const result = await r.resolve(
      { driver, platform: 'android', intent: 'tap', disableAiTier: true },
      'Forgot password',
    );
    expect(result.kind).toBe('coords');
  });

  it('returns unresolved with diagnostics when no element matches', async () => {
    const r = new ElementResolver();
    const driver = makeDriver(PAGE_SOURCE);
    const result = await r.resolve(
      { driver, platform: 'android', intent: 'tap', disableAiTier: true },
      'Definitely not present',
    );
    expect(result.kind).toBe('unresolved');
    if (result.kind === 'unresolved') {
      expect(result.tried.length).toBeGreaterThan(0);
      expect(result.visibleLabels).toBeDefined();
      expect(result.visibleLabels?.some((l) => l.includes('Sign in'))).toBe(true);
    }
  });
});

describe('ElementResolver — invalidateScreen forces page-source refetch', () => {
  it('refetches page source after invalidateScreen()', async () => {
    const r = new ElementResolver();
    const getPageSource = jest.fn().mockResolvedValue(PAGE_SOURCE);
    const driver = { getPageSource, findElement: jest.fn().mockRejectedValue(new Error('not found')) };

    await r.resolve({ driver, platform: 'android', intent: 'tap', disableAiTier: true }, 'Sign in');
    await r.resolve({ driver, platform: 'android', intent: 'tap', disableAiTier: true }, 'Sign in');
    expect(getPageSource).toHaveBeenCalledTimes(1);

    r.invalidateScreen();
    await r.resolve({ driver, platform: 'android', intent: 'tap', disableAiTier: true }, 'Sign in');
    expect(getPageSource).toHaveBeenCalledTimes(2); // refetched
  });
});

describe('ElementResolver — empty hint short-circuit', () => {
  it('returns unresolved for empty hints without driver calls', async () => {
    const r = new ElementResolver();
    const driver = makeDriver(PAGE_SOURCE);
    const result = await r.resolve({ driver, platform: 'android', disableAiTier: true }, '');
    expect(result.kind).toBe('unresolved');
  });
});

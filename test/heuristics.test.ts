import {
  tryTextMatch,
  tryUserVisibleLabel,
  tryInternalIdentifier,
  tryXPath,
} from '../src/modules/self-healer/heuristics';

const ANDROID_PAGE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button text="Login" content-desc="Log in to your account" resource-id="com.app:id/login_btn" bounds="[40,400][1040,500]" />
  <android.widget.EditText text="" content-desc="Email address" resource-id="com.app:id/email_input" bounds="[40,200][1040,300]" />
</hierarchy>`;

const IOS_PAGE_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeButton label="Login" name="LoginButton" value="" accessibility-id="loginIdentifier" />
  <XCUIElementTypeTextField label="Email" name="EmailField" value="" accessibility-id="emailIdentifier" />
</XCUIElementTypeApplication>`;

describe('heuristics — text always wins on ties against internal IDs', () => {
  it('tryTextMatch returns higher confidence than tryInternalIdentifier for the same hint', () => {
    const text = tryTextMatch('Login', ANDROID_PAGE_SOURCE);
    const intId = tryInternalIdentifier('Login', ANDROID_PAGE_SOURCE);
    // Both may match (tryInternalIdentifier could fuzzy-hit "login_btn"), but text
    // confidence MUST exceed internal-identifier confidence.
    expect(text.matched).toBe(true);
    if (intId.matched) {
      expect(text.confidence).toBeGreaterThan(intId.confidence);
    }
  });

  it('tryTextMatch confidence range is 70-100', () => {
    const result = tryTextMatch('Login', ANDROID_PAGE_SOURCE);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(70);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it('tryUserVisibleLabel matches content-desc and label, range 60-90', () => {
    const result = tryUserVisibleLabel('Email address', ANDROID_PAGE_SOURCE);
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(60);
    expect(result.confidence).toBeLessThanOrEqual(90);
    expect(result.method).toBe('user-visible-label');
  });

  it('tryInternalIdentifier confidence cap is 55 — never beats text-match', () => {
    const result = tryInternalIdentifier('login_btn', ANDROID_PAGE_SOURCE);
    if (result.matched) {
      expect(result.confidence).toBeLessThanOrEqual(55);
      expect(result.confidence).toBeGreaterThanOrEqual(30);
    }
  });

  it('tryInternalIdentifier requires score >= 0.7 (stricter threshold)', () => {
    // "login" is a partial fuzzy match against "login_btn" / "loginidentifier" —
    // similar enough to trip looser thresholds but should not match the strict one.
    const fuzzyHint = 'logn';  // typo, deliberately weak
    const result = tryInternalIdentifier(fuzzyHint, ANDROID_PAGE_SOURCE);
    expect(result.matched).toBe(false);
  });
});

describe('heuristics — iOS internal-identifier search', () => {
  it('tryInternalIdentifier searches accessibility-id on iOS', () => {
    // Exact match on accessibility-id "loginIdentifier" should pass the 0.7 threshold.
    const result = tryInternalIdentifier('loginIdentifier', IOS_PAGE_SOURCE);
    expect(result.matched).toBe(true);
    expect(result.method).toBe('internal-identifier');
  });

  it('tryUserVisibleLabel matches iOS @label and @name', () => {
    const result = tryUserVisibleLabel('Login', IOS_PAGE_SOURCE);
    expect(result.matched).toBe(true);
  });
});

describe('heuristics — tryXPath remains as a flat-confidence fallback', () => {
  it('returns confidence 50 (lowered from 60) when matching by class+text', () => {
    const result = tryXPath('Login', ANDROID_PAGE_SOURCE);
    if (result.matched) {
      expect(result.confidence).toBe(50);
    }
  });
});

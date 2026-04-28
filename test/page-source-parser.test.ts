import {
  parsePageSource,
  getInteractableElements,
  getElementsWithText,
} from '../src/modules/browserstack/page-source-parser';

const ANDROID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.FrameLayout bounds="[0,0][1080,2400]" clickable="false">
    <android.widget.LinearLayout bounds="[0,100][1080,300]" clickable="false">
      <android.widget.TextView text="Welcome back" bounds="[40,150][800,250]" clickable="false" />
      <android.widget.EditText text="" content-desc="Email field" bounds="[40,400][1040,500]" clickable="true" />
      <android.widget.EditText text="" content-desc="Password field" bounds="[40,600][1040,700]" clickable="true" />
      <android.widget.Button text="Sign in" bounds="[40,800][1040,900]" clickable="true" />
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`;

const IOS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="MyApp" x="0" y="0" width="390" height="844">
    <XCUIElementTypeStaticText name="Welcome back" label="Welcome back" x="20" y="100" width="350" height="40" />
    <XCUIElementTypeTextField name="Email" label="Email" x="20" y="200" width="350" height="44" />
    <XCUIElementTypeSecureTextField name="Password" label="Password" x="20" y="260" width="350" height="44" />
    <XCUIElementTypeButton name="Sign in" label="Sign in" x="20" y="340" width="350" height="50" />
  </XCUIElementTypeApplication>
</AppiumAUT>`;

describe('parsePageSource — Android', () => {
  const elements = parsePageSource(ANDROID_XML);

  it('extracts elements with bounds and converts to centerX/centerY', () => {
    const signIn = elements.find((e) => e.text === 'Sign in');
    expect(signIn).toBeDefined();
    expect(signIn!.bounds.centerX).toBe(540); // (40 + 1040) / 2
    expect(signIn!.bounds.centerY).toBe(850); // (800 + 900) / 2
  });

  it('marks Button + EditText as clickable even without explicit clickable=true', () => {
    const button = elements.find((e) => e.type.endsWith('Button'));
    expect(button?.clickable).toBe(true);
  });

  it('extracts content-desc for inputs without visible text', () => {
    const email = elements.find((e) => e.contentDesc === 'Email field');
    expect(email).toBeDefined();
    expect(email!.bounds.centerY).toBe(450);
  });

  it('preserves hierarchy path', () => {
    const button = elements.find((e) => e.text === 'Sign in');
    expect(button?.hierarchyPath).toContain('android.widget.LinearLayout');
    expect(button?.hierarchyPath).toContain('android.widget.Button');
  });
});

describe('parsePageSource — iOS', () => {
  const elements = parsePageSource(IOS_XML);

  it('extracts XCUITest elements with x/y/width/height attrs', () => {
    const signIn = elements.find((e) => e.label === 'Sign in');
    expect(signIn).toBeDefined();
    expect(signIn!.bounds.x).toBe(20);
    expect(signIn!.bounds.y).toBe(340);
    expect(signIn!.bounds.centerX).toBe(195); // 20 + 350/2
  });

  it('marks XCUIElementTypeButton/TextField as inherently clickable', () => {
    const button = elements.find((e) => e.type === 'XCUIElementTypeButton');
    const tf = elements.find((e) => e.type === 'XCUIElementTypeTextField');
    expect(button?.clickable).toBe(true);
    expect(tf?.clickable).toBe(true);
  });
});

describe('parsePageSource — edge cases', () => {
  it('handles empty / null / non-string input', () => {
    expect(parsePageSource('')).toEqual([]);
    expect(parsePageSource(null as unknown as string)).toEqual([]);
  });

  it('skips elements with no bounds attributes', () => {
    const xml = `<root><node text="floating" /></root>`;
    expect(parsePageSource(xml)).toHaveLength(0);
  });

  it('skips elements with zero or negative bounds', () => {
    const xml = `<root><node text="bad" bounds="[100,100][100,100]" /></root>`;
    expect(parsePageSource(xml)).toHaveLength(0);
  });

  it('decodes XML entities in attributes', () => {
    const xml = `<root><n text="A&amp;B" bounds="[0,0][10,10]" /></root>`;
    const els = parsePageSource(xml);
    expect(els[0].text).toBe('A&B');
  });
});

describe('getInteractableElements / getElementsWithText', () => {
  const elements = parsePageSource(ANDROID_XML);

  it('returns only clickable elements from getInteractableElements', () => {
    const interactable = getInteractableElements(elements);
    expect(interactable.every((e) => e.clickable)).toBe(true);
    expect(interactable.find((e) => e.text === 'Welcome back')).toBeUndefined();
  });

  it('returns elements with any text/label/desc from getElementsWithText', () => {
    const withText = getElementsWithText(elements);
    expect(withText.find((e) => e.text === 'Welcome back')).toBeDefined();
  });
});

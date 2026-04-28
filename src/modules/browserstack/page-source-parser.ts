import { Logger } from '../../utils/logger';

const logger = new Logger('PageSourceParser');

export interface UIBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface UIElement {
  type: string;
  text?: string;
  label?: string;
  contentDesc?: string;
  name?: string;
  resourceId?: string;
  accessibilityId?: string;
  bounds: UIBounds;
  clickable: boolean;
  enabled: boolean;
  visible: boolean;
  hierarchyPath: string;
}

const ANDROID_INTERACTIVE_TYPES = [
  'Button',
  'EditText',
  'ImageButton',
  'CheckBox',
  'RadioButton',
  'Switch',
  'ToggleButton',
  'Spinner',
  'SeekBar',
];

const IOS_INTERACTIVE_TYPES = [
  'XCUIElementTypeButton',
  'XCUIElementTypeTextField',
  'XCUIElementTypeSecureTextField',
  'XCUIElementTypeSearchField',
  'XCUIElementTypeSwitch',
  'XCUIElementTypeLink',
  'XCUIElementTypeCell',
  'XCUIElementTypeTab',
  'XCUIElementTypeMenuItem',
  'XCUIElementTypeImage',
];

type Token =
  | { kind: 'open' | 'self'; tag: string; attrsRaw: string; idx: number }
  | { kind: 'close'; tag: string; idx: number };

// Parse Appium XML page source for both Android UiAutomator2 and iOS XCUITest formats.
// Returns a flat list of elements with bounds + visible-text metadata so the resolver
// can fuzzy-match step targets against them without needing accessibility identifiers.
export function parsePageSource(xml: string): UIElement[] {
  if (!xml || typeof xml !== 'string') return [];

  const tokens = tokenize(xml);
  const elements: UIElement[] = [];
  const stack: string[] = [];

  for (const tok of tokens) {
    if (tok.kind === 'close') {
      const last = stack.lastIndexOf(tok.tag);
      if (last >= 0) stack.splice(last, 1);
      continue;
    }

    const path = [...stack, tok.tag].join(' > ');
    if (tok.kind === 'open') stack.push(tok.tag);

    const attrs = parseAttributes(tok.attrsRaw);
    const bounds = extractBounds(attrs);
    if (!bounds) continue;

    elements.push({
      type: attrs['class'] || tok.tag,
      text: emptyToUndef(attrs['text'] || attrs['value']),
      label: emptyToUndef(attrs['label']),
      contentDesc: emptyToUndef(attrs['content-desc']),
      name: emptyToUndef(attrs['name']),
      resourceId: emptyToUndef(attrs['resource-id']),
      accessibilityId: emptyToUndef(attrs['accessibility-id']),
      bounds,
      clickable: parseBool(attrs['clickable']) || isInherentlyClickable(attrs['class'] || tok.tag),
      enabled: parseBool(attrs['enabled'], true),
      visible: parseBool(attrs['visible'], true) && parseBool(attrs['displayed'], true),
      hierarchyPath: path,
    });
  }

  logger.debug('Parsed page source', {
    totalElements: elements.length,
    interactable: elements.filter((e) => e.clickable).length,
  });
  return elements;
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagPattern.exec(xml)) !== null) {
    const isClose = m[1] === '/';
    const isSelf = m[4] === '/';
    if (isClose) {
      tokens.push({ kind: 'close', tag: m[2], idx: m.index });
    } else if (isSelf) {
      tokens.push({ kind: 'self', tag: m[2], attrsRaw: m[3] ?? '', idx: m.index });
    } else {
      tokens.push({ kind: 'open', tag: m[2], attrsRaw: m[3] ?? '', idx: m.index });
    }
  }
  return tokens;
}

function parseAttributes(attrsRaw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrPattern = /([\w:-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrPattern.exec(attrsRaw)) !== null) {
    out[m[1]] = decodeXmlEntities(m[2]);
  }
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractBounds(attrs: Record<string, string>): UIBounds | null {
  if (attrs['bounds']) {
    const m = attrs['bounds'].match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (m) {
      const x = parseInt(m[1], 10);
      const y = parseInt(m[2], 10);
      const x2 = parseInt(m[3], 10);
      const y2 = parseInt(m[4], 10);
      const width = x2 - x;
      const height = y2 - y;
      if (width <= 0 || height <= 0) return null;
      return {
        x,
        y,
        width,
        height,
        centerX: Math.floor(x + width / 2),
        centerY: Math.floor(y + height / 2),
      };
    }
  }
  if (attrs['x'] && attrs['y'] && attrs['width'] && attrs['height']) {
    const x = parseInt(attrs['x'], 10);
    const y = parseInt(attrs['y'], 10);
    const width = parseInt(attrs['width'], 10);
    const height = parseInt(attrs['height'], 10);
    if (Number.isNaN(x) || Number.isNaN(y) || width <= 0 || height <= 0) return null;
    return {
      x,
      y,
      width,
      height,
      centerX: Math.floor(x + width / 2),
      centerY: Math.floor(y + height / 2),
    };
  }
  return null;
}

function parseBool(v: string | undefined, defaultVal = false): boolean {
  if (v === undefined) return defaultVal;
  return v.toLowerCase() === 'true';
}

function emptyToUndef(s: string | undefined): string | undefined {
  if (!s || s.trim() === '') return undefined;
  return s;
}

function isInherentlyClickable(typeOrClass: string): boolean {
  if (!typeOrClass) return false;
  const t = typeOrClass;
  if (ANDROID_INTERACTIVE_TYPES.some((x) => t.endsWith(x) || t.includes(`.${x}`))) return true;
  if (IOS_INTERACTIVE_TYPES.includes(t)) return true;
  return false;
}

// Filter to elements that are visible, enabled, and either marked clickable or are
// inherently interactive types. Most resolver lookups should run against this subset
// to avoid matching against decorative TextView/ImageView noise.
export function getInteractableElements(elements: UIElement[]): UIElement[] {
  return elements.filter((e) => e.visible && e.enabled && e.clickable);
}

// All elements that carry visible text — useful for assertion-style steps
// ("user sees 'Welcome'") which shouldn't be limited to clickable items.
export function getElementsWithText(elements: UIElement[]): UIElement[] {
  return elements.filter(
    (e) => e.visible && (e.text || e.label || e.contentDesc || e.name),
  );
}

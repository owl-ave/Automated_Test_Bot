import { Logger } from '../../utils/logger';
import { tapAt, longPressAt } from './w3c-actions';
import type { ResolvedTarget } from './element-resolver';

const logger = new Logger('GestureExecutor');

interface ActionSequence {
  type: string;
  id: string;
  parameters?: { pointerType: string };
  actions: Action[];
}

interface Action {
  type: string;
  duration?: number;
  x?: number;
  y?: number;
  button?: number;
  origin?: string | { [key: string]: string };
}

// Resolve a string-or-target argument into tap coordinates. When given a string we
// treat it as an Appium element id (legacy callers). When given a ResolvedTarget we
// use coords directly or look up the element by strategy.
async function resolveToCoords(
  driver: any,
  target: string | ResolvedTarget,
): Promise<{ x: number; y: number }> {
  if (typeof target === 'string') {
    const element = await driver.findElement('id', target);
    return getElementCenterFromDriver(driver, element);
  }
  if (target.kind === 'coords') {
    return { x: target.x, y: target.y };
  }
  if (target.kind === 'locator') {
    const element = await driver.findElement(target.strategy, target.value);
    return getElementCenterFromDriver(driver, element);
  }
  throw new Error('Cannot resolve unresolved target — resolver returned no element');
}

async function getElementCenterFromDriver(
  driver: any,
  element: any,
): Promise<{ x: number; y: number }> {
  const id = element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'] || element;
  const rect = await driver.getElementRect(id);
  return {
    x: Math.floor(rect.x + rect.width / 2),
    y: Math.floor(rect.y + rect.height / 2),
  };
}

export class GestureExecutor {
  async tap(driver: any, target: string | ResolvedTarget): Promise<void> {
    logger.debug('Tap', { target });
    const { x, y } = await resolveToCoords(driver, target);
    await tapAt(driver, x, y);
  }

  async doubleTap(driver: any, target: string | ResolvedTarget): Promise<void> {
    logger.debug('DoubleTap', { target });
    const { x, y } = await resolveToCoords(driver, target);

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([actions]);
    await driver.releaseActions();
  }

  async longPress(
    driver: any,
    target: string | ResolvedTarget,
    durationMs: number = 2000,
  ): Promise<void> {
    logger.debug('LongPress', { target, durationMs });
    const { x, y } = await resolveToCoords(driver, target);
    await longPressAt(driver, x, y, durationMs);
  }

  // Type into the currently-focused input. Caller must have just tapped the field.
  // Uses W3C "active element" endpoint so no element id is required — works on apps
  // that don't expose accessibility identifiers on text inputs.
  async sendKeysToFocused(driver: any, text: string): Promise<void> {
    logger.debug('SendKeysToFocused', { length: text.length });
    if (typeof driver.sendKeysToActiveElement === 'function') {
      await driver.sendKeysToActiveElement(text);
      return;
    }
    // Fallback: callers that don't implement the helper can still use the legacy
    // sendKeys with whatever id-style hint they have.
    throw new Error('Driver does not implement sendKeysToActiveElement');
  }

  async swipe(
    driver: any,
    direction: 'left' | 'right' | 'up' | 'down',
    distancePx: number = 500,
    durationMs: number = 300,
  ): Promise<void> {
    logger.debug('Swipe', { direction, distancePx });
    const { width, height } = await this.getScreenSize(driver);
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    const vectors: Record<string, { endX: number; endY: number }> = {
      left: { endX: centerX - distancePx, endY: centerY },
      right: { endX: centerX + distancePx, endY: centerY },
      up: { endX: centerX, endY: centerY - distancePx },
      down: { endX: centerX, endY: centerY + distancePx },
    };
    const { endX, endY } = vectors[direction];

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: durationMs, x: endX, y: endY },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([actions]);
    await driver.releaseActions();
  }

  async scroll(driver: any, direction: 'up' | 'down', scrolls: number = 3): Promise<void> {
    logger.debug('Scroll', { direction, scrolls });
    for (let i = 0; i < scrolls; i++) {
      await this.swipe(driver, direction === 'down' ? 'up' : 'down', 400, 250);
      await this.pause(200);
    }
  }

  async pinchZoom(driver: any, scale: number): Promise<void> {
    logger.debug('PinchZoom', { scale });
    const { width, height } = await this.getScreenSize(driver);
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const spread = Math.floor(Math.min(width, height) * 0.2);

    const zoomIn = scale > 1;
    const startOffset = zoomIn ? 20 : spread;
    const endOffset = zoomIn ? spread : 20;

    const finger1: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: centerX - startOffset, y: centerY - startOffset },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 300, x: centerX - endOffset, y: centerY - endOffset },
        { type: 'pointerUp', button: 0 },
      ],
    };

    const finger2: ActionSequence = {
      type: 'pointer',
      id: 'finger2',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: centerX + startOffset, y: centerY + startOffset },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 300, x: centerX + endOffset, y: centerY + endOffset },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([finger1, finger2]);
    await driver.releaseActions();
  }

  async dragDrop(
    driver: any,
    from: string | ResolvedTarget,
    to: string | ResolvedTarget,
  ): Promise<void> {
    logger.debug('DragDrop', { from, to });
    const fromLoc = await resolveToCoords(driver, from);
    const toLoc = await resolveToCoords(driver, to);

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: fromLoc.x, y: fromLoc.y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 500 },
        { type: 'pointerMove', duration: 500, x: toLoc.x, y: toLoc.y },
        { type: 'pause', duration: 200 },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([actions]);
    await driver.releaseActions();
  }

  private async getScreenSize(driver: any): Promise<{ width: number; height: number }> {
    const size = await driver.getWindowRect();
    return { width: size.width, height: size.height };
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

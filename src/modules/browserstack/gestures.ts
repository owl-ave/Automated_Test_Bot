import { Logger } from '../../utils/logger';

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

export class GestureExecutor {
  async tap(driver: any, elementId: string): Promise<void> {
    logger.debug('Tap', { elementId });
    const element = await driver.findElement('id', elementId);
    const location = await this.getElementCenter(driver, element);

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: location.x, y: location.y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([actions]);
    await driver.releaseActions();
  }

  async doubleTap(driver: any, elementId: string): Promise<void> {
    logger.debug('DoubleTap', { elementId });
    const element = await driver.findElement('id', elementId);
    const location = await this.getElementCenter(driver, element);

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: location.x, y: location.y },
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

  async longPress(driver: any, elementId: string, durationMs: number = 2000): Promise<void> {
    logger.debug('LongPress', { elementId, durationMs });
    const element = await driver.findElement('id', elementId);
    const location = await this.getElementCenter(driver, element);

    const actions: ActionSequence = {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: location.x, y: location.y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: durationMs },
        { type: 'pointerUp', button: 0 },
      ],
    };

    await driver.performActions([actions]);
    await driver.releaseActions();
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

  async dragDrop(driver: any, fromId: string, toId: string): Promise<void> {
    logger.debug('DragDrop', { fromId, toId });
    const fromElement = await driver.findElement('id', fromId);
    const toElement = await driver.findElement('id', toId);
    const fromLoc = await this.getElementCenter(driver, fromElement);
    const toLoc = await this.getElementCenter(driver, toElement);

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

  private async getElementCenter(driver: any, element: any): Promise<{ x: number; y: number }> {
    const rect = await driver.getElementRect(element.ELEMENT || element);
    return {
      x: Math.floor(rect.x + rect.width / 2),
      y: Math.floor(rect.y + rect.height / 2),
    };
  }

  private async getScreenSize(driver: any): Promise<{ width: number; height: number }> {
    const size = await driver.getWindowRect();
    return { width: size.width, height: size.height };
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

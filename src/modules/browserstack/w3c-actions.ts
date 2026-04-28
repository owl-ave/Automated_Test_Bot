export async function tapAt(driver: any, x: number, y: number): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await driver.releaseActions();
}

export async function longPressAt(
  driver: any,
  x: number,
  y: number,
  durationMs: number = 1500,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: durationMs },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await driver.releaseActions();
}

export async function swipeFromTo(
  driver: any,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number = 300,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: durationMs, x: endX, y: endY },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
  await driver.releaseActions();
}

export async function longPressElement(
  driver: any,
  element: any,
  durationMs: number = 1500,
): Promise<void> {
  const elementId = element.ELEMENT || element['element-6066-11e4-a52e-4f735466cecf'] || element;
  const rect = await driver.getElementRect(elementId);
  const x = Math.floor(rect.x + rect.width / 2);
  const y = Math.floor(rect.y + rect.height / 2);
  await longPressAt(driver, x, y, durationMs);
}

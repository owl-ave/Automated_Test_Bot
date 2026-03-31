import { Logger } from '../../utils/logger';

export interface OrientationResult {
  scenario: string;
  passed: boolean;
  details: string;
  layoutPreserved: boolean;
  dataPreserved: boolean;
  screenshot?: string;
}

export class OrientationTester {
  private logger = new Logger('OrientationTester');

  async rotateToLandscape(driver: any): Promise<void> {
    try {
      await driver.setOrientation('LANDSCAPE');
      await driver.pause(1500);
      this.logger.log('Rotated to landscape');
    } catch (err) {
      this.logger.error('Failed to rotate to landscape', err);
      throw err;
    }
  }

  async rotateToPortrait(driver: any): Promise<void> {
    try {
      await driver.setOrientation('PORTRAIT');
      await driver.pause(1500);
      this.logger.log('Rotated to portrait');
    } catch (err) {
      this.logger.error('Failed to rotate to portrait', err);
      throw err;
    }
  }

  async testOrientationChange(driver: any, scenario: string): Promise<OrientationResult> {
    const result: OrientationResult = {
      scenario,
      passed: false,
      details: '',
      layoutPreserved: false,
      dataPreserved: false,
    };

    try {
      // Ensure we start in portrait
      await this.rotateToPortrait(driver);
      await driver.pause(500);

      // Capture portrait state
      const portraitSource = await driver.getPageSource();
      const portraitTexts = this.extractVisibleTexts(portraitSource);
      const portraitSize = await driver.getWindowSize();

      // Rotate to landscape
      await this.rotateToLandscape(driver);

      // Check for crash
      const landscapeSource = await driver.getPageSource().catch(() => '');
      if (!landscapeSource) {
        result.details = 'App crashed on rotation to landscape';
        return result;
      }

      // Verify layout adapted
      const landscapeSize = await driver.getWindowSize();
      const landscapeTexts = this.extractVisibleTexts(landscapeSource);

      const layoutAdapted = landscapeSize.width > landscapeSize.height;

      // Check data preservation — key texts should still be visible
      const textsPreserved = this.checkTextsPreserved(portraitTexts, landscapeTexts);
      result.dataPreserved = textsPreserved;

      // Check for layout issues (overflow, truncation indicators)
      const hasLayoutIssues = this.detectLayoutIssues(landscapeSource);
      result.layoutPreserved = !hasLayoutIssues;

      // Rotate back to portrait
      await this.rotateToPortrait(driver);
      await driver.pause(500);

      const returnedSource = await driver.getPageSource().catch(() => '');
      if (!returnedSource) {
        result.details = 'App crashed when rotating back to portrait';
        return result;
      }

      const returnedTexts = this.extractVisibleTexts(returnedSource);
      const returnDataPreserved = this.checkTextsPreserved(portraitTexts, returnedTexts);

      result.passed = textsPreserved && returnDataPreserved && !hasLayoutIssues;
      result.details = [
        `Layout adapted to landscape: ${layoutAdapted}`,
        `Data preserved in landscape: ${textsPreserved}`,
        `Data preserved after return to portrait: ${returnDataPreserved}`,
        `Layout issues detected: ${hasLayoutIssues}`,
      ].join('; ');

      result.screenshot = await driver.takeScreenshot().catch(() => undefined);
    } catch (err) {
      result.details = `Orientation test failed: ${err}`;
      this.logger.error(`Orientation test failed for: ${scenario}`, err);

      // Ensure we return to portrait
      try {
        await this.rotateToPortrait(driver);
      } catch {
        /* best effort */
      }
    }

    return result;
  }

  async testRapidRotation(driver: any, rotations: number = 5): Promise<OrientationResult> {
    const result: OrientationResult = {
      scenario: 'rapid-rotation',
      passed: false,
      details: '',
      layoutPreserved: false,
      dataPreserved: false,
    };

    try {
      const beforeSource = await driver.getPageSource();
      const beforeTexts = this.extractVisibleTexts(beforeSource);

      for (let i = 0; i < rotations; i++) {
        await this.rotateToLandscape(driver);
        await driver.pause(300);
        await this.rotateToPortrait(driver);
        await driver.pause(300);
      }

      await driver.pause(1000);

      const afterSource = await driver.getPageSource().catch(() => '');
      if (!afterSource) {
        result.details = `App crashed after ${rotations} rapid rotations`;
        return result;
      }

      const afterTexts = this.extractVisibleTexts(afterSource);
      result.dataPreserved = this.checkTextsPreserved(beforeTexts, afterTexts);
      result.layoutPreserved = !this.detectLayoutIssues(afterSource);
      result.passed = result.dataPreserved && result.layoutPreserved;
      result.details = `Survived ${rotations} rapid rotations. Data preserved: ${result.dataPreserved}`;
    } catch (err) {
      result.details = `Rapid rotation test failed: ${err}`;
      try {
        await this.rotateToPortrait(driver);
      } catch {
        /* best effort */
      }
    }

    return result;
  }

  private extractVisibleTexts(pageSource: string): string[] {
    const texts: string[] = [];
    // Extract text attributes from XML page source
    const textMatches = pageSource.match(/text="([^"]+)"/g) || [];
    for (const match of textMatches) {
      const text = match
        .replace(/text="/, '')
        .replace(/"$/, '')
        .trim();
      if (text.length > 0 && text.length < 200) {
        texts.push(text);
      }
    }
    // Also extract label attributes (iOS)
    const labelMatches = pageSource.match(/label="([^"]+)"/g) || [];
    for (const match of labelMatches) {
      const text = match
        .replace(/label="/, '')
        .replace(/"$/, '')
        .trim();
      if (text.length > 0 && text.length < 200) {
        texts.push(text);
      }
    }
    return [...new Set(texts)];
  }

  private checkTextsPreserved(before: string[], after: string[]): boolean {
    if (before.length === 0) return true;

    // At least 70% of important texts should be preserved
    const importantTexts = before.filter((t) => t.length > 3);
    if (importantTexts.length === 0) return true;

    const preserved = importantTexts.filter((t) => after.includes(t));
    return preserved.length / importantTexts.length >= 0.7;
  }

  private detectLayoutIssues(pageSource: string): boolean {
    const lower = pageSource.toLowerCase();
    const indicators = [
      'ellipsis',
      'truncat',
      'overflow',
      'bounds="[0,0][0,0]"', // zero-size elements
    ];
    return indicators.some((ind) => lower.includes(ind));
  }
}

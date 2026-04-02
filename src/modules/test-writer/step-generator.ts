import { BddScenario, GherkinStep } from '../../types';
import { Logger } from '../../utils/logger';

export class StepGenerator {
  private logger = new Logger('StepGenerator');

  generateAppiumSteps(scenarios: BddScenario[]): string {
    let code = `import { remote } from 'webdriverio';\n\ndescribe('Mobile Tests', () => {\n`;

    scenarios.forEach((scenario) => {
      code += `\n  describe('${scenario.feature}', () => {\n`;
      code += `    it('${scenario.scenario}', async () => {\n`;
      code += `      const driver = await remote({\n`;
      code += `        capabilities: { platformName: 'Android', deviceName: 'emulator' }\n`;
      code += `      });\n\n`;

      scenario.steps.forEach((step) => {
        code += this.stepToAppium(step);
      });

      code += `\n      await driver.deleteSession();\n`;
      code += `    });\n`;
      code += `  });\n`;
    });

    code += `\n});\n`;
    return code;
  }

  private stepToAppium(step: GherkinStep): string {
    const text = step.text.toLowerCase();

    // App lifecycle
    if (text.includes('launch')) return `      await driver.launchApp();\n`;
    if (text.includes('close') && text.includes('app')) return `      await driver.closeApp();\n`;
    if (text.includes('background')) return `      await driver.background(5);\n`;
    if (text.includes('relaunch') || text.includes('restart')) return `      await driver.reset();\n`;

    // Tap / click / press
    if (text.includes('tap') || text.includes('click') || text.includes('press')) {
      if (text.includes('long press') || text.includes('long-press') || text.includes('hold')) {
        const element = this.extractElement(step.text);
        return `      const el = await driver.$('~${element}');\n      await el.touchAction('longPress');\n`;
      }
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.click();\n`;
    }

    // Text input
    if (text.includes('enter') || text.includes('type') || text.includes('input')) {
      const parts = this.extractInputParts(step.text);
      return `      const field = await driver.$('~${parts.field}');\n      await field.setValue('${parts.value}');\n`;
    }

    // Clear field
    if (text.includes('clear')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.clearValue();\n`;
    }

    // Swipe / scroll
    if (text.includes('swipe up') || text.includes('scroll down'))
      return `      await driver.execute('mobile: scroll', { direction: 'down' });\n`;
    if (text.includes('swipe down') || text.includes('scroll up'))
      return `      await driver.execute('mobile: scroll', { direction: 'up' });\n`;
    if (text.includes('swipe left'))
      return `      await driver.execute('mobile: swipe', { direction: 'left' });\n`;
    if (text.includes('swipe right'))
      return `      await driver.execute('mobile: swipe', { direction: 'right' });\n`;
    if (text.includes('swipe') || text.includes('scroll'))
      return `      await driver.execute('mobile: scroll', { direction: 'down' });\n`;
    if (text.includes('pull') && text.includes('refresh'))
      return `      await driver.execute('mobile: scroll', { direction: 'down' });\n`;

    // Navigation
    if (text.includes('navigate') || text.includes('go to') || text.includes('open')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.click();\n`;
    }

    // Back button
    if (text.includes('back') || text.includes('go back'))
      return `      await driver.back();\n`;

    // Wait / pause
    if (text.includes('wait') || text.includes('pause')) {
      const seconds = this.extractNumber(text) || 3;
      return `      await driver.pause(${seconds * 1000});\n`;
    }

    // Permission handling
    if (text.includes('allow') || (text.includes('permission') && !text.includes('deny')))
      return `      try { const allowBtn = await driver.$('~Allow'); await allowBtn.click(); } catch {} // accept permission\n`;
    if (text.includes('deny') || (text.includes('permission') && text.includes('deny')))
      return `      try { const denyBtn = await driver.$('~Deny'); await denyBtn.click(); } catch {} // deny permission\n`;

    // Toggle / switch
    if (text.includes('toggle') || text.includes('switch')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.click();\n`;
    }

    // Select / pick
    if (text.includes('select') || text.includes('pick') || text.includes('choose')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.click();\n`;
    }

    // Dismiss / close (dialogs, modals)
    if (text.includes('dismiss') || text.includes('close')) {
      return `      try { const closeBtn = await driver.$('~Close'); await closeBtn.click(); } catch { await driver.back(); }\n`;
    }

    // Drag
    if (text.includes('drag')) {
      return `      // Drag gesture — customize source/target coordinates as needed\n      await driver.touchAction([{ action: 'press', x: 150, y: 300 }, { action: 'moveTo', x: 150, y: 600 }, 'release']);\n`;
    }

    // Pinch / zoom
    if (text.includes('pinch') || text.includes('zoom'))
      return `      await driver.execute('mobile: pinch', { scale: 0.5, velocity: -1 });\n`;

    // Orientation / rotation
    if (text.includes('landscape'))
      return `      await driver.setOrientation('LANDSCAPE');\n`;
    if (text.includes('portrait'))
      return `      await driver.setOrientation('PORTRAIT');\n`;
    if (text.includes('rotate') || text.includes('orientation'))
      return `      await driver.setOrientation('LANDSCAPE');\n`;

    // Keyboard
    if (text.includes('hide keyboard') || text.includes('dismiss keyboard'))
      return `      await driver.hideKeyboard();\n`;

    // Verification / assertion
    if (text.includes('should see') || text.includes('verify') || text.includes('visible') || text.includes('displayed')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await expect(el).toBeDisplayed();\n`;
    }
    if (text.includes('should not see') || text.includes('not visible') || text.includes('hidden')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await expect(el).not.toBeDisplayed();\n`;
    }
    if (text.includes('should contain') || text.includes('text should be')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      const text = await el.getText();\n      expect(text).toBeTruthy();\n`;
    }

    // Precondition steps (Given) — often just context, generate as comments
    if (step.keyword === 'Given') {
      return `      // Precondition: ${step.text}\n`;
    }

    // Fallback: generate a warning comment
    return `      // Unhandled step: ${step.keyword} ${step.text}\n      console.warn('Unhandled step: ${step.keyword} ${step.text}');\n`;
  }

  private extractElement(text: string): string {
    const match = text.match(
      /(?:on|in|see|tap|click|the)\s+(?:the\s+)?["']?([a-zA-Z\s]+?)["']?(?:\s+(?:button|field|screen|icon|element|tab|link|toggle|switch|option))?$/i,
    );
    return match ? match[1].trim().replace(/\s+/g, '_').toLowerCase() : 'element';
  }

  private extractInputParts(text: string): { field: string; value: string } {
    const match = text.match(
      /(?:enters?|types?|inputs?)\s+["']?([^"']+)["']?\s+(?:in|into|to)\s+(?:the\s+)?["']?([a-zA-Z\s]+?)["']?(?:\s+field)?/i,
    );
    if (match) {
      return { value: match[1].trim(), field: match[2].trim().replace(/\s+/g, '_').toLowerCase() };
    }
    return { field: 'field', value: 'value' };
  }

  private extractNumber(text: string): number | null {
    const match = text.match(/(\d+)\s*(?:second|sec|s)/i);
    return match ? parseInt(match[1], 10) : null;
  }
}

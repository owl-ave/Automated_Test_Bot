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

    if (text.includes('launch')) return `      await driver.launchApp();\n`;
    if (text.includes('tap') || text.includes('click')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await el.click();\n`;
    }
    if (text.includes('enter') || text.includes('type')) {
      const parts = this.extractInputParts(step.text);
      return `      const field = await driver.$('~${parts.field}');\n      await field.setValue('${parts.value}');\n`;
    }
    if (text.includes('swipe') || text.includes('scroll'))
      return `      await driver.execute('mobile: scroll', { direction: 'down' });\n`;
    if (text.includes('should see') || text.includes('verify')) {
      const element = this.extractElement(step.text);
      return `      const el = await driver.$('~${element}');\n      await expect(el).toBeDisplayed();\n`;
    }

    return `      // TODO: ${step.keyword} ${step.text}\n`;
  }

  private extractElement(text: string): string {
    const match = text.match(
      /(?:on|in|see|tap|click)\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\s+(?:button|field|screen|icon|element))?$/i,
    );
    return match ? match[1].trim().replace(/\s+/g, '_').toLowerCase() : 'element';
  }

  private extractInputParts(text: string): { field: string; value: string } {
    const match = text.match(
      /(?:enters?|types?)\s+[`"]?([^`"]+)[`"]?\s+(?:in|to)\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\s+field)?/i,
    );
    if (match) {
      return { value: match[1].trim(), field: match[2].trim().replace(/\s+/g, '_').toLowerCase() };
    }
    return { field: 'field', value: 'value' };
  }
}

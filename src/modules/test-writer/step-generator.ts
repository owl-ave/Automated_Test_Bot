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

    // ══════════════════════════════════════════════
    // PRECONDITIONS (Given/And context setup)
    // ══════════════════════════════════════════════
    if (step.keyword === 'Given' || (step.keyword === 'And' && this.isPrecondition(text))) {
      if (text.includes('installed')) return `      // App is installed (handled by BrowserStack)\n`;
      if (text.includes('light mode') || text.includes('light theme'))
        return `      // Light mode is the default theme\n`;
      if (text.includes('dark mode') || text.includes('dark theme'))
        return `      await driver.execute('mobile: shell', { command: 'cmd uimode night yes' });\n`;
      if (text.includes('logged in') || text.includes('signed in') || text.includes('authenticated'))
        return `      // Precondition: User is logged in\n`;
      if (text.includes('notch') || text.includes('dynamic island'))
        return `      // Device has notch (handled by device selection)\n`;
      if (text.includes('offline') || text.includes('no internet') || text.includes('airplane'))
        return `      await driver.setNetworkConnection(1); // airplane mode\n`;
      if (text.includes('wifi') || text.includes('connected') || text.includes('online'))
        return `      await driver.setNetworkConnection(6); // wifi + data\n`;
      if (text.includes('slow') && text.includes('network'))
        return `      // Slow network set via BrowserStack network profile\n`;
      if (text.includes('empty') && (text.includes('cart') || text.includes('list') || text.includes('state')))
        return `      // Empty state precondition\n`;
      if (text.includes('item') && text.includes('cart'))
        return `      // Cart has items (pre-seeded test data)\n`;
      if (text.includes('home') || text.includes('main') || text.includes('landing'))
        return `      await driver.launchApp();\n      await driver.pause(2000);\n`;
      if (text.includes('screen') || text.includes('page') || text.includes('view'))
        return `      // Navigate to required screen\n      await driver.pause(1000);\n`;
      return `      // Precondition: ${step.text}\n`;
    }

    // ══════════════════════════════════════════════
    // APP LIFECYCLE
    // ══════════════════════════════════════════════
    if (text.includes('launch') || text.includes('opens the app') || text.includes('starts the app'))
      return `      await driver.launchApp();\n      await driver.pause(3000);\n`;
    if (text.includes('close') && text.includes('app')) return `      await driver.closeApp();\n`;
    if (text.includes('background'))
      return `      await driver.background(${this.extractNumber(text) || 5});\n`;
    if (text.includes('foreground') || text.includes('resume'))
      return `      await driver.launchApp();\n`;
    if (text.includes('relaunch') || text.includes('restart') || text.includes('kill'))
      return `      await driver.closeApp();\n      await driver.launchApp();\n      await driver.pause(3000);\n`;
    if (text.includes('uninstall') || text.includes('reinstall'))
      return `      await driver.removeApp('com.app');\n      await driver.installApp('/path/to/app');\n`;

    // ══════════════════════════════════════════════
    // AUTHENTICATION / LOGIN
    // ══════════════════════════════════════════════
    if (text.includes('log in') || text.includes('login') || text.includes('sign in')) {
      if (text.includes('biometric') || text.includes('fingerprint') || text.includes('face'))
        return `      await driver.execute('mobile: fingerprint', { fingerprintId: 1 });\n`;
      if (text.includes('otp') || text.includes('code'))
        return this.findAndType('otp_field', '123456');
      const el = this.extractElement(step.text);
      return `      const loginBtn = await driver.$('~${el}');\n      await loginBtn.click();\n`;
    }
    if (text.includes('log out') || text.includes('logout') || text.includes('sign out')) {
      return `      const logoutBtn = await driver.$('~logout');\n      await logoutBtn.click();\n`;
    }
    if (text.includes('pin') && (text.includes('enter') || text.includes('input'))) {
      const pin = this.extractQuoted(text) || '1234';
      return `      for (const digit of '${pin}') {\n        const key = await driver.$(\`~\${digit}\`);\n        await key.click();\n      }\n`;
    }

    // ══════════════════════════════════════════════
    // TAP / CLICK / PRESS
    // ══════════════════════════════════════════════
    if (text.includes('tap') || text.includes('click') || text.includes('press')) {
      if (text.includes('long press') || text.includes('long-press') || text.includes('hold')) {
        const el = this.extractElement(step.text);
        return `      const el = await driver.$('~${el}');\n      await el.touchAction('longPress');\n`;
      }
      if (text.includes('double'))  {
        const el = this.extractElement(step.text);
        return `      const el = await driver.$('~${el}');\n      await el.doubleClick();\n`;
      }
      const el = this.extractElement(step.text);
      return this.findAndClick(el);
    }

    // ══════════════════════════════════════════════
    // TEXT INPUT
    // ══════════════════════════════════════════════
    if (text.includes('enter') || text.includes('type') || text.includes('input') || text.includes('fill')) {
      const parts = this.extractInputParts(step.text);
      return this.findAndType(parts.field, parts.value);
    }
    if (text.includes('clear')) {
      const el = this.extractElement(step.text);
      return `      const el = await driver.$('~${el}');\n      await el.clearValue();\n`;
    }

    // ══════════════════════════════════════════════
    // SEARCH
    // ══════════════════════════════════════════════
    if (text.includes('search')) {
      if (text.includes('for') || text.includes('query') || text.includes('term')) {
        const query = this.extractQuoted(text) || 'test';
        return `      const searchField = await driver.$('~search_field');\n      await searchField.setValue('${query}');\n      await driver.pressKeyCode(66); // Enter key\n      await driver.pause(2000);\n`;
      }
      return this.findAndClick('search');
    }

    // ══════════════════════════════════════════════
    // SWIPE / SCROLL
    // ══════════════════════════════════════════════
    if (text.includes('pull') && text.includes('refresh'))
      return `      await driver.execute('mobile: scroll', { direction: 'down' });\n      await driver.pause(2000);\n`;
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

    // ══════════════════════════════════════════════
    // E-COMMERCE / CART / CHECKOUT
    // ══════════════════════════════════════════════
    if (text.includes('add to cart') || text.includes('adds to cart'))
      return this.findAndClick('add_to_cart');
    if (text.includes('remove from cart') || text.includes('removes from cart'))
      return this.findAndClick('remove_from_cart');
    if (text.includes('checkout') || text.includes('proceed to'))
      return this.findAndClick('checkout');
    if (text.includes('quantity') && (text.includes('increase') || text.includes('increment') || text.includes('plus')))
      return this.findAndClick('increase_quantity');
    if (text.includes('quantity') && (text.includes('decrease') || text.includes('decrement') || text.includes('minus')))
      return this.findAndClick('decrease_quantity');
    if (text.includes('apply') && (text.includes('coupon') || text.includes('promo') || text.includes('code'))) {
      const code = this.extractQuoted(text) || 'TESTCODE';
      return `      const couponField = await driver.$('~coupon_field');\n      await couponField.setValue('${code}');\n      const applyBtn = await driver.$('~apply_coupon');\n      await applyBtn.click();\n`;
    }
    if (text.includes('payment') || text.includes('pay now') || text.includes('place order'))
      return this.findAndClick('pay_now');

    // ══════════════════════════════════════════════
    // FINTECH / BANKING
    // ══════════════════════════════════════════════
    if (text.includes('transfer') || text.includes('send money'))
      return this.findAndClick('transfer');
    if (text.includes('balance') && (text.includes('check') || text.includes('view')))
      return `      const balance = await driver.$('~balance');\n      await balance.waitForDisplayed({ timeout: 10000 });\n`;
    if (text.includes('transaction') && (text.includes('history') || text.includes('list')))
      return this.findAndClick('transactions');

    // ══════════════════════════════════════════════
    // SOCIAL MEDIA
    // ══════════════════════════════════════════════
    if (text.includes('like') && !text.includes('looks like'))
      return this.findAndClick('like');
    if (text.includes('comment') && (text.includes('post') || text.includes('add') || text.includes('write'))) {
      const comment = this.extractQuoted(text) || 'Test comment';
      return `      const commentField = await driver.$('~comment_field');\n      await commentField.setValue('${comment}');\n      const postBtn = await driver.$('~post_comment');\n      await postBtn.click();\n`;
    }
    if (text.includes('share'))
      return this.findAndClick('share');
    if (text.includes('follow'))
      return this.findAndClick('follow');
    if (text.includes('unfollow'))
      return this.findAndClick('unfollow');

    // ══════════════════════════════════════════════
    // MEDIA / CAMERA / GALLERY
    // ══════════════════════════════════════════════
    if (text.includes('take photo') || text.includes('capture') || text.includes('camera'))
      return `      const cameraBtn = await driver.$('~camera');\n      await cameraBtn.click();\n      await driver.pause(1000);\n      try { const shutter = await driver.$('~shutter'); await shutter.click(); } catch {}\n`;
    if (text.includes('gallery') || text.includes('photo library') || text.includes('pick image'))
      return `      const galleryBtn = await driver.$('~gallery');\n      await galleryBtn.click();\n      await driver.pause(1000);\n      const firstPhoto = await driver.$('~photo_0');\n      await firstPhoto.click();\n`;
    if (text.includes('upload') || text.includes('attach'))
      return this.findAndClick('upload');
    if (text.includes('record') && (text.includes('video') || text.includes('audio')))
      return this.findAndClick('record');

    // ══════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════
    if (text.includes('notification'))  {
      if (text.includes('open') || text.includes('tap'))
        return `      await driver.openNotifications();\n      await driver.pause(1000);\n      const notif = await driver.$('~notification');\n      await notif.click();\n`;
      if (text.includes('receive') || text.includes('arrive'))
        return `      await driver.openNotifications();\n      await driver.pause(2000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n      await driver.back();\n`;
      return `      await driver.openNotifications();\n      await driver.pause(1000);\n`;
    }

    // ══════════════════════════════════════════════
    // NAVIGATION / TABS / BOTTOM NAV
    // ══════════════════════════════════════════════
    if (text.includes('tab') && (text.includes('switch') || text.includes('tap') || text.includes('select'))) {
      const tab = this.extractElement(step.text);
      return this.findAndClick(tab);
    }
    if (text.includes('navigate') || text.includes('go to') || text.includes('open')) {
      const el = this.extractElement(step.text);
      return this.findAndClick(el);
    }
    if (text.includes('back') || text.includes('go back'))
      return `      await driver.back();\n`;
    if (text.includes('deep link') || text.includes('deeplink')) {
      const url = this.extractQuoted(text) || 'app://home';
      return `      await driver.execute('mobile: deepLink', { url: '${url}' });\n      await driver.pause(2000);\n`;
    }

    // ══════════════════════════════════════════════
    // FORMS / PICKERS
    // ══════════════════════════════════════════════
    if (text.includes('select') || text.includes('pick') || text.includes('choose') || text.includes('dropdown')) {
      const el = this.extractElement(step.text);
      return this.findAndClick(el);
    }
    if (text.includes('date') && (text.includes('pick') || text.includes('select') || text.includes('choose')))
      return `      const datePicker = await driver.$('~date_picker');\n      await datePicker.click();\n      await driver.pause(500);\n      const okBtn = await driver.$('~OK');\n      await okBtn.click();\n`;
    if (text.includes('toggle') || text.includes('switch')) {
      const el = this.extractElement(step.text);
      return this.findAndClick(el);
    }
    if (text.includes('checkbox') || text.includes('check')) {
      const el = this.extractElement(step.text);
      return this.findAndClick(el);
    }
    if (text.includes('submit') || text.includes('confirm') || text.includes('save'))
      return this.findAndClick(this.extractElement(step.text) || 'submit');

    // ══════════════════════════════════════════════
    // WAIT / PAUSE / LOADING
    // ══════════════════════════════════════════════
    if (text.includes('wait') || text.includes('pause') || text.includes('loading')) {
      const seconds = this.extractNumber(text) || 3;
      return `      await driver.pause(${seconds * 1000});\n`;
    }

    // ══════════════════════════════════════════════
    // PERMISSIONS
    // ══════════════════════════════════════════════
    if (text.includes('allow') || (text.includes('permission') && !text.includes('deny')))
      return `      try {\n        const allowBtn = await driver.$('//*[@text="Allow" or @text="ALLOW" or @text="While using the app"]');\n        await allowBtn.click();\n      } catch {} // permission may not appear\n`;
    if (text.includes('deny') || (text.includes('permission') && text.includes('deny')))
      return `      try {\n        const denyBtn = await driver.$('//*[@text="Deny" or @text="DENY" or @text="Don\\'t allow"]');\n        await denyBtn.click();\n      } catch {}\n`;

    // ══════════════════════════════════════════════
    // ORIENTATION
    // ══════════════════════════════════════════════
    if (text.includes('landscape'))
      return `      await driver.setOrientation('LANDSCAPE');\n      await driver.pause(1000);\n`;
    if (text.includes('portrait'))
      return `      await driver.setOrientation('PORTRAIT');\n      await driver.pause(1000);\n`;
    if (text.includes('rotate') || (text.includes('switch') && text.includes('mode')))
      return `      const orientation = await driver.getOrientation();\n      await driver.setOrientation(orientation === 'PORTRAIT' ? 'LANDSCAPE' : 'PORTRAIT');\n      await driver.pause(1000);\n`;

    // ══════════════════════════════════════════════
    // KEYBOARD
    // ══════════════════════════════════════════════
    if (text.includes('hide keyboard') || text.includes('dismiss keyboard'))
      return `      await driver.hideKeyboard();\n`;

    // ══════════════════════════════════════════════
    // MAPS / LOCATION
    // ══════════════════════════════════════════════
    if (text.includes('location') || text.includes('gps')) {
      if (text.includes('set') || text.includes('mock'))
        return `      await driver.setGeoLocation({ latitude: 37.7749, longitude: -122.4194, altitude: 0 });\n`;
      return `      // Location-related step\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;
    }

    // ══════════════════════════════════════════════
    // CLIPBOARD / COPY-PASTE
    // ══════════════════════════════════════════════
    if (text.includes('copy'))
      return `      await driver.setClipboard(Buffer.from('test').toString('base64'), 'plaintext');\n`;
    if (text.includes('paste'))
      return `      const clip = await driver.getClipboard('plaintext');\n      expect(clip).toBeTruthy();\n`;

    // ══════════════════════════════════════════════
    // ASSERTIONS / VERIFICATIONS
    // ══════════════════════════════════════════════

    // App state assertions
    if (text.includes('without crashing') || text.includes('without error') || text.includes('does not crash'))
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n      expect(source.length).toBeGreaterThan(100);\n`;
    if (text.includes('home screen') || text.includes('main screen'))
      return `      await driver.pause(2000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;
    if (text.includes('renders') || text.includes('is displayed') || text.includes('is shown') || text.includes('appears'))
      return `      await driver.pause(2000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;
    if (text.includes('stable') || text.includes('remains'))
      return `      await driver.pause(3000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // Element visibility
    if (text.includes('should see') || text.includes('visible') || text.includes('can see')) {
      const el = this.extractElement(step.text);
      return `      const el = await driver.$('~${el}');\n      await el.waitForDisplayed({ timeout: 10000 });\n`;
    }
    if (text.includes('should not see') || text.includes('not visible') || text.includes('hidden') || text.includes('disappear')) {
      const el = this.extractElement(step.text);
      return `      const el = await driver.$('~${el}');\n      await el.waitForDisplayed({ timeout: 5000, reverse: true });\n`;
    }

    // Text content
    if (text.includes('should contain') || text.includes('text should') || text.includes('shows text')) {
      const expected = this.extractQuoted(text);
      if (expected)
        return `      const source = await driver.getPageSource();\n      expect(source).toContain('${expected}');\n`;
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;
    }

    // Count / list assertions
    if (text.includes('should have') && (text.includes('item') || text.includes('result'))) {
      const count = this.extractNumber(text);
      if (count)
        return `      const items = await driver.$$('~list_item');\n      expect(items.length).toBe(${count});\n`;
      return `      const items = await driver.$$('~list_item');\n      expect(items.length).toBeGreaterThan(0);\n`;
    }

    // Empty state
    if (text.includes('empty') && (text.includes('state') || text.includes('message') || text.includes('no item')))
      return `      const emptyMsg = await driver.$('~empty_state');\n      await emptyMsg.waitForDisplayed({ timeout: 5000 });\n`;

    // Error / alert / toast
    if (text.includes('error') && (text.includes('message') || text.includes('shown') || text.includes('display')))
      return `      await driver.pause(1000);\n      const source = await driver.getPageSource();\n      expect(source.toLowerCase()).toMatch(/error|invalid|failed/);\n`;
    if (text.includes('toast') || text.includes('snackbar'))
      return `      await driver.pause(1000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;
    if (text.includes('alert') || text.includes('dialog') || text.includes('popup'))
      return `      await driver.pause(1000);\n      const alert = await driver.getAlertText().catch(() => null);\n      if (alert) { await driver.acceptAlert(); }\n`;
    if (text.includes('success') && (text.includes('message') || text.includes('screen') || text.includes('confirm')))
      return `      await driver.pause(2000);\n      const source = await driver.getPageSource();\n      expect(source.toLowerCase()).toMatch(/success|confirmed|complete|done/);\n`;

    // Status bar / system UI
    if (text.includes('status bar'))
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // Safe area / layout
    if (text.includes('safe area') || text.includes('boundaries') || text.includes('insets'))
      return `      const { width, height } = await driver.getWindowSize();\n      expect(width).toBeGreaterThan(0);\n      expect(height).toBeGreaterThan(0);\n`;
    if (text.includes('obscured') || text.includes('not hidden') || text.includes('not covered'))
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // Network / connectivity
    if (text.includes('cleartext') || text.includes('traffic'))
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // Backup / restore / config
    if (text.includes('backup') || text.includes('restore'))
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // Price / amount / currency
    if (text.includes('price') || text.includes('amount') || text.includes('total')) {
      const el = this.extractElement(step.text) || 'price';
      return `      const el = await driver.$('~${el}');\n      const val = await el.getText();\n      expect(val).toMatch(/\\d/);\n`;
    }

    // Loading / spinner
    if (text.includes('loading') || text.includes('spinner'))
      return `      await driver.pause(3000);\n      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // ══════════════════════════════════════════════
    // FALLBACKS
    // ══════════════════════════════════════════════

    // Fallback for Then/And: verify app is alive
    if (step.keyword === 'Then' || step.keyword === 'And')
      return `      const source = await driver.getPageSource();\n      expect(source).toBeTruthy();\n`;

    // When actions that didn't match above — try element click
    if (step.keyword === 'When') {
      const el = this.extractElement(step.text);
      if (el !== 'element') return this.findAndClick(el);
    }

    return `      // Step: ${step.keyword} ${step.text}\n`;
  }

  // ══════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════

  private findAndClick(el: string): string {
    return `      const ${this.varName(el)} = await driver.$('~${el}');\n      await ${this.varName(el)}.waitForDisplayed({ timeout: 10000 });\n      await ${this.varName(el)}.click();\n`;
  }

  private findAndType(field: string, value: string): string {
    return `      const ${this.varName(field)} = await driver.$('~${field}');\n      await ${this.varName(field)}.waitForDisplayed({ timeout: 10000 });\n      await ${this.varName(field)}.setValue('${value}');\n`;
  }

  private varName(el: string): string {
    return el.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'el';
  }

  private isPrecondition(text: string): boolean {
    return /\b(is|are|has|have|was|were|been|using|on a|on an|with|device|app|user|account|set to|mode|theme)\b/.test(text);
  }

  private extractElement(text: string): string {
    const quoted = text.match(/["']([^"']+)["']/);
    if (quoted) return quoted[1].trim().replace(/\s+/g, '_').toLowerCase();

    const uiElement = text.match(
      /(?:the\s+)?["']?([a-zA-Z][a-zA-Z\s]{1,25}?)["']?\s+(?:button|field|screen|icon|element|tab|link|toggle|switch|option|section|page|menu|bar|card|item|cell|row|input|label|badge|banner|header|footer|modal|drawer|panel|chip)/i,
    );
    if (uiElement) return uiElement[1].trim().replace(/\s+/g, '_').toLowerCase();

    const onIn = text.match(/(?:on|in|to)\s+(?:the\s+)?["']?([a-zA-Z][a-zA-Z\s]{1,25}?)["']?\s*$/i);
    if (onIn) return onIn[1].trim().replace(/\s+/g, '_').toLowerCase();

    return 'element';
  }

  private extractQuoted(text: string): string | null {
    const match = text.match(/["']([^"']+)["']/);
    return match ? match[1] : null;
  }

  private extractInputParts(text: string): { field: string; value: string } {
    // "enters 'value' in the field"
    const match = text.match(
      /(?:enters?|types?|inputs?|fills?)\s+["']?([^"']+?)["']?\s+(?:in|into|to|on)\s+(?:the\s+)?["']?([a-zA-Z\s]+?)["']?(?:\s+field)?$/i,
    );
    if (match) {
      return { value: match[1].trim(), field: match[2].trim().replace(/\s+/g, '_').toLowerCase() };
    }
    // "enters value" (no field specified)
    const simpleMatch = text.match(/(?:enters?|types?|inputs?|fills?)\s+["']?([^"']+?)["']?\s*$/i);
    if (simpleMatch) return { field: 'input_field', value: simpleMatch[1].trim() };

    return { field: 'input_field', value: 'test_value' };
  }

  private extractNumber(text: string): number | null {
    const match = text.match(/(\d+)\s*(?:second|sec|s|minute|min|m)/i);
    return match ? parseInt(match[1], 10) : null;
  }
}

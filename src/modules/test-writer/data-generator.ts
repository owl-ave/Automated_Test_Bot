import { Logger } from '../../utils/logger';

export class DataGenerator {
  private logger = new Logger('DataGenerator');

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private randomString(length: number, charset = 'abcdefghijklmnopqrstuvwxyz'): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += charset[Math.floor(Math.random() * charset.length)];
    }
    return result;
  }

  generateEmail(): string {
    const prefixes = ['test', 'user', 'qa', 'auto', 'dev', 'staging'];
    const domains = ['testmail.com', 'example.com', 'qatest.org', 'mailinator.com'];
    const prefix = this.randomElement(prefixes);
    const timestamp = Date.now().toString(36);
    const domain = this.randomElement(domains);
    return `${prefix}.${timestamp}@${domain}`;
  }

  generatePhone(countryCode = '+1'): string {
    const areaCode = this.randomInt(200, 999);
    const prefix = this.randomInt(200, 999);
    const line = this.randomInt(1000, 9999);
    return `${countryCode}${areaCode}${prefix}${line}`;
  }

  generatePassword(options: { length?: number; strong?: boolean } = {}): string {
    const length = options.length || 12;
    if (options.strong !== false) {
      const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const lower = 'abcdefghijklmnopqrstuvwxyz';
      const digits = '0123456789';
      const special = '!@#$%^&*';
      // Ensure at least one of each
      let password =
        this.randomElement(upper.split('')) +
        this.randomElement(lower.split('')) +
        this.randomElement(digits.split('')) +
        this.randomElement(special.split(''));
      const allChars = upper + lower + digits + special;
      for (let i = password.length; i < length; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
      }
      // Shuffle
      return password
        .split('')
        .sort(() => Math.random() - 0.5)
        .join('');
    }
    return this.randomString(length, 'abcdefghijklmnopqrstuvwxyz0123456789');
  }

  generateCreditCard(type: 'visa' | 'mastercard' | 'amex' = 'visa'): {
    number: string;
    expiry: string;
    cvv: string;
    name: string;
  } {
    let prefix: string;
    let length: number;
    let cvvLength: number;

    switch (type) {
      case 'visa':
        prefix = '4';
        length = 16;
        cvvLength = 3;
        break;
      case 'mastercard':
        prefix = '5' + this.randomInt(1, 5);
        length = 16;
        cvvLength = 3;
        break;
      case 'amex':
        prefix = '3' + this.randomElement(['4', '7']);
        length = 15;
        cvvLength = 4;
        break;
    }

    // Generate remaining digits (test numbers, not Luhn-valid for safety)
    let number = prefix;
    while (number.length < length - 1) {
      number += this.randomInt(0, 9);
    }
    // Append Luhn check digit
    number += this.luhnCheckDigit(number);

    const now = new Date();
    const expiryMonth = String(this.randomInt(1, 12)).padStart(2, '0');
    const expiryYear = String(now.getFullYear() + this.randomInt(1, 5)).slice(-2);

    return {
      number,
      expiry: `${expiryMonth}/${expiryYear}`,
      cvv: String(this.randomInt(0, Math.pow(10, cvvLength) - 1)).padStart(cvvLength, '0'),
      name: this.generateFullName(),
    };
  }

  generateAddress(): {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  } {
    const streets = [
      '123 Main St',
      '456 Oak Ave',
      '789 Pine Rd',
      '321 Elm Blvd',
      '654 Maple Dr',
      '987 Cedar Ln',
      '147 Birch Way',
      '258 Walnut Ct',
    ];
    const cities = [
      'Springfield',
      'Portland',
      'Austin',
      'Denver',
      'Phoenix',
      'Seattle',
      'Atlanta',
      'Chicago',
      'Boston',
      'Miami',
    ];
    const states = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'WA'];

    return {
      street: this.randomElement(streets),
      city: this.randomElement(cities),
      state: this.randomElement(states),
      zipCode: String(this.randomInt(10000, 99999)),
      country: 'US',
    };
  }

  generateFullName(): string {
    const firstNames = [
      'James',
      'Mary',
      'Robert',
      'Patricia',
      'John',
      'Jennifer',
      'Michael',
      'Linda',
      'David',
      'Sarah',
      'Alex',
      'Chris',
    ];
    const lastNames = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
      'Anderson',
      'Taylor',
    ];
    return `${this.randomElement(firstNames)} ${this.randomElement(lastNames)}`;
  }

  generateUsername(): string {
    const adjectives = ['quick', 'lazy', 'happy', 'cool', 'smart', 'brave'];
    const nouns = ['fox', 'bear', 'eagle', 'wolf', 'tiger', 'hawk'];
    return `${this.randomElement(adjectives)}_${this.randomElement(nouns)}_${this.randomInt(100, 999)}`;
  }

  generateDate(options: { past?: boolean; future?: boolean } = {}): string {
    const now = Date.now();
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    let timestamp: number;

    if (options.future) {
      timestamp = now + this.randomInt(1, oneYear);
    } else if (options.past) {
      timestamp = now - this.randomInt(1, oneYear * 30);
    } else {
      timestamp = now - this.randomInt(-oneYear, oneYear);
    }

    return new Date(timestamp).toISOString().split('T')[0];
  }

  generateOtp(length = 6): string {
    return String(this.randomInt(0, Math.pow(10, length) - 1)).padStart(length, '0');
  }

  generateUrl(): string {
    const domains = ['example.com', 'test.org', 'sample.net', 'demo.io'];
    const paths = ['', '/page', '/about', '/products/1', '/api/v1/data'];
    return `https://${this.randomElement(domains)}${this.randomElement(paths)}`;
  }

  generateTestData(fieldType: string): string {
    const type = fieldType.toLowerCase();

    if (/email/i.test(type)) return this.generateEmail();
    if (/phone|mobile|tel/i.test(type)) return this.generatePhone();
    if (/password|pass/i.test(type)) return this.generatePassword();
    if (/name|fullname|full_name/i.test(type)) return this.generateFullName();
    if (/username|user_name/i.test(type)) return this.generateUsername();
    if (/street|address/i.test(type)) return this.generateAddress().street;
    if (/city/i.test(type)) return this.generateAddress().city;
    if (/state/i.test(type)) return this.generateAddress().state;
    if (/zip|postal/i.test(type)) return this.generateAddress().zipCode;
    if (/country/i.test(type)) return 'US';
    if (/date|birthday|dob/i.test(type)) return this.generateDate({ past: true });
    if (/url|website|link/i.test(type)) return this.generateUrl();
    if (/otp|code|verification/i.test(type)) return this.generateOtp();
    if (/card|credit/i.test(type)) return this.generateCreditCard().number;
    if (/cvv|cvc/i.test(type)) return this.generateCreditCard().cvv;
    if (/expir/i.test(type)) return this.generateCreditCard().expiry;
    if (/amount|price|cost/i.test(type)) return String(this.randomInt(1, 9999) / 100);
    if (/quantity|qty|count/i.test(type)) return String(this.randomInt(1, 100));
    if (/search|query/i.test(type)) return this.randomElement(['shoes', 'phone', 'laptop', 'book', 'shirt']);
    if (/comment|message|note|description/i.test(type)) {
      return this.randomElement([
        'This is a test comment.',
        'Automated test data entry.',
        'QA verification in progress.',
      ]);
    }

    this.logger.debug(`Unknown field type "${fieldType}", generating generic string`);
    return `test_${this.randomString(8)}`;
  }

  private luhnCheckDigit(partial: string): number {
    const digits = partial.split('').map(Number).reverse();
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = digits[i];
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return (10 - (sum % 10)) % 10;
  }
}

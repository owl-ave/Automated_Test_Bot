import { DataGenerator } from '../src/modules/test-writer/data-generator';

describe('DataGenerator', () => {
  let gen: DataGenerator;

  beforeEach(() => {
    gen = new DataGenerator();
  });

  describe('generateEmail()', () => {
    it('returns a valid email format', () => {
      const email = gen.generateEmail();
      expect(email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
    });

    it('generates unique emails', () => {
      const emails = new Set(Array.from({ length: 10 }, () => gen.generateEmail()));
      expect(emails.size).toBeGreaterThan(1);
    });
  });

  describe('generatePhone()', () => {
    it('returns phone with default +1 country code', () => {
      const phone = gen.generatePhone();
      expect(phone).toMatch(/^\+1\d{10}$/);
    });

    it('respects custom country code', () => {
      const phone = gen.generatePhone('+91');
      expect(phone.startsWith('+91')).toBe(true);
    });
  });

  describe('generatePassword()', () => {
    it('generates a strong password by default', () => {
      const pwd = gen.generatePassword();
      expect(pwd.length).toBe(12);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#$%^&*]/);
    });

    it('respects custom length', () => {
      const pwd = gen.generatePassword({ length: 20 });
      expect(pwd.length).toBe(20);
    });

    it('generates weak password when strong is false', () => {
      const pwd = gen.generatePassword({ strong: false, length: 8 });
      expect(pwd.length).toBe(8);
      expect(pwd).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('generateCreditCard()', () => {
    it('generates valid Visa card starting with 4', () => {
      const card = gen.generateCreditCard('visa');
      expect(card.number.startsWith('4')).toBe(true);
      expect(card.number.length).toBe(16);
      expect(card.cvv.length).toBe(3);
    });

    it('generates Amex card starting with 3', () => {
      const card = gen.generateCreditCard('amex');
      expect(card.number.startsWith('3')).toBe(true);
      expect(card.number.length).toBe(15);
      expect(card.cvv.length).toBe(4);
    });

    it('generates Mastercard starting with 51-55', () => {
      const card = gen.generateCreditCard('mastercard');
      const prefix = parseInt(card.number.substring(0, 2));
      expect(prefix).toBeGreaterThanOrEqual(51);
      expect(prefix).toBeLessThanOrEqual(55);
    });

    it('passes Luhn validation', () => {
      const card = gen.generateCreditCard('visa');
      expect(luhnCheck(card.number)).toBe(true);
    });

    it('generates valid expiry format', () => {
      const card = gen.generateCreditCard();
      expect(card.expiry).toMatch(/^\d{2}\/\d{2}$/);
    });

    it('generates a name on the card', () => {
      const card = gen.generateCreditCard();
      expect(card.name.split(' ').length).toBe(2);
    });
  });

  describe('generateOtp()', () => {
    it('generates 6-digit OTP by default', () => {
      const otp = gen.generateOtp();
      expect(otp.length).toBe(6);
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('generates custom length OTP', () => {
      const otp = gen.generateOtp(4);
      expect(otp.length).toBe(4);
    });
  });

  describe('generateTestData()', () => {
    it('returns email for email field type', () => {
      const data = gen.generateTestData('email');
      expect(data).toMatch(/@/);
    });

    it('returns phone for phone field type', () => {
      const data = gen.generateTestData('phone');
      expect(data).toMatch(/^\+/);
    });

    it('returns URL for url field type', () => {
      const data = gen.generateTestData('url');
      expect(data).toMatch(/^https:\/\//);
    });

    it('returns generic string for unknown field type', () => {
      const data = gen.generateTestData('foobar_xyz');
      expect(data).toMatch(/^test_/);
    });
  });

  describe('generateAddress()', () => {
    it('returns all address fields', () => {
      const addr = gen.generateAddress();
      expect(addr.street).toBeTruthy();
      expect(addr.city).toBeTruthy();
      expect(addr.state).toMatch(/^[A-Z]{2}$/);
      expect(addr.zipCode).toMatch(/^\d{5}$/);
      expect(addr.country).toBe('US');
    });
  });

  describe('generateDate()', () => {
    it('generates valid ISO date', () => {
      const date = gen.generateDate();
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('generates future date', () => {
      const date = gen.generateDate({ future: true });
      expect(new Date(date).getTime()).toBeGreaterThan(Date.now());
    });

    it('generates past date', () => {
      const date = gen.generateDate({ past: true });
      expect(new Date(date).getTime()).toBeLessThan(Date.now());
    });
  });
});

function luhnCheck(num: string): boolean {
  const digits = num.split('').map(Number).reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits[i];
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

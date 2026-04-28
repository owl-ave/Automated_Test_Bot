import { Logger } from '../src/utils/logger';

function capture(method: 'log' | 'error' | 'warn', fn: () => void): string {
  const original = console[method];
  let captured = '';
  console[method] = (s: string) => { captured = s; };
  try { fn(); } finally { console[method] = original; }
  return captured;
}

describe('Logger secret redaction', () => {
  const logger = new Logger('test');

  it('redacts sk-ant- tokens in error messages', () => {
    const out = capture('error', () => logger.error('boom', new Error('failed with sk-ant-oat01-aBcDeF_gh-iJ123')));
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-ant-oat01-aBcDeF_gh-iJ123');
  });

  it('redacts Bearer tokens inside nested objects', () => {
    const out = capture('error', () =>
      logger.error('axios fail', { config: { headers: { Authorization: 'Bearer abc.def-123_XYZ' } } }),
    );
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('Bearer abc.def-123_XYZ');
  });

  it('redacts values under sensitive keys regardless of content', () => {
    const out = capture('warn', () => logger.warn('cfg', { api_key: 'plaintext-secret-123', other: 'safe' }));
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('plaintext-secret-123');
    expect(out).toContain('safe');
  });

  it('redacts GitHub tokens in info logs', () => {
    const out = capture('log', () => logger.log('info', { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }));
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('preserves non-sensitive data', () => {
    const out = capture('log', () => logger.log('msg', { count: 42, status: 'ok' }));
    expect(out).toContain('"count":42');
    expect(out).toContain('"status":"ok"');
  });
});

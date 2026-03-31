import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RepoCache } from '../src/utils/cache';

describe('RepoCache', () => {
  let cache: RepoCache;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `test-cache-${Date.now()}`);
    cache = new RepoCache(tmpDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      /* ignore cleanup errors */
    }
  });

  it('returns null for non-existent key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves values', () => {
    cache.set('key1', { hello: 'world' }, 60000);
    const result = cache.get<{ hello: string }>('key1');
    expect(result).toEqual({ hello: 'world' });
  });

  it('returns null for expired entries', () => {
    cache.set('expired', 'value', 1); // 1ms TTL
    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 10) {
      /* busy wait */
    }
    expect(cache.get('expired')).toBeNull();
  });

  it('has() returns true for existing keys', () => {
    cache.set('exists', true, 60000);
    expect(cache.has('exists')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('invalidate() removes a key', () => {
    cache.set('toRemove', 'data', 60000);
    expect(cache.get('toRemove')).toBe('data');
    cache.invalidate('toRemove');
    expect(cache.get('toRemove')).toBeNull();
  });

  it('clear() removes all cached entries', () => {
    cache.set('a', 1, 60000);
    cache.set('b', 2, 60000);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('sanitizes keys with special characters', () => {
    cache.set('owner/repo#123', 'data', 60000);
    expect(cache.get('owner/repo#123')).toBe('data');
  });

  it('handles numeric and boolean values', () => {
    cache.set('num', 42, 60000);
    cache.set('bool', false, 60000);
    expect(cache.get('num')).toBe(42);
    expect(cache.get('bool')).toBe(false);
  });
});

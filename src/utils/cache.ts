import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class RepoCache {
  private cachePath: string;
  private logger = new Logger('RepoCache');

  constructor(cachePath: string) {
    this.cachePath = cachePath;
    this.ensureCacheDir();
  }

  get<T = unknown>(key: string): T | null {
    const filePath = this.keyToPath(key);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);

      if (Date.now() > entry.expiresAt) {
        this.invalidate(key);
        return null;
      }

      return entry.value as T;
    } catch {
      this.invalidate(key);
      return null;
    }
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.ensureCacheDir();
    const entry: CacheEntry = {
      value,
      expiresAt: Date.now() + ttlMs,
    };

    const filePath = this.keyToPath(key);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    } catch (err) {
      this.logger.error(`Failed to write cache for key "${key}"`, err);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  invalidate(key: string): void {
    const filePath = this.keyToPath(key);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      this.logger.error(`Failed to invalidate cache for key "${key}"`, err);
    }
  }

  clear(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const files = fs.readdirSync(this.cachePath);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.cachePath, file));
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to clear cache', err);
    }
  }

  private keyToPath(key: string): string {
    // Sanitize key to valid filename
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.cachePath, `${safe}.json`);
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cachePath)) {
      try {
        fs.mkdirSync(this.cachePath, { recursive: true });
      } catch {
        // directory may already exist from a race
      }
    }
  }
}

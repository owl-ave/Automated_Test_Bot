import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { getBrowserStackConfig, BrowserStackConfig } from '../../config/browserstack';
import { Logger } from '../../utils/logger';

const logger = new Logger('AppUploader');

export interface UploadResult {
  app_url: string;
  custom_id: string;
  shareable_id: string;
}

export class AppUploader {
  private config: BrowserStackConfig;

  constructor() {
    this.config = getBrowserStackConfig();
  }

  async uploadApp(appPath: string, customId: string): Promise<UploadResult> {
    const resolvedPath = path.resolve(appPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`App file not found: ${resolvedPath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!['.apk', '.ipa', '.aab'].includes(ext)) {
      throw new Error(`Unsupported app format: ${ext}. Expected .apk, .ipa, or .aab`);
    }

    logger.log('Uploading app to BrowserStack', { path: resolvedPath, customId });

    const formData = new FormData();
    const fileBuffer = fs.readFileSync(resolvedPath);
    const blob = new Blob([fileBuffer]);
    formData.append('file', blob, path.basename(resolvedPath));
    formData.append('custom_id', customId);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await axios.post(`${this.config.appAutomateUrl}/upload`, formData, {
          auth: {
            username: this.config.username,
            password: this.config.accessKey,
          },
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: this.config.timeout * 5, // uploads can be slow
        });

        const result: UploadResult = {
          app_url: response.data.app_url,
          custom_id: customId,
          shareable_id: response.data.shareable_id || '',
        };

        logger.log('Upload successful', { app_url: result.app_url });
        return result;
      } catch (error) {
        logger.warn(`Upload attempt ${attempt}/${this.config.maxRetries} failed`, error);
        if (attempt === this.config.maxRetries) throw error;
        await this.delay(this.config.retryDelayMs * attempt);
      }
    }

    throw new Error('Upload failed after all retries');
  }

  async getRecentApps(): Promise<Array<{ app_url: string; custom_id: string; uploaded_at: string }>> {
    const response = await axios.get(`${this.config.appAutomateUrl}/recent_apps`, {
      auth: {
        username: this.config.username,
        password: this.config.accessKey,
      },
      timeout: this.config.timeout,
    });
    return response.data;
  }

  async deleteApp(appId: string): Promise<void> {
    await axios.delete(`${this.config.appAutomateUrl}/app/delete/${appId}`, {
      auth: {
        username: this.config.username,
        password: this.config.accessKey,
      },
      timeout: this.config.timeout,
    });
    logger.log('App deleted', { appId });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

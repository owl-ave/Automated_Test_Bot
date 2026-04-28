import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
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

    const fileSize = (await fs.promises.stat(resolvedPath)).size;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(resolvedPath), {
        filename: path.basename(resolvedPath),
        knownLength: fileSize,
      });
      formData.append('custom_id', customId);

      try {
        const response = await axios.post(`${this.config.appAutomateUrl}/upload`, formData, {
          auth: {
            username: this.config.username,
            password: this.config.accessKey,
          },
          headers: formData.getHeaders(),
          timeout: this.config.timeout * 5, // uploads can be slow
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
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
    try {
      const response = await axios.get(`${this.config.appAutomateUrl}/recent_apps`, {
        auth: {
          username: this.config.username,
          password: this.config.accessKey,
        },
        timeout: this.config.timeout,
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch recent apps from BrowserStack', error);
      return [];
    }
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

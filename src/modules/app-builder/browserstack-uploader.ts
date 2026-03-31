import axios from 'axios';
import * as fs from 'fs';
import FormData from 'form-data';
import { Logger } from '../../utils/logger';

export interface BrowserStackUploadResponse {
  app_url: string;
  custom_id: string;
  shareable_id: string;
}

export class BrowserStackUploader {
  private logger = new Logger('BrowserStackUploader');
  private username: string;
  private accessKey: string;
  private baseUrl = 'https://api.browserstack.com/app-automate';

  constructor(username: string, accessKey: string) {
    this.username = username;
    this.accessKey = accessKey;
  }

  async uploadApp(appPath: string, customId: string): Promise<BrowserStackUploadResponse> {
    if (!fs.existsSync(appPath)) {
      throw new Error(`App file not found: ${appPath}`);
    }

    try {
      this.logger.log('Uploading app to BrowserStack', { appPath, customId });

      const form = new FormData();
      form.append('file', fs.createReadStream(appPath));
      form.append('custom_id', customId);

      const response = await axios.post<BrowserStackUploadResponse>(`${this.baseUrl}/upload`, form, {
        auth: {
          username: this.username,
          password: this.accessKey,
        },
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      this.logger.log('App uploaded successfully', { app_url: response.data.app_url });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to upload app to BrowserStack', error);
      throw error;
    }
  }

  async uploadAppUrl(publicUrl: string, customId: string): Promise<BrowserStackUploadResponse> {
    try {
      this.logger.log('Uploading app to BrowserStack via URL', { url: publicUrl, customId });

      const response = await axios.post<BrowserStackUploadResponse>(
        `${this.baseUrl}/upload`,
        { url: publicUrl, custom_id: customId },
        {
          auth: { username: this.username, password: this.accessKey },
          headers: { 'Content-Type': 'application/json' },
        },
      );

      this.logger.log('App uploaded via URL', { app_url: response.data.app_url });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to upload app via URL', error);
      throw error;
    }
  }

  async deleteApp(customId: string): Promise<void> {
    try {
      this.logger.log('Deleting app from BrowserStack', { customId });

      await axios.delete(`${this.baseUrl}/delete`, {
        params: { custom_id: customId },
        auth: {
          username: this.username,
          password: this.accessKey,
        },
      });

      this.logger.log('App deleted successfully', { customId });
    } catch (error) {
      this.logger.error('Failed to delete app from BrowserStack', error);
      throw error;
    }
  }

  async getAppDetails(customId: string): Promise<any> {
    try {
      const response = await axios.get(`${this.baseUrl}/app`, {
        params: { custom_id: customId },
        auth: {
          username: this.username,
          password: this.accessKey,
        },
      });
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get app details from BrowserStack', error);
      throw error;
    }
  }
}

import axios from 'axios';
import { ApiEndpoint } from '../../types';
import { Logger } from '../../utils/logger';

export interface RateLimitResult {
  endpoint: string;
  method: string;
  rateLimited: boolean;
  limitHit: number;
  totalRequests: number;
  responseCode: number;
  retryAfter?: number;
}

export class RateLimitTester {
  private logger = new Logger('RateLimitTester');

  async testRateLimit(endpoint: ApiEndpoint, baseUrl: string, requestCount: number = 100): Promise<RateLimitResult> {
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint.path}`;
    this.logger.log('Testing rate limit', { url, requestCount });

    let rateLimitedAt = -1;
    let lastResponseCode = 0;
    let retryAfter: number | undefined;

    // Send requests in batches to avoid overwhelming the connection pool
    const batchSize = 10;
    const batches = Math.ceil(requestCount / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const currentBatchSize = Math.min(batchSize, requestCount - batch * batchSize);
      const promises = Array.from({ length: currentBatchSize }, (_, i) => {
        const requestIndex = batch * batchSize + i;
        return this.sendRequest(url, endpoint.method).then((res) => ({
          index: requestIndex,
          status: res.status,
          retryAfter: res.retryAfter,
        }));
      });

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          lastResponseCode = result.value.status;
          if (result.value.status === 429 && rateLimitedAt === -1) {
            rateLimitedAt = result.value.index;
            retryAfter = result.value.retryAfter;
          }
        }
      }

      if (rateLimitedAt !== -1) break;
    }

    const rateLimited = rateLimitedAt !== -1;

    this.logger.log('Rate limit test complete', {
      rateLimited,
      limitHit: rateLimitedAt,
    });

    return {
      endpoint: endpoint.path,
      method: endpoint.method,
      rateLimited,
      limitHit: rateLimitedAt,
      totalRequests: requestCount,
      responseCode: rateLimited ? 429 : lastResponseCode,
      retryAfter,
    };
  }

  private async sendRequest(url: string, method: string): Promise<{ status: number; retryAfter?: number }> {
    try {
      const response = await axios({
        method: method.toLowerCase() as any,
        url,
        timeout: 5000,
        validateStatus: () => true,
      });

      return {
        status: response.status,
        retryAfter: response.headers['retry-after'] ? parseInt(response.headers['retry-after'], 10) : undefined,
      };
    } catch (err: any) {
      if (err.response) {
        return {
          status: err.response.status,
          retryAfter: err.response.headers?.['retry-after']
            ? parseInt(err.response.headers['retry-after'], 10)
            : undefined,
        };
      }
      return { status: 0 };
    }
  }
}

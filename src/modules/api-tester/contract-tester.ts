import axios, { AxiosError } from 'axios';
import { ApiEndpoint } from '../../types';
import { Logger } from '../../utils/logger';

export interface ContractTestResult {
  endpoint: string;
  method: string;
  testCase: string;
  expectedStatus: number;
  actualStatus: number;
  passed: boolean;
  responseTime: number;
  error?: string;
}

export class ContractTester {
  private logger = new Logger('ContractTester');
  private timeout = 10000;

  async testEndpoint(endpoint: ApiEndpoint, baseUrl: string): Promise<ContractTestResult[]> {
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint.path}`;
    const results: ContractTestResult[] = [];

    // Test 1: Valid request should return 2xx
    results.push(await this.testValidRequest(endpoint, url));

    // Test 2: Missing required fields should return 400
    if (endpoint.requestSchema && Object.keys(endpoint.requestSchema).length > 0) {
      results.push(await this.testMissingRequired(endpoint, url));
    }

    // Test 3: Invalid types should return 400
    if (endpoint.requestSchema && Object.keys(endpoint.requestSchema).length > 0) {
      results.push(await this.testInvalidTypes(endpoint, url));
    }

    // Test 4: Unauthorized request should return 401
    results.push(await this.testUnauthorized(endpoint, url));

    return results;
  }

  private async testValidRequest(endpoint: ApiEndpoint, url: string): Promise<ContractTestResult> {
    const start = Date.now();
    try {
      const response = await axios({
        method: endpoint.method.toLowerCase() as any,
        url,
        data: endpoint.method !== 'GET' ? endpoint.requestSchema || {} : undefined,
        timeout: this.timeout,
        validateStatus: () => true,
      });

      const passed = response.status >= 200 && response.status < 300;
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        testCase: 'valid_request',
        expectedStatus: 200,
        actualStatus: response.status,
        passed,
        responseTime: Date.now() - start,
      };
    } catch (err) {
      return this.errorResult(endpoint, 'valid_request', 200, start, err);
    }
  }

  private async testMissingRequired(endpoint: ApiEndpoint, url: string): Promise<ContractTestResult> {
    const start = Date.now();
    try {
      const response = await axios({
        method: endpoint.method.toLowerCase() as any,
        url,
        data: {}, // empty body — missing all required fields
        timeout: this.timeout,
        validateStatus: () => true,
      });

      const passed = response.status === 400 || response.status === 422;
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        testCase: 'missing_required_fields',
        expectedStatus: 400,
        actualStatus: response.status,
        passed,
        responseTime: Date.now() - start,
      };
    } catch (err) {
      return this.errorResult(endpoint, 'missing_required_fields', 400, start, err);
    }
  }

  private async testInvalidTypes(endpoint: ApiEndpoint, url: string): Promise<ContractTestResult> {
    const start = Date.now();
    const invalidData = this.generateInvalidData(endpoint.requestSchema || {});

    try {
      const response = await axios({
        method: endpoint.method.toLowerCase() as any,
        url,
        data: invalidData,
        timeout: this.timeout,
        validateStatus: () => true,
      });

      const passed = response.status === 400 || response.status === 422;
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        testCase: 'invalid_types',
        expectedStatus: 400,
        actualStatus: response.status,
        passed,
        responseTime: Date.now() - start,
      };
    } catch (err) {
      return this.errorResult(endpoint, 'invalid_types', 400, start, err);
    }
  }

  private async testUnauthorized(endpoint: ApiEndpoint, url: string): Promise<ContractTestResult> {
    const start = Date.now();
    try {
      const response = await axios({
        method: endpoint.method.toLowerCase() as any,
        url,
        headers: { Authorization: 'Bearer invalid_token_12345' },
        timeout: this.timeout,
        validateStatus: () => true,
      });

      const passed = response.status === 401 || response.status === 403;
      return {
        endpoint: endpoint.path,
        method: endpoint.method,
        testCase: 'unauthorized',
        expectedStatus: 401,
        actualStatus: response.status,
        passed,
        responseTime: Date.now() - start,
      };
    } catch (err) {
      return this.errorResult(endpoint, 'unauthorized', 401, start, err);
    }
  }

  private generateInvalidData(schema: Record<string, unknown>): Record<string, unknown> {
    const invalid: Record<string, unknown> = {};
    for (const key of Object.keys(schema)) {
      // Invert types: strings become numbers, numbers become strings, etc.
      const val = schema[key];
      if (typeof val === 'string') invalid[key] = 99999;
      else if (typeof val === 'number') invalid[key] = 'not_a_number';
      else if (typeof val === 'boolean') invalid[key] = 'not_bool';
      else invalid[key] = 12345;
    }
    return invalid;
  }

  private errorResult(
    endpoint: ApiEndpoint,
    testCase: string,
    expectedStatus: number,
    start: number,
    err: unknown,
  ): ContractTestResult {
    const axiosErr = err as AxiosError;
    return {
      endpoint: endpoint.path,
      method: endpoint.method,
      testCase,
      expectedStatus,
      actualStatus: axiosErr.response?.status || 0,
      passed: false,
      responseTime: Date.now() - start,
      error: axiosErr.message || String(err),
    };
  }
}

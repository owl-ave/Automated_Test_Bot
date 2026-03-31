import { PipelineContext, ModuleResult } from '../../types';
import { Logger } from '../../utils/logger';
import { EndpointDiscovery } from './endpoint-discovery';
import { SchemaValidator } from './schema-validator';
import { ContractTester, ContractTestResult } from './contract-tester';
import { RateLimitTester } from './rate-limiter';

export async function runApiTester(context: PipelineContext): Promise<ModuleResult> {
  const logger = new Logger('ApiTester');
  logger.log('Starting API tester module');

  const framework = context.codeAnalysis?.framework || 'native';
  const contractResults: ContractTestResult[] = [];
  const schemaErrors: string[] = [];

  try {
    // Discover endpoints from code
    const discovery = new EndpointDiscovery();
    const repoPath = (context as any).repoPath || '.';
    const discoveredEndpoints = await discovery.discoverEndpoints(repoPath, framework);
    logger.log('Endpoints discovered', { count: discoveredEndpoints.length });

    // Merge with endpoints from code analysis
    const endpoints = [...discoveredEndpoints, ...(context.codeAnalysis?.apiEndpoints || [])];

    if (endpoints.length === 0) {
      logger.log('No API endpoints found, skipping API testing');
      return { moduleName: 'api-tester', status: 'success', data: { skipped: true, reason: 'No endpoints found' } };
    }

    // Schema validation if spec is available
    const specPath = (context as any).openApiSpecPath;
    const schemaValidator = new SchemaValidator();
    if (specPath) {
      try {
        await schemaValidator.loadSpec(specPath);
        logger.log('OpenAPI spec loaded for validation');
      } catch (err) {
        logger.warn('Could not load OpenAPI spec, skipping schema validation');
      }
    }

    // Contract testing
    const baseUrl = (context as any).apiBaseUrl;
    if (baseUrl) {
      const contractTester = new ContractTester();

      for (const endpoint of endpoints.slice(0, 20)) {
        // limit to 20 endpoints
        try {
          const results = await contractTester.testEndpoint(endpoint, baseUrl);
          contractResults.push(...results);
        } catch (err) {
          logger.error(`Contract test failed for ${endpoint.method} ${endpoint.path}`, err);
        }
      }

      // Rate limit testing on critical endpoints
      const rateLimitTester = new RateLimitTester();
      const criticalEndpoints = endpoints.filter(
        (e) => e.path.includes('login') || e.path.includes('auth') || e.path.includes('payment'),
      );

      for (const endpoint of criticalEndpoints.slice(0, 3)) {
        try {
          const result = await rateLimitTester.testRateLimit(endpoint, baseUrl, 50);
          if (!result.rateLimited) {
            context.logs.push(`[api] WARNING: No rate limiting on ${endpoint.method} ${endpoint.path}`);
          }
        } catch (err) {
          logger.error(`Rate limit test failed for ${endpoint.path}`, err);
        }
      }
    }

    const passed = contractResults.filter((r) => r.passed).length;
    const failed = contractResults.filter((r) => !r.passed).length;

    logger.log('API tester completed', { endpoints: endpoints.length, passed, failed });

    return {
      moduleName: 'api-tester',
      status: failed > 0 ? 'warning' : 'success',
      data: {
        endpointsDiscovered: endpoints.length,
        contractTests: { passed, failed, results: contractResults },
        schemaErrors,
      },
    };
  } catch (err) {
    logger.error('API tester module failed', err);
    return { moduleName: 'api-tester', status: 'error', error: String(err) };
  }
}

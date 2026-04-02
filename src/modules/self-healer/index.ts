import { PipelineContext, ModuleResult, TestResult } from '../../types';
import { LocatorHealer, HealResult } from './locator-healer';
import { FlowAdapter, AdaptResult } from './flow-adapter';
import { FeatureUpdater, UpdateResult } from './feature-updater';
import { Logger } from '../../utils/logger';

const logger = new Logger('SelfHealer');

interface HealingSummary {
  locatorsHealed: number;
  locatorsAttempted: number;
  flowsAdapted: number;
  featuresUpdated: number;
  healedResults: Array<{ scenario: string; device: string; healResult: HealResult }>;
  adaptedFlows: Array<{ scenario: string; adaptResult: AdaptResult }>;
  featureUpdates: UpdateResult[];
}

export async function runSelfHealer(context: PipelineContext): Promise<ModuleResult> {
  try {
    const testResults = context.testResults;
    if (!testResults || testResults.length === 0) {
      return { moduleName: 'SelfHealer', status: 'warning', error: 'No test results to heal' };
    }

    const locatorHealer = new LocatorHealer();
    const flowAdapter = new FlowAdapter();
    const featureUpdater = new FeatureUpdater();

    const summary: HealingSummary = {
      locatorsHealed: 0,
      locatorsAttempted: 0,
      flowsAdapted: 0,
      featuresUpdated: 0,
      healedResults: [],
      adaptedFlows: [],
      featureUpdates: [],
    };

    // Process failed tests
    const failedTests = testResults.filter((r) => r.status === 'fail');
    logger.log('Processing failed tests for self-healing', { count: failedTests.length });

    for (const failure of failedTests) {
      const errorMsg = failure.error || '';

      // Attempt locator healing for "element not found" errors
      if (isLocatorError(errorMsg)) {
        summary.locatorsAttempted++;
        const locatorInfo = extractLocatorFromError(errorMsg);

        if (locatorInfo) {
          // We'd need page source from the session — use empty string as fallback
          // In production, this would be captured during test execution
          const healResult = await locatorHealer.healLocator(locatorInfo, '');

          summary.healedResults.push({
            scenario: failure.scenario,
            device: failure.device,
            healResult,
          });

          if (healResult.healed) {
            summary.locatorsHealed++;
            logger.log('Locator healed', {
              scenario: failure.scenario,
              method: healResult.method,
              newStrategy: healResult.newStrategy,
            });
          }
        }
      }

      // Attempt flow adaptation for unexpected screen errors
      if (isUnexpectedScreenError(errorMsg)) {
        const adaptResult = flowAdapter.handleUnexpectedScreen(
          errorMsg,
          failure.scenario,
          '', // page source would be captured during execution
        );

        summary.adaptedFlows.push({
          scenario: failure.scenario,
          adaptResult,
        });

        if (adaptResult.action !== 'report') {
          summary.flowsAdapted++;
        }
      }
    }

    // Update feature files based on code changes
    if (context.diffFiles && context.diffFiles.length > 0) {
      const path = await import('path');
      const featureDir = path.join(context.targetPath, 'features');
      const featureUpdates = await featureUpdater.updateAllFeatureFiles(featureDir, context.diffFiles);

      summary.featureUpdates = featureUpdates;
      summary.featuresUpdated = featureUpdates.filter((u) => u.updated).length;
    }

    logger.log('Self-healing complete', {
      locatorsHealed: summary.locatorsHealed,
      locatorsAttempted: summary.locatorsAttempted,
      flowsAdapted: summary.flowsAdapted,
      featuresUpdated: summary.featuresUpdated,
    });

    return {
      moduleName: 'SelfHealer',
      status:
        summary.locatorsHealed > 0 || summary.flowsAdapted > 0 || summary.featuresUpdated > 0 ? 'success' : 'warning',
      data: summary,
    };
  } catch (error) {
    logger.error('Self-Healer module failed', error);
    return { moduleName: 'SelfHealer', status: 'error', error: String(error) };
  }
}

function isLocatorError(error: string): boolean {
  const patterns = [
    'no such element',
    'element not found',
    'unable to locate',
    'nosuchelement',
    'stale element',
    'invalid selector',
    'element is not attached',
  ];
  const lower = error.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function isUnexpectedScreenError(error: string): boolean {
  const patterns = [
    'unexpected screen',
    'unexpected alert',
    'unexpected popup',
    'not the expected',
    'wrong screen',
    'permission dialog',
    'system dialog',
  ];
  const lower = error.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function extractLocatorFromError(error: string): { strategy: string; value: string } | null {
  // Try to extract locator info from common error message formats
  const patterns = [
    /(?:selector|locator|using)\s*[:=]\s*["']?(\w[\w\s]*?)["']?\s*(?:,|and)\s*(?:value|with)\s*[:=]\s*["']?([^"'\n]+)["']?/i,
    /(?:id|accessibility id|xpath|css selector)\s*[:=]\s*["']?([^"'\n]+)["']?/i,
    /element\s+["']([^"']+)["']\s+(?:not found|could not be located)/i,
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match) {
      if (match[2]) {
        return { strategy: match[1].trim(), value: match[2].trim() };
      }
      // Guess strategy from value format
      const value = match[1].trim();
      if (value.startsWith('//') || value.startsWith('(//')) return { strategy: 'xpath', value };
      if (value.includes(':id/')) return { strategy: 'id', value };
      return { strategy: 'accessibility id', value };
    }
  }

  return null;
}

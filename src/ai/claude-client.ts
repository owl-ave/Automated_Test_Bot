import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../utils/logger';
import { safeJsonParseWithDefault } from './parse-json';

const logger = new Logger('ClaudeClient');

const QUERY_TIMEOUT_MS = 120_000; // 2 minutes per query

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function executeQuery(prompt: string, maxTurns: number): Promise<string> {
  let result = '';
  for await (const message of query({
    prompt,
    options: { maxTurns, model: 'claude-sonnet-4-6' },
  })) {
    if ('result' in message) {
      result = message.result;
      break;
    }
  }
  return result;
}

async function runQuery(prompt: string, maxTurns: number = 1): Promise<string> {
  try {
    return await withTimeout(executeQuery(prompt, maxTurns), QUERY_TIMEOUT_MS);
  } catch (error: any) {
    logger.error('Claude Agent SDK query failed', { message: error.message || String(error), code: error.code });
    try {
      logger.log('Retrying Claude query...');
      return await withTimeout(executeQuery(prompt, maxTurns), QUERY_TIMEOUT_MS);
    } catch (retryError: any) {
      logger.error('Claude query retry also failed', { message: retryError.message || String(retryError), code: retryError.code });
      throw retryError;
    }
  }
}

export class ClaudeClient {
  constructor() {
    // Agent SDK uses CLAUDE_CODE_OAUTH_TOKEN from environment automatically
  }

  async analyzeCode(codeSnippet: string, instruction: string): Promise<string> {
    logger.log('Analyzing code with Claude Agent SDK');
    return runQuery(`${instruction}\n\n${codeSnippet}`);
  }

  async generateFeatures(codeAnalysis: string, framework: string): Promise<string> {
    logger.log('Generating features with Claude Agent SDK', { framework });
    return runQuery(
      `Generate Gherkin BDD feature files for a ${framework} mobile app based on this code analysis:\n\n${codeAnalysis}`,
    );
  }

  async validateOutput(_screenshot: string, expectedBehavior: string): Promise<{ status: string; confidence: number }> {
    logger.log('Validating output with Claude Agent SDK');
    const text = await runQuery(
      `Does this screen match the expected behavior? Expected: ${expectedBehavior}\n\nRespond with JSON: {"status": "pass|fail|warn", "confidence": 0-100}`,
    );
    return safeJsonParseWithDefault<{ status: string; confidence: number }>(text, {
      status: 'warn',
      confidence: 0,
    });
  }

  async prompt(text: string): Promise<string> {
    return runQuery(text);
  }
}

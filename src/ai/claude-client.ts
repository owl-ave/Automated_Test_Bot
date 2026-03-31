import { query } from '@anthropic-ai/claude-agent-sdk';
import { Logger } from '../utils/logger';

const logger = new Logger('ClaudeClient');

async function runQuery(prompt: string, maxTurns: number = 1): Promise<string> {
  let result = '';
  for await (const message of query({
    prompt,
    options: {
      maxTurns,
      model: 'claude-opus-4-6',
    },
  })) {
    if ('result' in message) {
      result = message.result;
    }
  }
  return result;
}

export class ClaudeClient {
  constructor() {
    // Agent SDK uses CLAUDE_AUTH_TOKEN from environment automatically
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

  async validateOutput(screenshot: string, expectedBehavior: string): Promise<{ status: string; confidence: number }> {
    logger.log('Validating output with Claude Agent SDK');
    const text = await runQuery(
      `Does this screen match the expected behavior? Expected: ${expectedBehavior}\n\nRespond with JSON: {"status": "pass|fail|warn", "confidence": 0-100}`,
    );
    try {
      return JSON.parse(
        text
          .replace(/```json?\n?/g, '')
          .replace(/```/g, '')
          .trim(),
      );
    } catch {
      return { status: 'warn', confidence: 0 };
    }
  }

  async prompt(text: string): Promise<string> {
    return runQuery(text);
  }
}

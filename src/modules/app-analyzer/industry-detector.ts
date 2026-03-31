import { CodeAnalysis } from '../../types';
import { Logger } from '../../utils/logger';
import { ClaudeClient } from '../../ai/claude-client';

export class IndustryDetector {
  private logger = new Logger('IndustryDetector');

  async detect(analysis: CodeAnalysis): Promise<string> {
    if (process.env.CLAUDE_AUTH_TOKEN) {
      try {
        const claude = new ClaudeClient();
        const prompt = `Analyze this code mapping and determine the primary industry of the mobile app.
Output ONLY the industry name (e.g., e-commerce, fintech, healthcare, saas, social, generic) in lowercase.

App Analysis Data:
${JSON.stringify({ screens: analysis.screens, endpoints: analysis.apiEndpoints })}`;

        const aiResponse = await claude.analyzeCode('', prompt);
        const parsedIndustry = aiResponse.trim().toLowerCase();

        if (parsedIndustry.length > 0 && parsedIndustry.length < 20) {
          this.logger.log('Industry detected via AI', { industry: parsedIndustry });
          return parsedIndustry;
        }
      } catch (err) {
        this.logger.warn('AI industry detection failed, falling back to static pattern matching', err);
      }
    }

    const allText = JSON.stringify(analysis).toLowerCase();

    const patterns: { [key: string]: string[] } = {
      'e-commerce': ['cart', 'product', 'order', 'payment', 'checkout', 'wishlist', 'inventory'],
      fintech: ['transaction', 'account', 'balance', 'wallet', 'crypto', 'upi', 'kyc', 'otp'],
      saas: ['subscription', 'plan', 'tenant', 'billing', 'dashboard', 'invite', 'team'],
      healthcare: ['patient', 'appointment', 'prescription', 'doctor', 'clinic', 'diagnosis'],
      'food-delivery': ['restaurant', 'menu', 'order', 'delivery', 'driver', 'rating'],
      social: ['feed', 'post', 'profile', 'follow', 'chat', 'notification', 'like'],
      education: ['course', 'student', 'lesson', 'quiz', 'grade', 'enrollment'],
    };

    const scores: { [key: string]: number } = {};
    for (const [industry, keywords] of Object.entries(patterns)) {
      scores[industry] = keywords.filter((k) => allText.includes(k)).length;
    }

    const detected = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const industry = detected && detected[1] > 0 ? detected[0] : 'generic';

    this.logger.log('Industry detected via static rules', { industry, score: detected?.[1] || 0 });
    return industry;
  }
}

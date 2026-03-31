import { Flow } from '../../types';
import { Logger } from '../../utils/logger';

export interface RankedFlow extends Flow {
  riskScore: number;
  reason: string;
}

export class CriticalPathRanker {
  private logger = new Logger('CriticalPathRanker');

  private static readonly INDUSTRY_CRITICAL_FLOWS: Record<
    string,
    Record<string, 'critical' | 'high' | 'medium' | 'low'>
  > = {
    'e-commerce': {
      checkout: 'critical',
      payment: 'critical',
      cart: 'critical',
      login: 'critical',
      signup: 'critical',
      auth: 'critical',
      search: 'high',
      product: 'high',
      order: 'high',
      wishlist: 'high',
      profile: 'medium',
      settings: 'medium',
      review: 'medium',
      notification: 'medium',
      about: 'low',
      faq: 'low',
      help: 'low',
      terms: 'low',
    },
    fintech: {
      payment: 'critical',
      transfer: 'critical',
      transaction: 'critical',
      kyc: 'critical',
      login: 'critical',
      auth: 'critical',
      otp: 'critical',
      pin: 'critical',
      balance: 'high',
      account: 'high',
      wallet: 'high',
      statement: 'high',
      profile: 'medium',
      settings: 'medium',
      notification: 'medium',
      support: 'medium',
      about: 'low',
      faq: 'low',
      referral: 'low',
    },
    healthcare: {
      appointment: 'critical',
      prescription: 'critical',
      consultation: 'critical',
      login: 'critical',
      auth: 'critical',
      patient: 'critical',
      doctor: 'high',
      records: 'high',
      medication: 'high',
      lab: 'high',
      profile: 'medium',
      settings: 'medium',
      insurance: 'medium',
      notification: 'medium',
      about: 'low',
      faq: 'low',
      feedback: 'low',
    },
    'food-delivery': {
      checkout: 'critical',
      payment: 'critical',
      order: 'critical',
      login: 'critical',
      auth: 'critical',
      restaurant: 'high',
      menu: 'high',
      cart: 'high',
      tracking: 'high',
      search: 'high',
      profile: 'medium',
      address: 'medium',
      rating: 'medium',
      notification: 'medium',
      about: 'low',
      faq: 'low',
      promo: 'low',
    },
    social: {
      login: 'critical',
      auth: 'critical',
      signup: 'critical',
      feed: 'high',
      post: 'high',
      chat: 'high',
      message: 'high',
      profile: 'medium',
      search: 'medium',
      notification: 'medium',
      follow: 'medium',
      settings: 'low',
      about: 'low',
      help: 'low',
    },
    education: {
      login: 'critical',
      auth: 'critical',
      enrollment: 'critical',
      course: 'high',
      lesson: 'high',
      quiz: 'high',
      exam: 'high',
      assignment: 'high',
      profile: 'medium',
      grade: 'medium',
      schedule: 'medium',
      notification: 'medium',
      settings: 'low',
      about: 'low',
      faq: 'low',
    },
    saas: {
      login: 'critical',
      auth: 'critical',
      signup: 'critical',
      billing: 'critical',
      dashboard: 'high',
      workspace: 'high',
      project: 'high',
      invite: 'high',
      profile: 'medium',
      settings: 'medium',
      notification: 'medium',
      team: 'medium',
      about: 'low',
      help: 'low',
      changelog: 'low',
    },
    generic: {
      login: 'critical',
      auth: 'critical',
      signup: 'critical',
      payment: 'critical',
      home: 'high',
      dashboard: 'high',
      main: 'high',
      profile: 'medium',
      settings: 'medium',
      search: 'medium',
      about: 'low',
      help: 'low',
      faq: 'low',
    },
  };

  rankFlows(flows: Flow[], industry: string): RankedFlow[] {
    const industryMap =
      CriticalPathRanker.INDUSTRY_CRITICAL_FLOWS[industry] || CriticalPathRanker.INDUSTRY_CRITICAL_FLOWS['generic'];

    const ranked: RankedFlow[] = flows.map((flow) => {
      const { priority, reason, riskScore } = this.evaluateFlow(flow, industryMap);
      return { ...flow, priority, riskScore, reason };
    });

    ranked.sort((a, b) => b.riskScore - a.riskScore);

    this.logger.log('Flows ranked', {
      total: ranked.length,
      critical: ranked.filter((f) => f.priority === 'critical').length,
      high: ranked.filter((f) => f.priority === 'high').length,
      medium: ranked.filter((f) => f.priority === 'medium').length,
      low: ranked.filter((f) => f.priority === 'low').length,
    });

    return ranked;
  }

  private evaluateFlow(
    flow: Flow,
    industryMap: Record<string, 'critical' | 'high' | 'medium' | 'low'>,
  ): { priority: 'critical' | 'high' | 'medium' | 'low'; reason: string; riskScore: number } {
    const flowNameLower = flow.name.toLowerCase();
    let riskScore = 0;
    const reasons: string[] = [];

    // Match against industry-specific keywords
    let bestMatch: { keyword: string; priority: 'critical' | 'high' | 'medium' | 'low' } | null = null;
    for (const [keyword, priority] of Object.entries(industryMap)) {
      if (flowNameLower.includes(keyword)) {
        const priorityScore = this.priorityToScore(priority);
        if (!bestMatch || priorityScore > this.priorityToScore(bestMatch.priority)) {
          bestMatch = { keyword, priority };
        }
      }
    }

    if (bestMatch) {
      riskScore += this.priorityToScore(bestMatch.priority);
      reasons.push(`Matches industry keyword "${bestMatch.keyword}"`);
    }

    // Check screen count -- more screens = more complex = higher risk
    if (flow.screens.length >= 5) {
      riskScore += 10;
      reasons.push(`Complex flow (${flow.screens.length} screens)`);
    } else if (flow.screens.length >= 3) {
      riskScore += 5;
      reasons.push(`Multi-screen flow (${flow.screens.length} screens)`);
    }

    // Money-related flows are always critical
    if (/payment|checkout|billing|transaction|transfer|purchase|subscribe/i.test(flowNameLower)) {
      riskScore += 30;
      reasons.push('Involves financial transaction');
    }

    // Auth flows are always critical
    if (/login|signup|register|auth|otp|2fa|mfa|password|verify/i.test(flowNameLower)) {
      riskScore += 25;
      reasons.push('Authentication/security flow');
    }

    // Data entry flows have higher risk
    if (/form|input|submit|create|edit|update/i.test(flowNameLower)) {
      riskScore += 10;
      reasons.push('Data entry flow');
    }

    // Affected by current PR
    if (flow.affectedByPr) {
      riskScore += 20;
      reasons.push('Affected by current PR changes');
    }

    const priority = this.scoreToPriority(riskScore);
    return { priority, reason: reasons.join('; '), riskScore };
  }

  private priorityToScore(priority: 'critical' | 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'critical':
        return 40;
      case 'high':
        return 25;
      case 'medium':
        return 15;
      case 'low':
        return 5;
    }
  }

  private scoreToPriority(score: number): 'critical' | 'high' | 'medium' | 'low' {
    if (score >= 50) return 'critical';
    if (score >= 30) return 'high';
    if (score >= 15) return 'medium';
    return 'low';
  }
}

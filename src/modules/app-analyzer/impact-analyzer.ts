import { DiffFile, Flow, Screen } from '../../types';
import { Logger } from '../../utils/logger';

export interface ImpactResult {
  affectedFlows: AffectedFlow[];
  affectedScreens: string[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  totalFilesChanged: number;
  impactPercentage: number;
}

export interface AffectedFlow {
  flow: Flow;
  impactedScreens: string[];
  changeType: 'direct' | 'indirect';
  reason: string;
}

export class ImpactAnalyzer {
  private logger = new Logger('ImpactAnalyzer');

  analyzeImpact(diffFiles: DiffFile[], flows: Flow[], screens: Screen[]): ImpactResult {
    if (diffFiles.length === 0) {
      this.logger.warn('No diff files to analyze');
      return this.emptyResult();
    }

    const affectedScreenNames = this.findAffectedScreens(diffFiles, screens);
    const indirectScreens = this.findIndirectlyAffectedScreens(affectedScreenNames, screens, diffFiles);
    const allAffectedScreens = [...new Set([...affectedScreenNames, ...indirectScreens])];
    const affectedFlows = this.matchFlowsToChanges(diffFiles, flows, allAffectedScreens);
    const riskLevel = this.calculateRiskLevel(affectedFlows, diffFiles);
    const impactPercentage = screens.length > 0 ? Math.round((allAffectedScreens.length / screens.length) * 100) : 0;

    const result: ImpactResult = {
      affectedFlows,
      affectedScreens: allAffectedScreens,
      riskLevel,
      summary: this.buildSummary(affectedFlows, allAffectedScreens, diffFiles),
      totalFilesChanged: diffFiles.length,
      impactPercentage,
    };

    this.logger.log('Impact analysis complete', {
      affectedFlows: affectedFlows.length,
      affectedScreens: allAffectedScreens.length,
      riskLevel,
      impactPercentage,
    });

    return result;
  }

  private findAffectedScreens(diffFiles: DiffFile[], screens: Screen[]): string[] {
    const affected: string[] = [];

    for (const screen of screens) {
      const screenPathNormalized = screen.path.replace(/\\/g, '/').toLowerCase();
      const screenNameLower = screen.name.toLowerCase();

      for (const diff of diffFiles) {
        const diffPathNormalized = diff.path.replace(/\\/g, '/').toLowerCase();

        // Direct file match
        if (screenPathNormalized.includes(diffPathNormalized) || diffPathNormalized.includes(screenNameLower)) {
          affected.push(screen.name);
          break;
        }

        // Check if the diff file is a component/module used by the screen
        const diffBaseName = this.extractBaseName(diff.path).toLowerCase();
        if (screenNameLower.includes(diffBaseName) || diffBaseName.includes(screenNameLower)) {
          affected.push(screen.name);
          break;
        }
      }
    }

    return affected;
  }

  private findIndirectlyAffectedScreens(
    directlyAffected: string[],
    screens: Screen[],
    diffFiles: DiffFile[],
  ): string[] {
    const indirect: string[] = [];

    // Shared utility/service changes affect screens that use them
    const sharedChanges = diffFiles.filter((f) => {
      const p = f.path.toLowerCase();
      return (
        p.includes('util') ||
        p.includes('helper') ||
        p.includes('service') ||
        p.includes('api') ||
        p.includes('hook') ||
        p.includes('store') ||
        p.includes('redux') ||
        p.includes('provider') ||
        p.includes('context') ||
        p.includes('model') ||
        p.includes('theme') ||
        p.includes('style') ||
        p.includes('navigation') ||
        p.includes('route')
      );
    });

    if (sharedChanges.length > 0) {
      // Navigation changes: instead of flagging every screen (useless over-broad signal),
      // scan the patch content and flag only screens whose name actually appears in the diff.
      // If the patch is empty/unavailable, fall back to "no indirect nav impact" rather than
      // the old "everything is affected" behaviour.
      const navChanges = sharedChanges.filter((f) => {
        const p = f.path.toLowerCase();
        return p.includes('navigation') || p.includes('route') || p.includes('router');
      });

      if (navChanges.length > 0) {
        const patchBlob = navChanges
          .map((f) => f.patch || '')
          .join('\n')
          .toLowerCase();
        if (patchBlob.length > 0) {
          for (const screen of screens) {
            if (directlyAffected.includes(screen.name)) continue;
            const screenName = screen.name.toLowerCase();
            if (screenName.length < 3) continue; // avoid false positives on very short names
            if (patchBlob.includes(screenName)) {
              indirect.push(screen.name);
            }
          }
        } else {
          this.logger.debug(
            'Navigation file changed but patch content unavailable; skipping indirect nav impact (would be over-broad)',
          );
        }
      }

      // Theme/style changes: prefer scanning patch content so only screens referenced in the
      // touched style/theme get flagged. If no patch is available fall back to a capped
      // sample (max 5 screens) to avoid flooding the report with every screen as "affected".
      const themeChanges = sharedChanges.filter((f) => {
        const p = f.path.toLowerCase();
        return p.includes('theme') || p.includes('style') || p.includes('color');
      });

      if (themeChanges.length > 0) {
        const patchBlob = themeChanges
          .map((f) => f.patch || '')
          .join('\n')
          .toLowerCase();
        const candidates = screens.filter((s) => !directlyAffected.includes(s.name) && !indirect.includes(s.name));
        const matched = patchBlob.length > 0
          ? candidates.filter((s) => s.name.length >= 3 && patchBlob.includes(s.name.toLowerCase()))
          : candidates.slice(0, 5);
        for (const screen of matched) {
          indirect.push(screen.name);
        }
      }

      // API/service changes affect screens that likely use those services
      const apiChanges = sharedChanges.filter((f) => {
        const p = f.path.toLowerCase();
        return p.includes('api') || p.includes('service');
      });

      for (const apiChange of apiChanges) {
        const serviceName = this.extractBaseName(apiChange.path)
          .toLowerCase()
          .replace(/service|api|client/gi, '');

        for (const screen of screens) {
          if (
            !directlyAffected.includes(screen.name) &&
            !indirect.includes(screen.name) &&
            screen.name.toLowerCase().includes(serviceName)
          ) {
            indirect.push(screen.name);
          }
        }
      }
    }

    return indirect;
  }

  private matchFlowsToChanges(diffFiles: DiffFile[], flows: Flow[], affectedScreens: string[]): AffectedFlow[] {
    const affectedFlows: AffectedFlow[] = [];

    for (const flow of flows) {
      const impactedScreens = flow.screens.filter((s) =>
        affectedScreens.some((as) => as.toLowerCase() === s.toLowerCase()),
      );

      if (impactedScreens.length > 0) {
        const isDirect = this.isDirectImpact(diffFiles, flow);
        affectedFlows.push({
          flow: { ...flow, affectedByPr: true },
          impactedScreens,
          changeType: isDirect ? 'direct' : 'indirect',
          reason: isDirect
            ? `Changed files directly modify ${impactedScreens.join(', ')}`
            : `Shared dependency changes may affect ${impactedScreens.join(', ')}`,
        });
      }
    }

    return affectedFlows;
  }

  private isDirectImpact(diffFiles: DiffFile[], flow: Flow): boolean {
    for (const screen of flow.screens) {
      for (const diff of diffFiles) {
        if (diff.path.toLowerCase().includes(screen.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  private calculateRiskLevel(
    affectedFlows: AffectedFlow[],
    diffFiles: DiffFile[],
  ): 'critical' | 'high' | 'medium' | 'low' {
    let score = 0;

    // High change volume
    const totalChanges = diffFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
    if (totalChanges > 500) score += 30;
    else if (totalChanges > 200) score += 20;
    else if (totalChanges > 50) score += 10;

    // Critical flows affected
    const criticalFlows = affectedFlows.filter((f) => f.flow.priority === 'critical');
    score += criticalFlows.length * 25;

    // High-priority flows
    const highFlows = affectedFlows.filter((f) => f.flow.priority === 'high');
    score += highFlows.length * 15;

    // Direct impacts are riskier
    const directImpacts = affectedFlows.filter((f) => f.changeType === 'direct');
    score += directImpacts.length * 10;

    // Deletions are riskier than additions
    const deletionHeavy = diffFiles.some((f) => f.deletions > f.additions * 2);
    if (deletionHeavy) score += 15;

    if (score >= 60) return 'critical';
    if (score >= 35) return 'high';
    if (score >= 15) return 'medium';
    return 'low';
  }

  private buildSummary(affectedFlows: AffectedFlow[], affectedScreens: string[], diffFiles: DiffFile[]): string {
    const parts: string[] = [];
    parts.push(`${diffFiles.length} files changed`);
    parts.push(`${affectedScreens.length} screens affected`);
    parts.push(`${affectedFlows.length} flows impacted`);

    const critical = affectedFlows.filter((f) => f.flow.priority === 'critical');
    if (critical.length > 0) {
      parts.push(`CRITICAL: ${critical.map((f) => f.flow.name).join(', ')}`);
    }

    return parts.join('. ');
  }

  private extractBaseName(filePath: string): string {
    const segments = filePath.replace(/\\/g, '/').split('/');
    const fileName = segments[segments.length - 1] || '';
    return fileName.replace(/\.\w+$/, '');
  }

  private emptyResult(): ImpactResult {
    return {
      affectedFlows: [],
      affectedScreens: [],
      riskLevel: 'low',
      summary: 'No changes to analyze',
      totalFilesChanged: 0,
      impactPercentage: 0,
    };
  }
}

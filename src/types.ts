export interface ModuleStatus {
  name: string;
  status: 'success' | 'error' | 'warning' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface PipelineContext {
  prNumber: number;
  repoOwner: string;
  repoName: string;
  branch: string;
  targetPath: string;
  mobilePath?: string;
  diffFiles: DiffFile[];
  codeAnalysis?: CodeAnalysis;
  scenariosBdd?: BddScenario[];
  testResults?: TestResult[];
  logs: string[];
  appBuild?: AppBuildResult;
  moduleStatuses: ModuleStatus[];
}

export interface AppBuildResult {
  androidAppUrl?: string;
  iosAppUrl?: string;
  androidCustomId?: string;
  iosCustomId?: string;
  buildTimestamp: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  patch: string;
}

export interface CodeAnalysis {
  framework: 'react-native' | 'flutter' | 'swift' | 'kotlin' | 'native';
  screens: Screen[];
  apiEndpoints: ApiEndpoint[];
  industry: string;
  criticalFlows: Flow[];
}

export interface Screen {
  name: string;
  path: string;
  type: 'activity' | 'fragment' | 'viewcontroller' | 'screen' | 'composable' | 'swiftui-view';
  elements: Element[];
}

export interface Element {
  id: string;
  type: string;
  text?: string;
  accessibilityId?: string;
  resourceId?: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  description?: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
}

export interface Flow {
  name: string;
  screens: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  affectedByPr: boolean;
}

export interface BddScenario {
  feature: string;
  scenario: string;
  steps: GherkinStep[];
}

export interface GherkinStep {
  keyword: 'Given' | 'When' | 'Then' | 'And' | 'But';
  text: string;
}

export interface TestResult {
  scenario: string;
  status: 'pass' | 'fail' | 'warn';
  device: string;
  sessionId?: string;
  duration: number;
  screenshot?: string;
  videoUrl?: string;
  error?: string;
}

export interface ModuleResult {
  moduleName: string;
  status: 'success' | 'error' | 'warning';
  data?: unknown;
  error?: string;
}

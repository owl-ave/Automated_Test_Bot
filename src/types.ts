export interface ModuleStatus {
  name: string;
  status: 'success' | 'error' | 'warning' | 'skipped';
  durationMs: number;
  error?: string;
}

export type AuthType = 'email_password' | 'phone_otp' | 'username_password' | 'guest' | 'none';

export interface AuthConfig {
  type: AuthType;
  email?: string;
  password?: string;
  phone?: string;
  username?: string;
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
  maestroFlows?: MaestroFlow[];
  testResults?: TestResult[];
  logs: string[];
  appBuild?: AppBuildResult;
  authConfig?: AuthConfig;
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
  minIosVersion?: string;
  minAndroidVersion?: string;
  launchState?: LaunchState;
}

// Snapshot of the target app's cold-launch behaviour, used by ScenarioBrain
// to decide whether generated flows must include an auth prefix and which
// screens are reachable without credentials.
export interface LaunchState {
  initialScreen: string;          // First screen shown on cold launch
  requiresAuth: boolean;          // Whether auth is mandatory before reaching app content
  authScreens: string[];          // Pre-auth screens (Login, Signup, Onboarding, etc.)
  postAuthEntry?: string;         // First screen reached after successful authentication
  authMechanism?: 'email_password' | 'phone_otp' | 'username_password' | 'biometric' | 'wallet' | 'oauth' | 'unknown';
  source: 'ai' | 'heuristic';     // How the state was determined (for debugging / confidence)
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

export type MaestroValidationSeverity = 'error' | 'warn';

export interface MaestroValidationIssue {
  severity: MaestroValidationSeverity;
  check: string;
  message: string;
}

export interface MaestroFlow {
  feature: string;
  scenario: string;
  appId: string;
  fileName: string;
  yaml: string;
  issues: MaestroValidationIssue[];
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
  status: 'success' | 'error' | 'warning' | 'skipped';
  data?: unknown;
  error?: string;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

// Sizes the BrowserStack Maestro poll deadline based on flow count + a fixed
// device-acquisition buffer. Hardcoded 12-min timeout was too short for any
// non-trivial flow count and led to retry-orphan loops; this scales linearly.
export interface MaestroPollConfig {
  minTimeoutMs: number;
  perFlowBudgetMs: number;
  deviceAcquisitionBufferMs: number;
  intervalMs: number;
  progressLogIntervalMs: number;
}

export interface Thresholds {
  // Performance thresholds
  appLaunchTimeMs: {
    cold: number;
    warm: number;
  };
  screenLoadTimeMs: number;
  fpsMinimum: number;
  memoryMbLimit: number;
  appSizeMbLimit: number;
  appSizeMbIncreaseLimit: number;

  // Test execution thresholds
  maxTestDurationSec: number;
  minPassRatePercent: number;

  // Accessibility
  minColorContrast: number;
  minTouchTargetDp: number;

  // Coverage
  minCodeCoveragePercent: number;
  minDeltaCoveragePercent: number;

  // Retry configuration
  retry: RetryConfig;

  // BrowserStack Maestro poll configuration
  maestroPoll: MaestroPollConfig;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  // Performance thresholds
  appLaunchTimeMs: {
    cold: 3000, // 3 seconds
    warm: 1000, // 1 second
  },
  screenLoadTimeMs: 2000, // 2 seconds
  fpsMinimum: 55, // 55 FPS is acceptable (60 is ideal)
  memoryMbLimit: 150, // 150 MB RAM usage
  appSizeMbLimit: 100, // 100 MB APK/IPA size
  appSizeMbIncreaseLimit: 5, // Max 5 MB increase per PR

  // Test execution thresholds
  maxTestDurationSec: 300, // 5 minutes per test
  minPassRatePercent: 90, // At least 90% tests should pass

  // Accessibility
  minColorContrast: 4.5, // WCAG AA for normal text
  minTouchTargetDp: 48, // 48 DP minimum touch target

  // Coverage
  minCodeCoveragePercent: 60, // Overall 60% coverage
  minDeltaCoveragePercent: 80, // 80% of changed lines covered

  // Retry
  retry: {
    maxRetries: 3,
    initialDelayMs: 2000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
  },

  // BrowserStack Maestro poll deadlines.
  // Effective timeout = max(minTimeoutMs, flows * perFlowBudgetMs) + deviceAcquisitionBufferMs.
  // For 28 flows: max(20m, 56m) + 5m = 61 min. Single device runs flows serially.
  maestroPoll: {
    minTimeoutMs: 20 * 60_000,
    perFlowBudgetMs: 120_000,
    deviceAcquisitionBufferMs: 5 * 60_000,
    intervalMs: 5_000,
    progressLogIntervalMs: 60_000,
  },
};

export function getThresholds(): Thresholds {
  return {
    appLaunchTimeMs: {
      cold: parseInt(process.env.THRESHOLD_LAUNCH_COLD_MS || '3000', 10),
      warm: parseInt(process.env.THRESHOLD_LAUNCH_WARM_MS || '1000', 10),
    },
    screenLoadTimeMs: parseInt(process.env.THRESHOLD_SCREEN_LOAD_MS || '2000', 10),
    fpsMinimum: parseInt(process.env.THRESHOLD_FPS_MIN || '55', 10),
    memoryMbLimit: parseInt(process.env.THRESHOLD_MEMORY_MB || '150', 10),
    appSizeMbLimit: parseInt(process.env.THRESHOLD_APP_SIZE_MB || '100', 10),
    appSizeMbIncreaseLimit: parseInt(process.env.THRESHOLD_APP_SIZE_INCREASE_MB || '5', 10),
    maxTestDurationSec: parseInt(process.env.THRESHOLD_TEST_DURATION_SEC || '300', 10),
    minPassRatePercent: parseInt(process.env.THRESHOLD_MIN_PASS_RATE || '90', 10),
    minColorContrast: parseFloat(process.env.THRESHOLD_COLOR_CONTRAST || '4.5'),
    minTouchTargetDp: parseInt(process.env.THRESHOLD_TOUCH_TARGET_DP || '48', 10),
    minCodeCoveragePercent: parseInt(process.env.THRESHOLD_CODE_COVERAGE || '60', 10),
    minDeltaCoveragePercent: parseInt(process.env.THRESHOLD_DELTA_COVERAGE || '80', 10),
    retry: {
      maxRetries: parseInt(process.env.RETRY_MAX_RETRIES || '3', 10),
      initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '2000', 10),
      backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
      maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10),
    },
    maestroPoll: {
      minTimeoutMs: parseInt(process.env.MAESTRO_POLL_MIN_TIMEOUT_MS || String(20 * 60_000), 10),
      perFlowBudgetMs: parseInt(process.env.MAESTRO_POLL_PER_FLOW_BUDGET_MS || '120000', 10),
      deviceAcquisitionBufferMs: parseInt(process.env.MAESTRO_POLL_DEVICE_BUFFER_MS || String(5 * 60_000), 10),
      intervalMs: parseInt(process.env.MAESTRO_POLL_INTERVAL_MS || '5000', 10),
      progressLogIntervalMs: parseInt(process.env.MAESTRO_POLL_PROGRESS_LOG_INTERVAL_MS || '60000', 10),
    },
  };
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import archiver from 'archiver';
import FormData from 'form-data';
import { Device } from '../../config/devices';
import { MaestroFlow, TestResult } from '../../types';
import { Logger } from '../../utils/logger';
import { getBrowserStackConfig } from '../../config/browserstack';
import { getThresholds, MaestroPollConfig } from '../../config/thresholds';

// REST endpoints for BrowserStack's Maestro v2 API. Confirmed from:
//   https://www.browserstack.com/docs/app-automate/api-reference/maestro/apps
//   https://www.browserstack.com/docs/app-automate/api-reference/maestro/tests
//   https://www.browserstack.com/docs/app-automate/api-reference/maestro/builds
const BASE = 'https://api-cloud.browserstack.com/app-automate/maestro/v2';
const TEST_SUITE_UPLOAD_URL = `${BASE}/test-suite`;
const ANDROID_BUILD_URL = `${BASE}/android/build`;
const IOS_BUILD_URL = `${BASE}/ios/build`;
const buildStatusUrl = (buildId: string) => `${BASE}/builds/${buildId}`;
const sessionDetailsUrl = (buildId: string, sessionId: string) => `${BASE}/builds/${buildId}/sessions/${sessionId}`;

const logger = new Logger('MaestroRunner');

// Thrown by pollBuildUntilDone when a build doesn't reach a terminal state in time.
// runWithRetry checks for this class and skips retry — re-triggering would orphan
// the in-flight build on BrowserStack and burn quota without producing results.
export class MaestroBuildTimeoutError extends Error {
  constructor(public readonly buildId: string, public readonly elapsedMs: number) {
    super(`Maestro build ${buildId} did not finish within ${Math.round(elapsedMs / 1000)}s`);
    this.name = 'MaestroBuildTimeoutError';
  }
}

// flows: drives the dynamic poll deadline (per-flow budget + minimum + acquisition buffer)
export function computePollTimeoutMs(flowCount: number, cfg: MaestroPollConfig): number {
  return Math.max(cfg.minTimeoutMs, flowCount * cfg.perFlowBudgetMs) + cfg.deviceAcquisitionBufferMs;
}

export interface RunMaestroOptions {
  androidAppUrl?: string;
  iosAppUrl?: string;
  flows: MaestroFlow[];
  androidDevices: Device[];
  iosDevices: Device[];
  project?: string;
  buildName?: string;
}

export async function runMaestro(opts: RunMaestroOptions): Promise<TestResult[]> {
  if (opts.flows.length === 0) {
    logger.warn('No flows to run — skipping Maestro execution');
    return [];
  }

  const cfg = getBrowserStackConfig();
  const auth = { username: cfg.username, password: cfg.accessKey };

  const zipPath = await buildFlowsZip(opts.flows);
  try {
    const testSuiteUrl = await uploadTestSuite(zipPath, auth);
    logger.log('Test suite uploaded', { testSuiteUrl });

    // Fire Android + iOS builds in parallel — wall-clock = max(android, ios)
    const pollCfg = getThresholds().maestroPoll;
    const platformRuns: Promise<TestResult[]>[] = [];
    if (opts.androidAppUrl && opts.androidDevices.length > 0) {
      platformRuns.push(
        runPlatform({
          buildUrl: ANDROID_BUILD_URL,
          appUrl: opts.androidAppUrl,
          testSuiteUrl,
          devices: opts.androidDevices,
          flowCount: opts.flows.length,
          pollCfg,
          project: opts.project,
          buildName: opts.buildName,
          auth,
        }),
      );
    }
    if (opts.iosAppUrl && opts.iosDevices.length > 0) {
      platformRuns.push(
        runPlatform({
          buildUrl: IOS_BUILD_URL,
          appUrl: opts.iosAppUrl,
          testSuiteUrl,
          devices: opts.iosDevices,
          flowCount: opts.flows.length,
          pollCfg,
          project: opts.project,
          buildName: opts.buildName,
          auth,
        }),
      );
    }

    const results = (await Promise.all(platformRuns)).flat();
    return results;
  } finally {
    fs.promises.unlink(zipPath).catch(() => undefined);
  }
}

interface RunPlatformInput {
  buildUrl: string;
  appUrl: string;
  testSuiteUrl: string;
  devices: Device[];
  flowCount: number;
  pollCfg: MaestroPollConfig;
  project?: string;
  buildName?: string;
  auth: { username: string; password: string };
}

async function runPlatform(input: RunPlatformInput): Promise<TestResult[]> {
  const platform = input.buildUrl.includes('android') ? 'Android' : 'iOS';
  // Maestro on BS expects device strings of the form "Device Name-OS Version"
  // e.g. "iPhone 15 Pro-17.0", "Google Pixel 8-14".
  const deviceStrings = input.devices.map((d) => `${d.browserstack_device_name ?? d.device}-${d.os_version}`);

  const body: Record<string, unknown> = {
    app: input.appUrl,
    testSuite: input.testSuiteUrl,
    devices: deviceStrings,
  };
  if (input.project) body.project = input.project;
  if (input.buildName) body.buildName = input.buildName;

  const timeoutMs = computePollTimeoutMs(input.flowCount, input.pollCfg);
  logger.log(`${platform} build: triggering`, {
    devices: deviceStrings,
    flowCount: input.flowCount,
    timeoutSec: Math.round(timeoutMs / 1000),
  });
  const buildId = await triggerBuild(input.buildUrl, body, input.auth);
  logger.log(`${platform} build: triggered`, { buildId });

  const final = await pollBuildUntilDone(buildId, input.auth, timeoutMs, input.pollCfg, platform);
  logger.log(`${platform} build: done`, { buildId, status: final.status });

  return mapBuildToResults(buildId, final, input.auth, input.devices);
}

async function triggerBuild(
  url: string,
  body: Record<string, unknown>,
  auth: { username: string; password: string },
): Promise<string> {
  const res = await axios.post(url, body, { auth, headers: { 'Content-Type': 'application/json' }, timeout: 60_000 });
  const buildId = (res.data?.build_id || res.data?.buildId) as string | undefined;
  if (!buildId) throw new Error(`Maestro build trigger returned no build_id: ${JSON.stringify(res.data).slice(0, 300)}`);
  return buildId;
}

async function pollBuildUntilDone(
  buildId: string,
  auth: { username: string; password: string },
  timeoutMs: number,
  cfg: MaestroPollConfig,
  platform: string,
): Promise<MaestroBuildResponse> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let lastProgressLogAt = startedAt;
  let lastStatus = '';

  // BS Maestro v2 reports `skipped` when no test cases ran (e.g. malformed
  // YAML rejected by Maestro's parser, or no available device). It's terminal
  // — the build is over — but easy to miss because the name implies "in
  // progress". Run #70 lost 36 minutes polling 3 already-skipped builds.
  const TERMINAL = new Set(['done', 'passed', 'failed', 'error', 'timeout', 'skipped']);
  while (Date.now() < deadline) {
    const res = await axios.get(buildStatusUrl(buildId), { auth, timeout: 30_000 });
    const data = res.data as MaestroBuildResponse;
    const status = (data.status || '').toLowerCase();
    if (TERMINAL.has(status)) {
      return data;
    }
    lastStatus = status;
    const now = Date.now();
    if (now - lastProgressLogAt >= cfg.progressLogIntervalMs) {
      logger.log(`${platform} build: polling`, {
        buildId,
        status: status || 'unknown',
        elapsedSec: Math.round((now - startedAt) / 1000),
        timeoutSec: Math.round(timeoutMs / 1000),
      });
      lastProgressLogAt = now;
    }
    await sleep(cfg.intervalMs);
  }

  const elapsedMs = Date.now() - startedAt;
  logger.error(`${platform} build: timed out`, {
    buildId,
    elapsedSec: Math.round(elapsedMs / 1000),
    lastStatus: lastStatus || 'unknown',
  });
  await cancelBuildBestEffort(buildId, auth);
  throw new MaestroBuildTimeoutError(buildId, elapsedMs);
}

// BrowserStack Maestro v2 supports DELETE on the build endpoint to abort an
// in-flight run. Best-effort: we still abandon if the cancel call fails. The
// buildId is logged either way so a human can clean up via the BS dashboard.
async function cancelBuildBestEffort(
  buildId: string,
  auth: { username: string; password: string },
): Promise<void> {
  try {
    await axios.delete(buildStatusUrl(buildId), { auth, timeout: 10_000 });
    logger.log('Maestro build cancelled', { buildId });
  } catch (err) {
    logger.warn('Build cancellation failed; investigate manually on BS dashboard', {
      buildId,
      error: String(err),
    });
  }
}

export async function mapBuildToResults(
  buildId: string,
  build: MaestroBuildResponse,
  auth: { username: string; password: string },
  inputDevices: Device[],
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const device of build.devices ?? []) {
    const matchingDevice = inputDevices.find((d) => `${d.browserstack_device_name ?? d.device}-${d.os_version}` === device.device);
    const deviceLabel = matchingDevice?.name ?? device.device ?? 'unknown';
    for (const session of device.sessions ?? []) {
      const sessionDetails = await axios
        .get(sessionDetailsUrl(buildId, session.id), { auth, timeout: 30_000 })
        .then((r) => r.data as MaestroSessionDetails)
        .catch((err) => {
          logger.warn('Failed to fetch session details', { sessionId: session.id, error: String(err) });
          return null;
        });

      // When a session is `skipped` (parse failure, no device, etc.) there are
      // zero testcases — the real reason lives at session.error. Fall back to
      // it before the per-testcase error so users see "No Tests Ran: parse
      // error" instead of an empty error field.
      const sessionError =
        session.error?.short_error_message ||
        session.error?.message ||
        sessionDetails?.error?.short_error_message ||
        sessionDetails?.error?.message;
      const sessionVideoUrl = sessionDetails?.video_url || undefined;

      const flatTcs = flattenTestcases(sessionDetails?.testcases) ?? flattenTestcases(session.testcases) ?? [];

      if (flatTcs.length === 0) {
        // No per-testcase data — emit one session-level result so the run is
        // still represented in the report (skipped builds, parse errors, etc.).
        results.push({
          scenario: device.device ?? 'flow',
          status: mapStatus(session.status || sessionDetails?.status),
          device: deviceLabel,
          sessionId: session.id,
          duration: typeof session.duration === 'number' ? session.duration * 1000 : 0,
          videoUrl: sessionVideoUrl,
          error: sessionError,
        });
        continue;
      }

      // Per-testcase results: each Maestro flow becomes its own TestResult so
      // the PR comment can link the flow's video and error individually.
      for (const tc of flatTcs) {
        results.push({
          scenario: tc.name || device.device || 'flow',
          status: mapStatus(tc.status),
          device: deviceLabel,
          sessionId: session.id,
          duration: typeof tc.duration === 'number' ? Math.round(tc.duration * 1000) : 0,
          videoUrl: tc.video || sessionVideoUrl,
          error: tc.error || (mapStatus(tc.status) !== 'pass' ? sessionError : undefined),
        });
      }
    }
  }
  return results;
}

interface FlatTestcase {
  name?: string;
  status?: string;
  error?: string;
  video?: string;
  duration?: number;
}

// BrowserStack's Maestro v2 session-details endpoint returns `testcases` in
// two observed shapes:
//   1. Flat array of testcase objects (older / simpler responses).
//   2. Aggregated object: `{ count, status, data: [{ class, testcases: [...] }] }`
// where each leaf testcase carries a `video` field (NOT `video_url`).
// flattenTestcases normalises both into a flat list. Returns `null` when the
// shape is unrecognised or empty so the caller can fall back to session-level
// data instead of producing zero results.
export function flattenTestcases(raw: unknown): FlatTestcase[] | null {
  if (Array.isArray(raw)) {
    return raw
      .filter((tc): tc is Record<string, unknown> => Boolean(tc) && typeof tc === 'object')
      .map((tc) => ({
        name: typeof tc.name === 'string' ? tc.name : undefined,
        status: typeof tc.status === 'string' ? tc.status : undefined,
        error: typeof tc.error === 'string' ? tc.error : undefined,
        video: typeof tc.video === 'string' ? tc.video : typeof tc.video_url === 'string' ? tc.video_url : undefined,
        duration: typeof tc.duration === 'number' ? tc.duration : undefined,
      }));
  }
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as { data?: unknown };
  if (!Array.isArray(obj.data)) return null;
  const flat: FlatTestcase[] = [];
  for (const cls of obj.data) {
    if (!cls || typeof cls !== 'object') continue;
    const inner = (cls as { testcases?: unknown }).testcases;
    if (!Array.isArray(inner)) continue;
    for (const tc of inner) {
      if (!tc || typeof tc !== 'object') continue;
      const t = tc as Record<string, unknown>;
      flat.push({
        name: typeof t.name === 'string' ? t.name : undefined,
        status: typeof t.status === 'string' ? t.status : undefined,
        error: typeof t.error === 'string' ? t.error : undefined,
        video: typeof t.video === 'string' ? t.video : typeof t.video_url === 'string' ? t.video_url : undefined,
        duration: typeof t.duration === 'number' ? t.duration : undefined,
      });
    }
  }
  return flat;
}

async function uploadTestSuite(zipPath: string, auth: { username: string; password: string }): Promise<string> {
  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath));
  const res = await axios.post(TEST_SUITE_UPLOAD_URL, form, {
    auth,
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 5 * 60_000,
  });
  const url = (res.data?.test_suite_url || res.data?.testSuiteUrl) as string | undefined;
  if (!url) throw new Error(`Test suite upload returned no test_suite_url: ${JSON.stringify(res.data).slice(0, 300)}`);
  return url;
}

// Maestro on BS expects a zip whose root contains a SINGLE parent folder.
// Inside that folder, root-level .yaml files are the runnable flows. We don't
// emit subfolders because every flow we generate is independent.
async function buildFlowsZip(flows: MaestroFlow[]): Promise<string> {
  const tmp = path.join(os.tmpdir(), `maestro-flows-${Date.now()}.zip`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tmp);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const flow of flows) {
      archive.append(flow.yaml, { name: `flows/${flow.fileName}` });
    }
    archive.finalize();
  });
  return tmp;
}

function mapStatus(s: string | undefined): TestResult['status'] {
  if (!s) return 'fail';
  const v = s.toLowerCase();
  if (v === 'passed' || v === 'pass' || v === 'success' || v === 'done') return 'pass';
  // `skipped` here means BS terminated the session before any test case ran
  // (parse failure, suite rejected, no device, etc.). That's a hard fail from
  // the bot's perspective — we got zero signal — not a warning.
  if (v === 'failed' || v === 'fail' || v === 'error' || v === 'timeout' || v === 'skipped') return 'fail';
  return 'warn';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MaestroSessionError {
  message?: string;
  code?: string | null;
  short_error_message?: string;
}

interface MaestroBuildResponse {
  status?: string;
  duration?: number;
  devices?: Array<{
    device?: string;
    sessions?: Array<{
      id: string;
      status?: string;
      start_time?: string;
      duration?: number;
      error?: MaestroSessionError;
      // BrowserStack occasionally returns a non-array shape (object map / null)
      // here for failed or skipped sessions. Widen the type so consumers must
      // narrow with Array.isArray before iterating.
      testcases?: Array<{ name?: string; status?: string; error?: string }> | Record<string, unknown> | null;
    }>;
  }>;
}

interface MaestroSessionDetails {
  status?: string;
  video_url?: string;
  error?: MaestroSessionError;
  testcases?: Array<{
    name?: string;
    status?: string;
    error?: string;
    video_url?: string;
  }> | Record<string, unknown> | null;
}

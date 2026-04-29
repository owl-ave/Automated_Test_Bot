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

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 12 * 60_000; // 12 min hard cap — well over the 2-3 min target

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
    const platformRuns: Promise<TestResult[]>[] = [];
    if (opts.androidAppUrl && opts.androidDevices.length > 0) {
      platformRuns.push(
        runPlatform({
          buildUrl: ANDROID_BUILD_URL,
          appUrl: opts.androidAppUrl,
          testSuiteUrl,
          devices: opts.androidDevices,
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

  logger.log(`${platform} build: triggering`, { devices: deviceStrings });
  const buildId = await triggerBuild(input.buildUrl, body, input.auth);
  logger.log(`${platform} build: triggered`, { buildId });

  const final = await pollBuildUntilDone(buildId, input.auth);
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
): Promise<MaestroBuildResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await axios.get(buildStatusUrl(buildId), { auth, timeout: 30_000 });
    const data = res.data as MaestroBuildResponse;
    const status = (data.status || '').toLowerCase();
    if (status === 'done' || status === 'passed' || status === 'failed' || status === 'error' || status === 'timeout') {
      return data;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Maestro build ${buildId} did not finish within ${POLL_TIMEOUT_MS / 1000}s`);
}

async function mapBuildToResults(
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
      const status = mapStatus(session.status || sessionDetails?.status);
      const videoUrl = sessionDetails?.video_url ?? sessionDetails?.testcases?.find((tc) => tc.video_url)?.video_url;
      const errorMessage = sessionDetails?.testcases?.find((tc) => tc.status && tc.status.toLowerCase() !== 'passed')?.error;
      results.push({
        scenario: session.testcases?.[0]?.name ?? device.device ?? 'flow',
        status,
        device: deviceLabel,
        sessionId: session.id,
        duration: typeof session.duration === 'number' ? session.duration * 1000 : 0,
        videoUrl,
        error: errorMessage,
      });
    }
  }
  return results;
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
  if (v === 'failed' || v === 'fail' || v === 'error' || v === 'timeout') return 'fail';
  return 'warn';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      testcases?: Array<{ name?: string; status?: string; error?: string }>;
    }>;
  }>;
}

interface MaestroSessionDetails {
  status?: string;
  video_url?: string;
  testcases?: Array<{
    name?: string;
    status?: string;
    error?: string;
    video_url?: string;
  }>;
}

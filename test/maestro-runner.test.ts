import { computePollTimeoutMs, MaestroBuildTimeoutError, mapBuildToResults, flattenTestcases, extractErrorString, fetchCommandLogsError } from '../src/modules/browserstack/maestro-runner';
import { MaestroPollConfig } from '../src/config/thresholds';
import { Device } from '../src/config/devices';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseCfg: MaestroPollConfig = {
  minTimeoutMs: 20 * 60_000,
  perFlowBudgetMs: 120_000,
  deviceAcquisitionBufferMs: 5 * 60_000,
  intervalMs: 5_000,
  progressLogIntervalMs: 60_000,
};

describe('computePollTimeoutMs', () => {
  it('uses the floor for very small flow counts', () => {
    // 1 flow * 2 min = 2 min, well under 20-min floor → falls back to floor + buffer
    expect(computePollTimeoutMs(1, baseCfg)).toBe(20 * 60_000 + 5 * 60_000);
    expect(computePollTimeoutMs(5, baseCfg)).toBe(20 * 60_000 + 5 * 60_000);
  });

  it('scales with flow count once past the floor', () => {
    // 28 flows × 2 min = 56 min (exceeds 20 min floor) → 56 + 5 = 61 min
    expect(computePollTimeoutMs(28, baseCfg)).toBe(56 * 60_000 + 5 * 60_000);
    // 50 flows × 2 min = 100 min → 100 + 5 = 105 min
    expect(computePollTimeoutMs(50, baseCfg)).toBe(100 * 60_000 + 5 * 60_000);
  });

  it('always adds the device acquisition buffer', () => {
    const cfg = { ...baseCfg, deviceAcquisitionBufferMs: 7 * 60_000 };
    expect(computePollTimeoutMs(1, cfg)).toBe(20 * 60_000 + 7 * 60_000);
    expect(computePollTimeoutMs(30, cfg)).toBe(60 * 60_000 + 7 * 60_000);
  });
});

describe('MaestroBuildTimeoutError', () => {
  it('preserves buildId and elapsedMs for diagnostics', () => {
    const err = new MaestroBuildTimeoutError('abc123', 65_000);
    expect(err.buildId).toBe('abc123');
    expect(err.elapsedMs).toBe(65_000);
    expect(err.name).toBe('MaestroBuildTimeoutError');
    expect(err.message).toContain('abc123');
    expect(err.message).toContain('65s');
  });

  it('is recognizable as an Error and via instanceof', () => {
    const err = new MaestroBuildTimeoutError('x', 1000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MaestroBuildTimeoutError);
  });
});

describe('mapBuildToResults — defensive testcases handling', () => {
  const auth = { username: 'u', password: 'p' };
  const devices: Device[] = [
    { name: 'iPhone 17 Pro', platform: 'iOS', os_version: '26.2', device: 'iPhone 17 Pro', browserstack_device_name: 'iPhone 17 Pro' },
  ];

  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  function makeBuild(sessionTestcases: unknown, sessionError?: { message?: string; short_error_message?: string }) {
    return {
      status: 'failed',
      devices: [
        {
          device: 'iPhone 17 Pro-26.2',
          sessions: [
            {
              id: 'sess-1',
              status: 'failed',
              duration: 12,
              ...(sessionError ? { error: sessionError } : {}),
              testcases: sessionTestcases as never,
            },
          ],
        },
      ],
    };
  }

  it('handles undefined testcases on session details without throwing', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 'failed', error: { short_error_message: 'build failed' } } });
    const results = await mapBuildToResults('build-1', makeBuild(undefined), auth, devices);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
    expect(results[0].videoUrl).toBeUndefined();
    expect(results[0].error).toBe('build failed');
    expect(results[0].scenario).toBe('iPhone 17 Pro-26.2');
  });

  it('handles empty array testcases', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 'failed', testcases: [], error: { message: 'no tests ran' } } });
    const results = await mapBuildToResults('build-2', makeBuild([]), auth, devices);
    expect(results).toHaveLength(1);
    expect(results[0].videoUrl).toBeUndefined();
    expect(results[0].error).toBe('no tests ran');
  });

  it('handles non-array testcases (object map) without throwing — repro of run 25096056221 crash', async () => {
    // BrowserStack returned a non-array for `testcases` on a failed iOS build,
    // and the old code crashed with: "sessionDetails?.testcases?.find is not a function".
    mockedAxios.get.mockResolvedValueOnce({
      data: { status: 'failed', testcases: { foo: 'bar' }, error: { short_error_message: 'parse error' } },
    });
    const results = await mapBuildToResults('build-3', makeBuild({ foo: 'bar' }, { short_error_message: 'parse error' }), auth, devices);
    expect(results).toHaveLength(1);
    expect(results[0].videoUrl).toBeUndefined();
    expect(results[0].error).toBe('parse error');
    expect(results[0].scenario).toBe('iPhone 17 Pro-26.2');
  });

  it('handles null testcases without throwing', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { status: 'failed', testcases: null, error: { message: 'session crashed' } } });
    const results = await mapBuildToResults('build-4', makeBuild(null), auth, devices);
    expect(results).toHaveLength(1);
    expect(results[0].videoUrl).toBeUndefined();
    expect(results[0].error).toBe('session crashed');
  });

  it('still extracts videoUrl and per-testcase error when testcases is a real array', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: [
          { name: 'login flow', status: 'failed', error: 'tap target not found', video_url: 'https://bs.example/video.mp4' },
        ],
      },
    });
    const results = await mapBuildToResults(
      'build-5',
      makeBuild([{ name: 'login flow', status: 'failed' }]),
      auth,
      devices,
    );
    expect(results).toHaveLength(1);
    expect(results[0].videoUrl).toBe('https://bs.example/video.mp4');
    expect(results[0].error).toBe('tap target not found');
    expect(results[0].scenario).toBe('login flow');
  });

  // BrowserStack Maestro v2 returns this nested shape for builds that ran
  // multiple flows. Confirmed against an actual failed run on 2026-04-29.
  it('produces per-flow results with video URLs from BS v2 nested data shape', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: {
          count: 3,
          status: { passed: 1, failed: 2, skipped: 0 },
          data: [
            {
              class: 'sign-in-flow',
              testcases: [
                {
                  name: 'sign-in-flow',
                  status: 'passed',
                  duration: 12.5,
                  video: 'https://api.browserstack.com/.../sign-in/video',
                },
              ],
            },
            {
              class: 'edit-profile-flow',
              testcases: [
                {
                  name: 'edit-profile-flow',
                  status: 'failed',
                  duration: 19.5,
                  video: 'https://api.browserstack.com/.../edit-profile/video',
                  error: 'Element "Profile" not visible',
                },
              ],
            },
            {
              class: 'activity-flow',
              testcases: [
                {
                  name: 'activity-flow',
                  status: 'failed',
                  duration: 8.2,
                  video: 'https://api.browserstack.com/.../activity/video',
                  error: 'Tap target not found',
                },
              ],
            },
          ],
        },
      },
    });
    const results = await mapBuildToResults(
      'build-6',
      makeBuild({ count: 3 }),
      auth,
      devices,
    );
    expect(results).toHaveLength(3);

    const signIn = results.find((r) => r.scenario === 'sign-in-flow')!;
    expect(signIn.status).toBe('pass');
    expect(signIn.videoUrl).toBe('https://api.browserstack.com/.../sign-in/video');
    expect(signIn.duration).toBe(12500);

    const editProfile = results.find((r) => r.scenario === 'edit-profile-flow')!;
    expect(editProfile.status).toBe('fail');
    expect(editProfile.videoUrl).toBe('https://api.browserstack.com/.../edit-profile/video');
    expect(editProfile.error).toBe('Element "Profile" not visible');

    const activity = results.find((r) => r.scenario === 'activity-flow')!;
    expect(activity.status).toBe('fail');
    expect(activity.videoUrl).toBe('https://api.browserstack.com/.../activity/video');
    expect(activity.error).toBe('Tap target not found');
  });

  it('falls back to top-level video_url when per-testcase video is missing', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        video_url: 'https://session-level.video.mp4',
        testcases: {
          data: [
            {
              class: 'flow-without-per-tc-video',
              testcases: [
                { name: 'flow-without-per-tc-video', status: 'failed' },
              ],
            },
          ],
        },
      },
    });
    const results = await mapBuildToResults(
      'build-7',
      makeBuild({ data: [] }),
      auth,
      devices,
    );
    expect(results).toHaveLength(1);
    expect(results[0].videoUrl).toBe('https://session-level.video.mp4');
  });

  it('surfaces nested testcase error objects as readable error strings (run from 2026-04-29 repro)', async () => {
    // Real symptom: 4/4 ios failures showed "Unknown error" because BS returned
    // testcase errors as { short_error_message, message } objects, not strings.
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: {
          data: [
            {
              class: 'waitlist-onboarding',
              testcases: [
                {
                  name: 'waitlist-onboarding-screen-renders-join-entry-points',
                  status: 'failed',
                  duration: 23.0,
                  video: 'https://api.browserstack.com/.../waitlist/video',
                  error: { short_error_message: 'Element "Continue" not visible', message: 'long stack trace...' },
                },
              ],
            },
          ],
        },
      },
    });
    const results = await mapBuildToResults('build-9', makeBuild({ data: [] }), auth, devices);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');
    expect(results[0].error).toBe('Element "Continue" not visible');
  });

  it('uses session-level error as fallback for failed testcases without their own error', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: {
          data: [
            {
              class: 'silent-failure',
              testcases: [{ name: 'silent-failure', status: 'failed' }],
            },
          ],
        },
      },
    });
    const results = await mapBuildToResults(
      'build-8',
      makeBuild({ data: [] }, { short_error_message: 'device disconnected' }),
      auth,
      devices,
    );
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('device disconnected');
  });
});

describe('flattenTestcases', () => {
  it('returns null for null/undefined/non-object input', () => {
    expect(flattenTestcases(null)).toBeNull();
    expect(flattenTestcases(undefined)).toBeNull();
    expect(flattenTestcases('string')).toBeNull();
  });

  it('returns null for an object that has no `data` array', () => {
    expect(flattenTestcases({ count: 5, status: { passed: 5 } })).toBeNull();
    expect(flattenTestcases({ data: 'not-an-array' })).toBeNull();
  });

  it('flattens a flat array, mapping video_url → video', () => {
    const out = flattenTestcases([
      { name: 'a', status: 'passed', video_url: 'http://a' },
      { name: 'b', status: 'failed', video: 'http://b', error: 'oops' },
    ]);
    expect(out).toEqual([
      { name: 'a', status: 'passed', error: undefined, video: 'http://a', duration: undefined },
      { name: 'b', status: 'failed', error: 'oops', video: 'http://b', duration: undefined },
    ]);
  });

  it('flattens BS v2 nested data shape across multiple classes', () => {
    const out = flattenTestcases({
      data: [
        {
          class: 'class-1',
          testcases: [
            { name: 'tc1', status: 'passed', video: 'http://tc1', duration: 1.5 },
            { name: 'tc2', status: 'failed', video: 'http://tc2', error: 'fail msg' },
          ],
        },
        {
          class: 'class-2',
          testcases: [{ name: 'tc3', status: 'passed', video: 'http://tc3' }],
        },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out!.map((t) => t.name)).toEqual(['tc1', 'tc2', 'tc3']);
    expect(out![0].duration).toBe(1.5);
    expect(out![1].error).toBe('fail msg');
    expect(out![2].video).toBe('http://tc3');
  });

  it('skips malformed inner items but keeps valid ones', () => {
    const out = flattenTestcases({
      data: [
        { class: 'good', testcases: [{ name: 'ok', status: 'passed' }] },
        { class: 'broken', testcases: 'not-an-array' },
        null,
        { class: 'mixed', testcases: [null, 'str', { name: 'still-ok', status: 'failed' }] },
      ],
    });
    expect(out!.map((t) => t.name)).toEqual(['ok', 'still-ok']);
  });

  // BS Maestro v2 sometimes returns testcase errors as { short_error_message, message }
  // instead of a plain string — same shape as session.error. Before this fix the
  // typeof === 'string' guard silently dropped them, surfacing as "Unknown error"
  // in the PR comment (run from 2026-04-29 had 4 of 4 failures masked this way).
  it('extracts nested error objects on testcases (flat array shape)', () => {
    const out = flattenTestcases([
      { name: 'a', status: 'failed', error: { short_error_message: 'tap target not found' } },
      { name: 'b', status: 'failed', error: { message: 'element not visible' } },
      { name: 'c', status: 'passed' },
    ]);
    expect(out![0].error).toBe('tap target not found');
    expect(out![1].error).toBe('element not visible');
    expect(out![2].error).toBeUndefined();
  });

  it('extracts nested error objects on testcases (BS v2 nested data shape)', () => {
    const out = flattenTestcases({
      data: [
        {
          class: 'flow',
          testcases: [
            { name: 'flow', status: 'failed', error: { short_error_message: 'gate dismiss failed' } },
          ],
        },
      ],
    });
    expect(out![0].error).toBe('gate dismiss failed');
  });
});

describe('fetchCommandLogsError', () => {
  const auth = { username: 'u', password: 'p' };

  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('returns the first FAILED command\'s error.message — what the BS dashboard shows', async () => {
    // Real shape captured from BS Maestro v2 commandlogs on 2026-04-29
    // (build 4a664b06...). The session-details endpoint returned no inline
    // error; the actionable string lives only in this URL.
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { command: { defineVariablesCommand: {} }, metadata: { description: 'Define variables', status: 'COMPLETED' } },
        { command: { applyConfigurationCommand: {} }, metadata: { description: 'Apply configuration', status: 'COMPLETED' } },
        { command: { launchAppCommand: {} }, metadata: { description: 'Launch app', status: 'COMPLETED' } },
        {
          command: { assertConditionCommand: {} },
          metadata: {
            description: 'Assert that "Join the Waitlist" is visible',
            status: 'FAILED',
            error: { message: 'Assertion is false: "Join the Waitlist" is visible' },
          },
        },
      ],
    });
    const error = await fetchCommandLogsError('https://api.browserstack.com/.../commandlogs', auth);
    expect(error).toBe('Assertion is false: "Join the Waitlist" is visible');
  });

  it('handles error as a plain string (older shape)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        { command: {}, metadata: { description: 'tap', status: 'FAILED', error: 'Tap target not found' } },
      ],
    });
    expect(await fetchCommandLogsError('https://example/cmd', auth)).toBe('Tap target not found');
  });

  it('returns undefined when no FAILED command exists', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [{ metadata: { status: 'COMPLETED' } }, { metadata: { status: 'COMPLETED' } }],
    });
    expect(await fetchCommandLogsError('https://example/cmd', auth)).toBeUndefined();
  });

  it('returns undefined when the FAILED command has no extractable error', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: [{ metadata: { description: 'tap', status: 'FAILED' } }],
    });
    expect(await fetchCommandLogsError('https://example/cmd', auth)).toBeUndefined();
  });

  it('returns undefined on network failure (best-effort, never throws)', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('connection reset'));
    expect(await fetchCommandLogsError('https://example/cmd', auth)).toBeUndefined();
  });

  it('returns undefined on malformed (non-array) response', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { not: 'an array' } });
    expect(await fetchCommandLogsError('https://example/cmd', auth)).toBeUndefined();
  });
});

describe('mapBuildToResults — fetches commandlogs for failed testcases without inline errors', () => {
  const auth = { username: 'u', password: 'p' };
  const devices: Device[] = [
    { name: 'iPhone 17 Pro', platform: 'iOS', os_version: '26.2', device: 'iPhone 17 Pro', browserstack_device_name: 'iPhone 17 Pro' },
  ];

  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it('falls back to commandlogs when the testcase has no inline error (Nola PR#8 repro)', async () => {
    // 1st GET: session details — no inline error fields, but maestro_commands URL present
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: {
          data: [
            {
              class: 'flow',
              testcases: [
                {
                  name: 'flow',
                  status: 'failed',
                  duration: 17.76,
                  video: 'https://video',
                  maestro_commands: 'https://api.browserstack.com/.../tests/abc/commandlogs',
                },
              ],
            },
          ],
        },
      },
    });
    // 2nd GET: commandlogs — has the real error message
    mockedAxios.get.mockResolvedValueOnce({
      data: [
        {
          metadata: {
            description: 'Assert that "Join the Waitlist" is visible',
            status: 'FAILED',
            error: { message: 'Assertion is false: "Join the Waitlist" is visible' },
          },
        },
      ],
    });

    const results = await mapBuildToResults(
      'build-x',
      {
        status: 'failed',
        devices: [
          {
            device: 'iPhone 17 Pro-26.2',
            sessions: [{ id: 'sess-1', status: 'failed', testcases: { data: [] } }],
          },
        ],
      },
      auth,
      devices,
    );

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('Assertion is false: "Join the Waitlist" is visible');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[1][0]).toBe('https://api.browserstack.com/.../tests/abc/commandlogs');
  });

  it('does NOT fetch commandlogs for passing testcases (saves a network call per pass)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'passed',
        testcases: {
          data: [
            {
              class: 'flow',
              testcases: [
                {
                  name: 'flow',
                  status: 'passed',
                  duration: 5,
                  video: 'https://video',
                  maestro_commands: 'https://api.browserstack.com/.../commandlogs',
                },
              ],
            },
          ],
        },
      },
    });

    const results = await mapBuildToResults(
      'build-y',
      {
        status: 'passed',
        devices: [
          {
            device: 'iPhone 17 Pro-26.2',
            sessions: [{ id: 'sess-2', status: 'passed', testcases: { data: [] } }],
          },
        ],
      },
      auth,
      devices,
    );

    expect(results[0].status).toBe('pass');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1); // session details only — no commandlogs fetch
  });

  it('does NOT fetch commandlogs when the testcase already has an inline error', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        status: 'failed',
        testcases: {
          data: [
            {
              class: 'flow',
              testcases: [
                {
                  name: 'flow',
                  status: 'failed',
                  duration: 5,
                  error: 'inline error already present',
                  maestro_commands: 'https://api.browserstack.com/.../commandlogs',
                },
              ],
            },
          ],
        },
      },
    });

    const results = await mapBuildToResults(
      'build-z',
      {
        status: 'failed',
        devices: [
          {
            device: 'iPhone 17 Pro-26.2',
            sessions: [{ id: 'sess-3', status: 'failed', testcases: { data: [] } }],
          },
        ],
      },
      auth,
      devices,
    );

    expect(results[0].error).toBe('inline error already present');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe('extractErrorString', () => {
  it('returns plain string errors as-is', () => {
    expect(extractErrorString('boom')).toBe('boom');
  });

  it('prefers short_error_message over message', () => {
    expect(extractErrorString({ short_error_message: 'short', message: 'long' })).toBe('short');
  });

  it('falls back to message when short_error_message is absent', () => {
    expect(extractErrorString({ message: 'fallback' })).toBe('fallback');
  });

  it('returns undefined for empty/missing/non-string fields', () => {
    expect(extractErrorString(undefined)).toBeUndefined();
    expect(extractErrorString(null)).toBeUndefined();
    expect(extractErrorString('')).toBeUndefined();
    expect(extractErrorString({})).toBeUndefined();
    expect(extractErrorString({ short_error_message: 42 })).toBeUndefined();
  });
});

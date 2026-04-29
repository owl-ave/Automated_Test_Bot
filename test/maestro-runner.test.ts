import { computePollTimeoutMs, MaestroBuildTimeoutError, mapBuildToResults, flattenTestcases } from '../src/modules/browserstack/maestro-runner';
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
});

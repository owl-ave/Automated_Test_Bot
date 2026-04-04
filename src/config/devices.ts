export interface Device {
  name: string;
  platform: 'Android' | 'iOS';
  os_version: string;
  device: string;
  browserstack_device_name?: string;
}

export const DEVICE_MATRIX: Device[] = [
  // Android — flagship
  {
    name: 'Pixel 8',
    platform: 'Android',
    os_version: '14',
    device: 'Google Pixel 8',
    browserstack_device_name: 'Google Pixel 8',
  },
  {
    name: 'Samsung Galaxy S24',
    platform: 'Android',
    os_version: '14',
    device: 'Samsung Galaxy S24',
    browserstack_device_name: 'Samsung Galaxy S24',
  },
  // Android — low-end (performance regression detection)
  {
    name: 'Pixel 4a',
    platform: 'Android',
    os_version: '13',
    device: 'Google Pixel 4a',
    browserstack_device_name: 'Google Pixel 4a',
  },
  // Android — tablet
  {
    name: 'Samsung Galaxy Tab S9',
    platform: 'Android',
    os_version: '14',
    device: 'Samsung Galaxy Tab S9',
    browserstack_device_name: 'Samsung Galaxy Tab S9',
  },

  // iOS — latest (iOS 26)
  {
    name: 'iPhone 17 Pro',
    platform: 'iOS',
    os_version: '26.2',
    device: 'iPhone 17 Pro',
    browserstack_device_name: 'iPhone 17 Pro',
  },
  // iOS — flagship
  {
    name: 'iPhone 16 Pro',
    platform: 'iOS',
    os_version: '26.2',
    device: 'iPhone 16 Pro',
    browserstack_device_name: 'iPhone 16 Pro',
  },
  // iOS — older flagship (backwards compat)
  {
    name: 'iPhone 15 Pro',
    platform: 'iOS',
    os_version: '26.2',
    device: 'iPhone 15 Pro',
    browserstack_device_name: 'iPhone 15 Pro',
  },
  // iOS — tablet
  {
    name: 'iPad Air M3',
    platform: 'iOS',
    os_version: '26.2',
    device: 'iPad Air M3',
    browserstack_device_name: 'iPad Air M3',
  },
];

export const ANDROID_DEVICES = DEVICE_MATRIX.filter((d) => d.platform === 'Android');
export const IOS_DEVICES = DEVICE_MATRIX.filter((d) => d.platform === 'iOS');

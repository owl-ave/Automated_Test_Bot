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

  // iOS — flagship (Dynamic Island)
  {
    name: 'iPhone 15 Pro',
    platform: 'iOS',
    os_version: '17',
    device: 'iPhone 15 Pro',
    browserstack_device_name: 'iPhone 15 Pro',
  },
  // iOS — older device + older OS
  {
    name: 'iPhone 13',
    platform: 'iOS',
    os_version: '16',
    device: 'iPhone 13',
    browserstack_device_name: 'iPhone 13',
  },
  // iOS — small screen (SE form factor)
  {
    name: 'iPhone SE 2022',
    platform: 'iOS',
    os_version: '16',
    device: 'iPhone SE 2022',
    browserstack_device_name: 'iPhone SE 2022',
  },
  // iOS — tablet
  {
    name: 'iPad Air',
    platform: 'iOS',
    os_version: '17',
    device: 'iPad Air',
    browserstack_device_name: 'iPad Air',
  },
];

export const ANDROID_DEVICES = DEVICE_MATRIX.filter((d) => d.platform === 'Android');
export const IOS_DEVICES = DEVICE_MATRIX.filter((d) => d.platform === 'iOS');

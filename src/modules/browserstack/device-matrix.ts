import { Device, DEVICE_MATRIX, ANDROID_DEVICES, IOS_DEVICES } from '../../config/devices';

export { Device, DEVICE_MATRIX, ANDROID_DEVICES, IOS_DEVICES };

export function getDevicesForPlatform(platform: 'android' | 'ios' | 'both'): Device[] {
  switch (platform) {
    case 'android':
      return ANDROID_DEVICES;
    case 'ios':
      return IOS_DEVICES;
    case 'both':
      return DEVICE_MATRIX;
  }
}

export function getMinimalDeviceSet(): Device[] {
  const android = ANDROID_DEVICES[0];
  const ios = IOS_DEVICES[0];
  const result: Device[] = [];
  if (android) result.push(android);
  if (ios) result.push(ios);
  return result;
}

export function getDevicesByCategory(category: 'phone' | 'tablet'): Device[] {
  const tabletKeywords = ['tab', 'ipad'];
  if (category === 'tablet') {
    return DEVICE_MATRIX.filter((d) => tabletKeywords.some((k) => d.name.toLowerCase().includes(k)));
  }
  return DEVICE_MATRIX.filter((d) => !tabletKeywords.some((k) => d.name.toLowerCase().includes(k)));
}

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import * as Application from 'expo-application'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

const REFRESH_KEY = 'cn.refresh'
const DEVICE_KEY = 'cn.device'
const BIOMETRIC_KEY = 'cn.biometric'

function webStore(key: string, value?: string | null): string | null {
  if (Platform.OS !== 'web') return null
  try {
    if (value === undefined) return window.localStorage.getItem(key)
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in private browsing.
  }
  return null
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webStore(key)
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore(key, value)
    return
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webStore(key, null)
    return
  }
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {
    // Nothing to delete.
  }
}

export const getRefreshToken = () => getItem(REFRESH_KEY)
export const setRefreshToken = (token: string) => setItem(REFRESH_KEY, token)
export const clearRefreshToken = () => deleteItem(REFRESH_KEY)

export const getBiometricsEnabled = async (): Promise<boolean> => (await getItem(BIOMETRIC_KEY)) === '1'
export const setBiometricsEnabled = async (enabled: boolean): Promise<void> => {
  if (enabled) await setItem(BIOMETRIC_KEY, '1')
  else await deleteItem(BIOMETRIC_KEY)
}

export type DeviceInfo = {
  deviceId: string
  platform: 'ios' | 'android' | 'web' | 'unknown'
  appVersion: string
  deviceName: string
}

async function createDeviceId(): Promise<string> {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId()
    if (androidId) return `android-${androidId}`
  }
  if (Platform.OS === 'ios') {
    const vendorId = await Application.getIosIdForVendorAsync().catch(() => null)
    if (vendorId) return `ios-${vendorId}`
  }
  return `device-${Crypto.randomUUID()}`
}

let cachedDevice: DeviceInfo | null = null

export async function deviceInfo(): Promise<DeviceInfo> {
  if (cachedDevice) return cachedDevice
  let deviceId = await getItem(DEVICE_KEY)
  if (!deviceId) {
    deviceId = await createDeviceId()
    await setItem(DEVICE_KEY, deviceId)
  }
  const platform: DeviceInfo['platform'] =
    Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : Platform.OS === 'web' ? 'web' : 'unknown'
  cachedDevice = {
    deviceId,
    platform,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0',
    deviceName: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Mobile device',
  }
  return cachedDevice
}

export async function clearDeviceSession(): Promise<void> {
  await clearRefreshToken()
}

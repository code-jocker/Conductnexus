import * as LocalAuthentication from 'expo-local-authentication'

export async function biometricsAvailable(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
    return hardware && enrolled
  } catch {
    return false
  }
}

export async function biometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID'
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Fingerprint'
  } catch {
    // Fall through to the generic label.
  }
  return 'biometrics'
}

export async function unlockWithBiometrics(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock ConductNexus',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
      fallbackLabel: 'Use device passcode',
    })
    return result.success
  } catch {
    return false
  }
}

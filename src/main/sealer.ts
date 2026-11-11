import { safeStorage } from 'electron'
import { createFileSealer, type Sealer, type SecretBox } from '../core/seal'

export function createElectronSealer(keyPath: string): Sealer {
  const file = createFileSealer(keyPath)
  return {
    seal(plain: string): SecretBox {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return {
            scheme: 'safeStorage',
            payload: safeStorage.encryptString(plain).toString('base64')
          }
        }
      } catch {
        // Headless sessions may not have a desktop secret store. Fall through to the local key.
      }
      return file.seal(plain)
    },
    open(box: SecretBox): string {
      if (box.scheme === 'safeStorage') {
        return safeStorage.decryptString(Buffer.from(box.payload, 'base64'))
      }
      return file.open(box)
    }
  }
}

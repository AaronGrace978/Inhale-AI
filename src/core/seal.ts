import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SecretBox {
  scheme: string
  payload: string
}

export interface Sealer {
  seal(plain: string): SecretBox
  open(box: SecretBox): string
}

function masterKey(keyPath: string): Buffer {
  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 })
  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 })
    chmodSync(keyPath, 0o600)
  } else {
    chmodSync(keyPath, 0o600)
  }
  const raw = readFileSync(keyPath)
  if (raw.length < 32) {
    throw new Error('The local seal key is unreadable.')
  }
  return createHash('sha256').update(raw).digest()
}

export function createFileSealer(keyPath: string): Sealer {
  return {
    seal(plain: string): SecretBox {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', masterKey(keyPath), iv)
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return {
        scheme: 'aes-256-gcm',
        payload: `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`
      }
    },
    open(box: SecretBox): string {
      if (box.scheme !== 'aes-256-gcm') throw new Error('Unsupported secret box.')
      const [ivRaw, tagRaw, dataRaw] = box.payload.split('.')
      if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Secret box is damaged.')
      const decipher = createDecipheriv('aes-256-gcm', masterKey(keyPath), Buffer.from(ivRaw, 'base64'))
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64'))
      const plain = Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64')), decipher.final()])
      return plain.toString('utf8')
    }
  }
}

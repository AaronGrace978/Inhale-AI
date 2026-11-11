/// <reference types="vite/client" />

import type { KirbyApi } from '../../shared/types'

declare global {
  interface Window {
    kirby?: KirbyApi
  }
}

export {}

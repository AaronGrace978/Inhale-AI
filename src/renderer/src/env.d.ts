/// <reference types="vite/client" />

import type { InhaleApi } from '../../shared/types'

declare global {
  interface Window {
    inhale?: InhaleApi
  }
}

export {}

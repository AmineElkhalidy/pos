/// <reference types="vite/client" />
import type { SmartPosApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SmartPosApi
  }
}

export {}


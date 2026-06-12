import type { NumberingApi } from './index'

declare global {
  interface Window {
    api: NumberingApi
  }
}

export {}

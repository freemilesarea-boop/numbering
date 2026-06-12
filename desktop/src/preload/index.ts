// preload: renderer에 안전한 IPC API를 contextBridge로 노출한다.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CollectedPlace,
  CollectionStatus,
  ExportFormat,
  LogEntry,
  Progress,
  SaveResult,
  SearchConfig,
  StartResult
} from '../shared/types'

/** 이벤트 구독 헬퍼: 해제 함수를 반환한다. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // 명령
  snapshot: (): Promise<{
    status: CollectionStatus
    places: CollectedPlace[]
    log: LogEntry[]
    config: SearchConfig | null
    progress: Progress
  }> => ipcRenderer.invoke('collection:snapshot'),
  start: (config: SearchConfig, append: boolean): Promise<StartResult> =>
    ipcRenderer.invoke('collection:start', config, append),
  pause: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('collection:pause'),
  resume: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('collection:resume'),
  stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('collection:stop'),
  reset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('collection:reset'),
  save: (format: ExportFormat): Promise<SaveResult> => ipcRenderer.invoke('collection:save', format),

  // 이벤트 구독
  onLog: (cb: (entry: LogEntry) => void) => on<LogEntry>('collection:log', cb),
  onPlace: (cb: (place: CollectedPlace) => void) => on<CollectedPlace>('collection:place', cb),
  onProgress: (cb: (p: Progress) => void) => on<Progress>('collection:progress', cb),
  onStatus: (cb: (s: CollectionStatus) => void) => on<CollectionStatus>('collection:status', cb),
  onCaptcha: (cb: (message: string) => void) => on<string>('collection:captcha', cb),
  onError: (cb: (message: string) => void) => on<string>('collection:error', cb),
  onReset: (cb: () => void) => on<null>('collection:reset', () => cb())
}

export type NumberingApi = typeof api

contextBridge.exposeInMainWorld('api', api)

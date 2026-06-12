// IPC 핸들러 등록. renderer ↔ main 통신 채널 정의.

import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  ExportFormat,
  SaveResult,
  SearchConfig,
  StartResult
} from '../shared/types'
import { CollectionController } from './controller'
import { exportPlaces, suggestFileName } from './export/exporter'

export function registerIpc(controller: CollectionController): void {
  // renderer가 마운트되면서 현재(복구된) 상태를 요청한다.
  ipcMain.handle('collection:snapshot', () => controller.snapshot())

  ipcMain.handle(
    'collection:start',
    async (_e, config: SearchConfig, append: boolean): Promise<StartResult> => {
      const query = [config.location, config.keyword].map((s) => (s || '').trim()).filter(Boolean)
      if (query.length === 0) {
        return { ok: false, error: '기준 위치 또는 업종 키워드를 입력해 주세요.' }
      }
      if (!config.maxResults || config.maxResults < 1) {
        return { ok: false, error: '최대 수집 개수는 1 이상이어야 합니다.' }
      }
      // 백그라운드로 실행(완료를 기다리지 않음). 진행 상황은 이벤트로 전달된다.
      void controller.start(config, append)
      return { ok: true }
    }
  )

  ipcMain.handle('collection:pause', () => {
    controller.pause()
    return { ok: true }
  })

  ipcMain.handle('collection:resume', () => {
    controller.resume()
    return { ok: true }
  })

  ipcMain.handle('collection:stop', () => {
    controller.stop()
    return { ok: true }
  })

  ipcMain.handle('collection:reset', async () => {
    await controller.reset()
    return { ok: true }
  })

  ipcMain.handle(
    'collection:save',
    async (e, format: ExportFormat): Promise<SaveResult> => {
      const places = controller.getPlaces()
      if (places.length === 0) {
        return { ok: false, error: '저장할 수집 결과가 없습니다.' }
      }
      const config = controller.getConfig()
      const suggested = suggestFileName(config?.location ?? '', config?.keyword ?? '', format)

      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '수집 결과 저장',
        defaultPath: suggested,
        filters:
          format === 'csv'
            ? [{ name: 'CSV', extensions: ['csv'] }]
            : [{ name: 'Excel', extensions: ['xlsx'] }]
      })

      if (canceled || !filePath) return { ok: false, canceled: true }

      try {
        await exportPlaces(places, filePath, format)
        return { ok: true, filePath, count: places.length }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )
}

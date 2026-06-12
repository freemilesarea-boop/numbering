// 중간 저장 / 복구용 상태 저장소.
//
// 수집 상태(collected_places + 설정 + 로그)를 userData 폴더의 JSON 파일에
// 영속 저장한다. 프로그램이 중간에 꺼져도 재시작 시 이전 결과를 복구할 수 있다.
// 잦은 쓰기를 막기 위해 디바운스로 저장한다.

import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { CollectionState } from '../../shared/types'

const STATE_FILE = 'collection-state.json'

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILE)
}

function emptyState(): CollectionState {
  return {
    config: null,
    status: 'idle',
    places: [],
    log: [],
    updatedAt: new Date().toISOString()
  }
}

export class StateStore {
  private state: CollectionState = emptyState()
  private saveTimer: NodeJS.Timeout | null = null
  private writing = false
  private dirty = false

  /** 디스크에서 이전 상태를 읽어온다. 없거나 깨졌으면 빈 상태를 반환한다. */
  async load(): Promise<CollectionState> {
    try {
      const raw = await fs.readFile(statePath(), 'utf-8')
      const parsed = JSON.parse(raw) as CollectionState
      this.state = {
        config: parsed.config ?? null,
        status: parsed.status ?? 'idle',
        places: Array.isArray(parsed.places) ? parsed.places : [],
        log: Array.isArray(parsed.log) ? parsed.log : [],
        updatedAt: parsed.updatedAt ?? new Date().toISOString()
      }
    } catch {
      this.state = emptyState()
    }
    return this.state
  }

  get current(): CollectionState {
    return this.state
  }

  /** 부분 업데이트 후 디바운스 저장을 예약한다. */
  update(patch: Partial<CollectionState>): void {
    this.state = { ...this.state, ...patch, updatedAt: new Date().toISOString() }
    this.scheduleSave()
  }

  /** 빈 상태로 초기화하고 즉시 저장한다. */
  async clear(): Promise<void> {
    this.state = emptyState()
    await this.flush()
  }

  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, 500)
  }

  /** 대기 중인 변경을 즉시 디스크에 기록한다. */
  async flush(): Promise<void> {
    if (this.writing) {
      this.dirty = true
      return
    }
    this.writing = true
    this.dirty = false
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await fs.writeFile(statePath(), JSON.stringify(this.state, null, 2), 'utf-8')
    } catch {
      /* 저장 실패는 치명적이지 않으므로 무시 */
    } finally {
      this.writing = false
      if (this.dirty) this.scheduleSave()
    }
  }
}

// 수집 컨트롤러: 수집 흐름 전체를 조율한다.
//
// - NaverMapClient를 구동하고 매장 후보를 받아 중복 제거 후 저장/이벤트 발행
// - 일시정지 / 중단 제어
// - 진행률 / 로그 / 상태 이벤트를 renderer로 전달(IPC)
// - StateStore로 중간 저장(중복 키/결과/상태)하여 재시작 복구 지원

import type { WebContents } from 'electron'
import type {
  CollectedPlace,
  CollectionStatus,
  LogEntry,
  LogLevel,
  SearchConfig
} from '../shared/types'
import { CaptchaError, NaverMapClient, type CollectControl } from './scraper/naverMapClient'
import { dedupeKey } from './scraper/dedupe'
import { StateStore } from './store/stateStore'

const MAX_LOG = 1000

export class CollectionController {
  private readonly store: StateStore
  private sender: WebContents | null = null

  private client: NaverMapClient | null = null
  private status: CollectionStatus = 'idle'
  private places: CollectedPlace[] = []
  private log: LogEntry[] = []
  private seen = new Set<string>()
  private config: SearchConfig | null = null

  private paused = false
  private stopRequested = false

  constructor(store: StateStore) {
    this.store = store
  }

  /** renderer WebContents를 등록하고, 저장된 이전 상태를 메모리로 복구한다. */
  attach(sender: WebContents): void {
    this.sender = sender
    const prev = this.store.current
    this.places = [...prev.places]
    this.log = [...prev.log]
    this.config = prev.config
    this.seen = new Set(this.places.map(dedupeKey))
    // 비정상 종료로 'running'/'paused'로 남아있었다면 idle로 정리한다.
    this.status =
      prev.status === 'running' || prev.status === 'paused' || prev.status === 'stopping'
        ? 'idle'
        : prev.status
  }

  // ---- 이벤트 발행 -------------------------------------------------------

  private send(channel: string, payload: unknown): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send(channel, payload)
    }
  }

  private addLog(message: string, level: LogLevel = 'info'): void {
    const entry: LogEntry = {
      time: new Date().toTimeString().slice(0, 8),
      level,
      message
    }
    this.log.push(entry)
    if (this.log.length > MAX_LOG) this.log = this.log.slice(-MAX_LOG)
    this.send('collection:log', entry)
  }

  private setStatus(status: CollectionStatus): void {
    this.status = status
    this.send('collection:status', status)
    this.persist()
  }

  private emitProgress(): void {
    this.send('collection:progress', {
      collected: this.places.length,
      target: this.config?.maxResults ?? 0
    })
  }

  private persist(): void {
    this.store.update({
      config: this.config,
      status: this.status,
      places: this.places,
      log: this.log
    })
  }

  // ---- 외부 API (IPC 핸들러가 호출) --------------------------------------

  /** renderer 마운트 시 현재(복구된) 상태 스냅샷을 돌려준다. */
  snapshot(): {
    status: CollectionStatus
    places: CollectedPlace[]
    log: LogEntry[]
    config: SearchConfig | null
    progress: { collected: number; target: number }
  } {
    return {
      status: this.status,
      places: this.places,
      log: this.log,
      config: this.config,
      progress: {
        collected: this.places.length,
        target: this.config?.maxResults ?? 0
      }
    }
  }

  isRunning(): boolean {
    return this.status === 'running' || this.status === 'paused' || this.status === 'stopping'
  }

  /** 수집을 시작한다. 이미 진행 중이면 무시한다. */
  async start(config: SearchConfig, append: boolean): Promise<void> {
    if (this.isRunning()) {
      this.addLog('이미 수집이 진행 중입니다.', 'warn')
      return
    }

    this.config = config
    this.paused = false
    this.stopRequested = false

    if (!append) {
      // 새 수집: 이전 결과를 비운다.
      this.places = []
      this.seen.clear()
      this.send('collection:reset', null)
    }

    const keyword = this.buildQuery(config)
    this.addLog('==============================')
    this.addLog(`수집 시작: "${keyword}" (반경 ${config.radius}, 최대 ${config.maxResults}개)`, 'success')
    if (append && this.places.length > 0) {
      this.addLog(`이어서 수집합니다. 기존 ${this.places.length}건에 추가됩니다.`, 'info')
    }
    this.setStatus('running')
    this.emitProgress()

    const control: CollectControl = {
      shouldStop: () => this.stopRequested || this.places.length >= (this.config?.maxResults ?? 0),
      waitIfPaused: () => this.waitIfPaused(),
      log: (message, level) => this.addLog(message, level ?? 'info'),
      emitPlace: (place) => this.acceptPlace(place)
    }

    this.client = new NaverMapClient(config)
    try {
      await this.client.start()
      await this.client.collect(keyword, control)

      if (this.stopRequested) {
        this.addLog('사용자 요청으로 수집을 중단했습니다.', 'warn')
        this.setStatus('stopped')
      } else {
        this.addLog(`수집 완료. 총 ${this.places.length}건 수집되었습니다.`, 'success')
        this.setStatus('done')
      }
    } catch (err) {
      if (err instanceof CaptchaError) {
        this.addLog(`[중단] ${err.message} 잠시 후 다시 시도하거나 브라우저에서 직접 확인해 주세요.`, 'error')
        this.send('collection:captcha', err.message)
        this.setStatus('captcha')
      } else {
        this.addLog(`[오류] 수집 중 예기치 못한 오류: ${(err as Error).message}`, 'error')
        this.setStatus('error')
      }
    } finally {
      try {
        await this.client?.close()
      } catch {
        /* ignore */
      }
      this.client = null
      this.paused = false
      this.stopRequested = false
      this.emitProgress()
      await this.store.flush()
    }
  }

  pause(): void {
    if (this.status !== 'running') return
    this.paused = true
    this.addLog('일시정지되었습니다.', 'warn')
    this.setStatus('paused')
  }

  resume(): void {
    if (this.status !== 'paused') return
    this.paused = false
    this.addLog('수집을 재개합니다.', 'info')
    this.setStatus('running')
  }

  stop(): void {
    if (!this.isRunning()) return
    this.stopRequested = true
    this.paused = false // 일시정지 상태였다면 풀어 루프가 종료되도록 한다.
    this.addLog('중단 요청을 받았습니다. 진행 중인 매장 처리 후 종료합니다.', 'warn')
    this.setStatus('stopping')
  }

  /** 결과/로그/상태를 모두 비운다(수집 중이 아닐 때만). */
  async reset(): Promise<void> {
    if (this.isRunning()) return
    this.places = []
    this.log = []
    this.seen.clear()
    this.config = null
    await this.store.clear()
    this.setStatus('idle')
    this.send('collection:reset', null)
    this.emitProgress()
  }

  getPlaces(): CollectedPlace[] {
    return this.places
  }

  getConfig(): SearchConfig | null {
    return this.config
  }

  // ---- 내부 ---------------------------------------------------------------

  /** 기준 위치 + 업종 키워드로 검색어를 만든다. */
  private buildQuery(config: SearchConfig): string {
    return [config.location, config.keyword].map((s) => s.trim()).filter(Boolean).join(' ')
  }

  private async waitIfPaused(): Promise<void> {
    while (this.paused && !this.stopRequested) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  /**
   * 매장 후보를 중복 검사 후 받아들인다.
   * 신규면 저장/이벤트 발행 후 true, 중복이면 false를 반환한다.
   */
  private acceptPlace(place: CollectedPlace): boolean {
    if (this.places.length >= (this.config?.maxResults ?? 0)) return false
    const key = dedupeKey(place)
    if (this.seen.has(key)) return false
    this.seen.add(key)
    this.places.push(place)

    const phone = place.mobile_phone || place.safe_phone || '(번호없음)'
    this.addLog(`  ✓ [${this.places.length}] ${place.store_name} / ${phone}`, 'success')
    this.send('collection:place', place)
    this.emitProgress()
    this.persist()
    return true
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CollectedPlace,
  CollectionStatus,
  ExportFormat,
  LogEntry,
  Progress,
  SearchConfig
} from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/types'
import SearchPanel from './components/SearchPanel'
import ResultsTable from './components/ResultsTable'
import LogPanel from './components/LogPanel'
import Toolbar from './components/Toolbar'

export default function App(): JSX.Element {
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState<CollectionStatus>('idle')
  const [places, setPlaces] = useState<CollectedPlace[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState<Progress>({ collected: 0, target: 0 })
  const [notice, setNotice] = useState<string | null>(null)

  // place 이벤트가 빠르게 올 수 있어 함수형 업데이트로 누적한다.
  const appendPlace = useCallback((place: CollectedPlace) => {
    setPlaces((prev) => [...prev, place])
  }, [])

  const appendLog = useCallback((entry: LogEntry) => {
    setLog((prev) => {
      const next = [...prev, entry]
      return next.length > 1000 ? next.slice(-1000) : next
    })
  }, [])

  // 최초 마운트: 저장된(복구된) 상태를 불러오고 이벤트를 구독한다.
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    void window.api.snapshot().then((snap) => {
      setStatus(snap.status)
      setPlaces(snap.places)
      setLog(snap.log)
      setProgress(snap.progress)
      if (snap.config) setConfig(snap.config)
      if (snap.places.length > 0) {
        setNotice(
          `↻ 이전 세션에서 중단된 수집 결과 ${snap.places.length}건을 복구했습니다. ` +
            `좌측 "현재 결과에 이어서 더 수집"으로 이어가거나, 상단 "초기화"로 비울 수 있습니다.`
        )
      }
    })

    const offs = [
      window.api.onLog(appendLog),
      window.api.onPlace(appendPlace),
      window.api.onProgress(setProgress),
      window.api.onStatus(setStatus),
      window.api.onReset(() => {
        setPlaces([])
        setProgress((p) => ({ collected: 0, target: p.target }))
      }),
      window.api.onCaptcha((message) =>
        setNotice(`⚠ CAPTCHA/로그인 감지로 수집이 중단되었습니다: ${message}`)
      ),
      window.api.onError((message) => setNotice(`⚠ ${message}`))
    ]
    return () => offs.forEach((off) => off())
  }, [appendLog, appendPlace])

  const running = status === 'running' || status === 'paused' || status === 'stopping'

  const handleStart = useCallback(
    async (append: boolean) => {
      setNotice(null)
      const res = await window.api.start(config, append)
      if (!res.ok) setNotice(`시작할 수 없습니다: ${res.error ?? '알 수 없는 오류'}`)
    },
    [config]
  )

  const handlePause = useCallback(() => void window.api.pause(), [])
  const handleResume = useCallback(() => void window.api.resume(), [])
  const handleStop = useCallback(() => void window.api.stop(), [])

  const handleSave = useCallback(async (format: ExportFormat) => {
    const res = await window.api.save(format)
    if (res.ok) setNotice(`저장 완료: ${res.filePath} (${res.count}건)`)
    else if (!res.canceled) setNotice(`저장 실패: ${res.error ?? '알 수 없는 오류'}`)
  }, [])

  const handleReset = useCallback(async () => {
    await window.api.reset()
    setPlaces([])
    setLog([])
    setProgress({ collected: 0, target: 0 })
    setNotice(null)
  }, [])

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo">N</span>
          <div>
            <h1>Numbering</h1>
            <p>네이버지도 매장 정보 수집기</p>
          </div>
        </div>
        <Toolbar
          status={status}
          hasResults={places.length > 0}
          format={config.format}
          onStart={() => handleStart(false)}
          onResume={handleResume}
          onPause={handlePause}
          onStop={handleStop}
          onSave={handleSave}
          onReset={handleReset}
        />
      </header>

      {notice && (
        <div className="app__notice" onClick={() => setNotice(null)} role="alert">
          {notice}
          <span className="app__notice-close">×</span>
        </div>
      )}

      <div className="app__body">
        <SearchPanel
          config={config}
          onChange={setConfig}
          disabled={running}
          progress={progress}
          status={status}
          onStartAppend={() => handleStart(true)}
        />
        <main className="app__main">
          <ResultsTable places={places} status={status} progress={progress} />
          <LogPanel log={log} />
        </main>
      </div>
    </div>
  )
}

import type { CollectionStatus, ExportFormat } from '../../../shared/types'

interface Props {
  status: CollectionStatus
  hasResults: boolean
  format: ExportFormat
  onStart: () => void
  onResume: () => void
  onPause: () => void
  onStop: () => void
  onSave: (format: ExportFormat) => void
  onReset: () => void
}

const STATUS_LABEL: Record<CollectionStatus, string> = {
  idle: '대기',
  running: '수집 중',
  paused: '일시정지',
  stopping: '중단 중…',
  stopped: '중단됨',
  done: '완료',
  captcha: 'CAPTCHA 감지',
  error: '오류'
}

export default function Toolbar({
  status,
  hasResults,
  format,
  onStart,
  onResume,
  onPause,
  onStop,
  onSave,
  onReset
}: Props): JSX.Element {
  const running = status === 'running'
  const paused = status === 'paused'
  const active = running || paused || status === 'stopping'

  return (
    <div className="toolbar">
      <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>

      {!active && (
        <button type="button" className="btn btn--primary" onClick={onStart}>
          ▶ 수집 시작
        </button>
      )}

      {running && (
        <button type="button" className="btn" onClick={onPause}>
          ⏸ 일시정지
        </button>
      )}

      {paused && (
        <button type="button" className="btn btn--primary" onClick={onResume}>
          ▶ 재개
        </button>
      )}

      {active && (
        <button type="button" className="btn btn--danger" onClick={onStop} disabled={status === 'stopping'}>
          ■ 중단
        </button>
      )}

      <button
        type="button"
        className="btn"
        onClick={() => onSave(format)}
        disabled={!hasResults}
        title={`${format.toUpperCase()}로 저장`}
      >
        ⬇ 결과 저장 ({format.toUpperCase()})
      </button>

      <button
        type="button"
        className="btn btn--ghost"
        onClick={onReset}
        disabled={active || !hasResults}
        title="결과/로그 초기화"
      >
        초기화
      </button>
    </div>
  )
}

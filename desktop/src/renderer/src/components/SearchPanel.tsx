import type {
  CollectionStatus,
  ExportFormat,
  Progress,
  Radius,
  SearchConfig
} from '../../../shared/types'

interface Props {
  config: SearchConfig
  onChange: (config: SearchConfig) => void
  disabled: boolean
  progress: Progress
  status: CollectionStatus
  onStartAppend: () => void
}

const RADII: Radius[] = ['500m', '1km', '2km', '3km', '5km']
const MAX_OPTIONS = [50, 100, 200, 300, 500, 1000]

export default function SearchPanel({
  config,
  onChange,
  disabled,
  progress,
  status,
  onStartAppend
}: Props): JSX.Element {
  const set = <K extends keyof SearchConfig>(key: K, value: SearchConfig[K]): void =>
    onChange({ ...config, [key]: value })

  const pct =
    progress.target > 0 ? Math.min(100, Math.round((progress.collected / progress.target) * 100)) : 0

  return (
    <aside className="panel">
      <h2 className="panel__title">검색 조건</h2>

      <label className="field">
        <span className="field__label">기준 위치</span>
        <input
          type="text"
          placeholder="예: 성수동, 강남역"
          value={config.location}
          disabled={disabled}
          onChange={(e) => set('location', e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">반경</span>
        <select
          value={config.radius}
          disabled={disabled}
          onChange={(e) => set('radius', e.target.value as Radius)}
        >
          {RADII.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">업종 키워드</span>
        <input
          type="text"
          placeholder="예: 카페, 음식점, 병원, 헬스장"
          value={config.keyword}
          disabled={disabled}
          onChange={(e) => set('keyword', e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">최대 수집 개수</span>
        <input
          type="number"
          min={1}
          max={5000}
          list="max-options"
          value={config.maxResults}
          disabled={disabled}
          onChange={(e) => set('maxResults', Math.max(1, Number(e.target.value) || 0))}
        />
        <datalist id="max-options">
          {MAX_OPTIONS.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </label>

      <label className="field">
        <span className="field__label">저장 형식</span>
        <div className="segmented">
          {(['xlsx', 'csv'] as ExportFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              className={config.format === f ? 'segmented__btn is-active' : 'segmented__btn'}
              onClick={() => set('format', f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </label>

      <details className="advanced">
        <summary>안전장치 / 고급 설정</summary>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={!config.headless}
            disabled={disabled}
            onChange={(e) => set('headless', !e.target.checked)}
          />
          <span>브라우저 창 표시 (수집 과정 직접 확인)</span>
        </label>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={config.instagramFallback}
            disabled={disabled}
            onChange={(e) => set('instagramFallback', e.target.checked)}
          />
          <span>인스타그램 보조 검색 사용</span>
        </label>

        <div className="field field--row">
          <label className="field">
            <span className="field__label">최소 딜레이(ms)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={config.minDelayMs}
              disabled={disabled}
              onChange={(e) => set('minDelayMs', Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label className="field">
            <span className="field__label">최대 딜레이(ms)</span>
            <input
              type="number"
              min={0}
              step={100}
              value={config.maxDelayMs}
              disabled={disabled}
              onChange={(e) => set('maxDelayMs', Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>
        <p className="hint">
          요청 사이 무작위 딜레이로 과도하게 빠른 요청을 방지합니다. CAPTCHA/로그인 화면 감지 시
          자동으로 중단됩니다.
        </p>
      </details>

      <div className="progress">
        <div className="progress__bar">
          <div className="progress__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress__text">
          {progress.collected} / {progress.target || '—'} ({pct}%)
        </div>
      </div>

      {(status === 'done' || status === 'stopped' || status === 'captcha' || status === 'error') &&
        progress.collected > 0 && (
          <button type="button" className="btn btn--ghost btn--block" onClick={onStartAppend}>
            현재 결과에 이어서 더 수집
          </button>
        )}
    </aside>
  )
}

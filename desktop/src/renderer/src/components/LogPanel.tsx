import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '../../../shared/types'

interface Props {
  log: LogEntry[]
}

export default function LogPanel({ log }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [log, autoScroll])

  return (
    <section className="logs">
      <div className="logs__head">
        <h2 className="panel__title">진행 로그</h2>
        <label className="logs__toggle">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          자동 스크롤
        </label>
      </div>
      <div className="logs__scroll" ref={scrollRef}>
        {log.length === 0 ? (
          <div className="logs__empty">로그가 여기에 표시됩니다.</div>
        ) : (
          log.map((entry, i) => (
            <div key={i} className={`logline logline--${entry.level}`}>
              <span className="logline__time">{entry.time}</span>
              <span className="logline__msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

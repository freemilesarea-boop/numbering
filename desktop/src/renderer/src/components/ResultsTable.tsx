import { useMemo, useState } from 'react'
import type { CollectedPlace, CollectionStatus, Progress } from '../../../shared/types'

interface Props {
  places: CollectedPlace[]
  status: CollectionStatus
  progress: Progress
}

function Link({ url }: { url: string }): JSX.Element {
  if (!url) return <span className="muted">—</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url}>
      열기 ↗
    </a>
  )
}

export default function ResultsTable({ places, status, progress }: Props): JSX.Element {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return places
    return places.filter(
      (p) =>
        p.store_name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.safe_phone.includes(q) ||
        p.mobile_phone.includes(q)
    )
  }, [places, query])

  const withMobile = places.filter((p) => p.mobile_phone).length
  const withInsta = places.filter((p) => p.instagram_url).length

  return (
    <section className="results">
      <div className="results__head">
        <h2 className="panel__title">
          수집 결과
          <span className="results__count">{places.length}</span>
          {status === 'running' && <span className="dot dot--live" title="수집 중" />}
        </h2>
        <div className="results__stats">
          <span>휴대폰 {withMobile}</span>
          <span>인스타 {withInsta}</span>
          <span>진행 {progress.collected}/{progress.target || '—'}</span>
        </div>
        <input
          className="results__search"
          type="search"
          placeholder="매장명/주소/번호 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="results__scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="col-idx">#</th>
              <th>매장명</th>
              <th>주소</th>
              <th>안심/대표번호</th>
              <th>휴대폰</th>
              <th>인스타</th>
              <th>홈페이지</th>
              <th>지도</th>
              <th>수집일시</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="table__empty">
                  {places.length === 0
                    ? '아직 수집된 매장이 없습니다. 좌측에서 조건을 입력하고 수집을 시작하세요.'
                    : '검색 결과가 없습니다.'}
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => (
                <tr key={`${p.naver_map_url || p.store_name}-${i}`}>
                  <td className="col-idx">{i + 1}</td>
                  <td className="col-name">{p.store_name}</td>
                  <td className="col-addr" title={p.address}>
                    {p.address || <span className="muted">—</span>}
                  </td>
                  <td>{p.safe_phone || <span className="muted">—</span>}</td>
                  <td>{p.mobile_phone || <span className="muted">—</span>}</td>
                  <td>
                    <Link url={p.instagram_url} />
                  </td>
                  <td>
                    <Link url={p.homepage_url} />
                  </td>
                  <td>
                    <Link url={p.naver_map_url} />
                  </td>
                  <td className="col-time">
                    {p.collected_at ? new Date(p.collected_at).toLocaleString('ko-KR') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

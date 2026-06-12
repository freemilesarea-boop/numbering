// main 프로세스와 renderer 프로세스가 공유하는 타입 정의.
// preload를 통해 직렬화되어 오가므로 순수 데이터 타입만 둔다.

/** 반경 선택 옵션. */
export type Radius = '500m' | '1km' | '2km' | '3km' | '5km'

/** 결과 저장 형식. */
export type ExportFormat = 'csv' | 'xlsx'

/** 수집 진행 상태. */
export type CollectionStatus =
  | 'idle' // 대기
  | 'running' // 수집 중
  | 'paused' // 일시정지
  | 'stopping' // 중단 요청 처리 중
  | 'stopped' // 사용자 중단
  | 'done' // 정상 완료
  | 'captcha' // CAPTCHA/로그인 감지로 중단
  | 'error' // 오류로 중단

/** 사용자가 입력하는 검색 설정. */
export interface SearchConfig {
  /** 기준 위치 (예: "성수동", "강남역") */
  location: string
  /** 반경 */
  radius: Radius
  /** 업종 키워드 (예: "카페", "헬스장") */
  keyword: string
  /** 최대 수집 개수 */
  maxResults: number
  /** 저장 형식 */
  format: ExportFormat
  /** 브라우저 창을 보이게 실행할지 여부 (false면 화면에 보임) */
  headless: boolean
  /** 요청 간 최소 딜레이(ms) */
  minDelayMs: number
  /** 요청 간 최대 딜레이(ms) */
  maxDelayMs: number
  /** 상세에 인스타 링크가 없을 때 보조 검색 사용 여부 */
  instagramFallback: boolean
  /**
   * 네이버 차단 방지 모드. 켜면 느리지만 안전하게 동작한다.
   * - 매장 클릭 후 랜덤 2~5초 대기
   * - 20개 수집마다 30~60초 휴식
   * - 무작위 마우스 이동
   * (실제 Chrome 헤더 동일화 / CAPTCHA·이용제한 감지는 항상 적용)
   */
  stealth: boolean
}

/** 결과 파일/테이블의 한 행. 컬럼명은 요구사항 스펙 그대로 사용한다. */
export interface CollectedPlace {
  store_name: string
  address: string
  safe_phone: string // 안심번호(0507) 또는 대표번호
  mobile_phone: string // 휴대폰번호(010 등)
  instagram_url: string
  homepage_url: string
  naver_map_url: string
  collected_at: string // ISO 문자열
}

/** 로그 레벨. */
export type LogLevel = 'info' | 'success' | 'warn' | 'error'

/** UI로 전달되는 로그 한 줄. */
export interface LogEntry {
  time: string // HH:MM:SS
  level: LogLevel
  message: string
}

/** 진행률 정보. */
export interface Progress {
  collected: number
  target: number
}

/** 중간 저장 / 복구에 사용하는 상태 스냅샷. */
export interface CollectionState {
  config: SearchConfig | null
  status: CollectionStatus
  places: CollectedPlace[]
  log: LogEntry[]
  updatedAt: string
}

/** start 호출 결과. */
export interface StartResult {
  ok: boolean
  error?: string
}

/** save 호출 결과. */
export interface SaveResult {
  ok: boolean
  canceled?: boolean
  filePath?: string
  count?: number
  error?: string
}

/** 기본 검색 설정 값. */
export const DEFAULT_CONFIG: SearchConfig = {
  location: '',
  radius: '1km',
  keyword: '',
  maxResults: 100,
  format: 'xlsx',
  headless: false,
  minDelayMs: 800,
  maxDelayMs: 2200,
  instagramFallback: true,
  stealth: true
}

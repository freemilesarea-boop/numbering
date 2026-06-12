// 링크 분류/디코딩 유틸 (link_utils.py 포팅).
//
// 네이버 플레이스 상세에서 긁어온 a[href] 들을 분류한다.
// - 네이버 리다이렉트/공유 URL이면 실제 외부 URL로 디코딩
// - instagram.com / instagr.am / threads.net → 인스타그램 링크
// - 네이버 내부/타 소셜 → 제외
// - 그 외 외부 링크 → 홈페이지 후보
// - 검색 결과 텍스트에서 인스타그램 프로필 URL 추출

// 인스타그램 계열 호스트(스레드 포함).
const INSTAGRAM_HOSTS = ['instagram.com', 'instagr.am', 'threads.net']

// 리다이렉트 URL에서 실제 목적지를 담는 쿼리 키 후보.
const REDIRECT_PARAMS = [
  'url',
  'u',
  'outurl',
  'outlink',
  'link',
  'target',
  'redirect',
  'landingurl',
  'returl',
  'to',
  'dest'
]

// 홈페이지 후보에서 제외할 네이버 내부 호스트 조각.
const NAVER_INTERNAL = [
  'naver.com',
  'naver.me',
  'pstatic.net',
  'navercorp.com',
  'place.naver',
  'map.naver',
  'booking.naver',
  'blog.naver',
  'cafe.naver',
  'shopping.naver',
  'smartstore.naver',
  'pcmap',
  'nid.naver',
  'search.naver',
  'm.place.naver'
]

// 홈페이지로 보지 않는 타 소셜/메신저 호스트 조각(인스타는 별도 분류).
const SOCIAL_NON_HOMEPAGE = [
  'facebook.com',
  'fb.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'kakao.com',
  'pf.kakao',
  'band.us',
  'blog.me'
]

// 인스타그램에서 프로필이 아닌 예약 경로(첫 path 세그먼트).
const RESERVED_IG_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'tv',
  'accounts',
  'about',
  'developer',
  'legal',
  'directory',
  'web',
  'graphql',
  'challenge',
  'session'
])

const IG_REGEX =
  /(?:https?:)?\/\/(?:www\.|m\.)?(?:instagram\.com|instagr\.am|threads\.net)\/[A-Za-z0-9_.@][A-Za-z0-9_./@%-]*/gi

const SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

export type LinkKind = 'instagram' | 'homepage' | 'exclude'

/** 스킴이 없으면 https://를 붙인다(프로토콜 상대경로 포함). */
function ensureScheme(rawUrl: string): string {
  const url = (rawUrl || '').trim()
  if (!url) return ''
  if (url.startsWith('//')) return 'https:' + url
  if (!SCHEME_REGEX.test(url)) {
    // 'instagram.com/foo' 처럼 스킴 없는 호스트형이면 https 부여
    const firstSeg = url.split('/')[0]
    if (firstSeg.includes('.')) return 'https://' + url
  }
  return url
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(ensureScheme(url))
  } catch {
    return null
  }
}

function host(url: string): string {
  const u = safeUrl(url)
  return u ? u.hostname.toLowerCase() : ''
}

/**
 * 네이버 등 리다이렉트/공유 URL이면 실제 외부 URL을 디코딩해서 반환한다.
 * 중첩 인코딩도 몇 단계까지 풀어준다.
 */
export function decodeRedirect(href: string, depth = 0): string {
  const url = ensureScheme(href)
  if (!url || depth > 5) return url

  const parts = safeUrl(url)
  if (!parts) return url

  const hostName = parts.hostname.toLowerCase()
  const pathQuery = (parts.pathname + '?' + parts.search).toLowerCase()
  const looksLikeRedirector = hostName.includes('naver') || pathQuery.includes('redirect')

  if (parts.search && looksLikeRedirector) {
    const qs = parts.searchParams
    for (const key of REDIRECT_PARAMS) {
      for (const actualKey of [key, key.toLowerCase(), key.toUpperCase()]) {
        const value = qs.get(actualKey)
        if (value) {
          const candidate = decodeURIComponent(value)
          if (candidate.startsWith('http') || candidate.startsWith('//')) {
            return decodeRedirect(candidate, depth + 1)
          }
        }
      }
    }
  }
  return url
}

/** 인스타그램/스레드 호스트인지 판별한다. */
export function isInstagramUrl(url: string): boolean {
  const h = host(url)
  if (!h) return false
  return INSTAGRAM_HOSTS.some((d) => h === d || h.endsWith('.' + d))
}

/** 게시물/예약 경로가 아닌 '프로필' 링크로 보이는지. */
function isProfileInstagram(url: string): boolean {
  const parts = safeUrl(url)
  if (!parts) return false
  if (parts.hostname.toLowerCase().endsWith('threads.net')) return true
  const segments = parts.pathname.split('/').filter(Boolean)
  if (segments.length === 0) return false
  const first = segments[0].toLowerCase().replace(/^@+/, '')
  return !RESERVED_IG_SEGMENTS.has(first)
}

/** 추적 쿼리/프래그먼트를 제거하고 https 정규형으로 만든다. */
export function normalizeInstagramUrl(url: string): string {
  const parts = safeUrl(url)
  if (!parts || !parts.hostname) return ''
  const netloc = parts.hostname.toLowerCase()
  const path = parts.pathname.replace(/\/+$/, '')
  return `https://${netloc}${path}`
}

/**
 * 원본 href 하나를 (종류, 정규화 URL)로 분류한다.
 * 먼저 네이버 리다이렉트를 디코딩한 실제 URL로 판단한다.
 */
export function classifyLink(rawHref: string): { kind: LinkKind; url: string } {
  let url = decodeRedirect(rawHref)
  if (!url || !(url.startsWith('http') || url.startsWith('//'))) {
    return { kind: 'exclude', url: '' }
  }
  url = ensureScheme(url)

  if (isInstagramUrl(url)) {
    const norm = normalizeInstagramUrl(url)
    // 게시물(/p/), 릴스, 예약 경로 등 비(非)프로필 링크는 저장하지 않는다.
    if (isProfileInstagram(norm)) return { kind: 'instagram', url: norm }
    return { kind: 'exclude', url: norm }
  }

  const h = host(url)
  if (!h) return { kind: 'exclude', url }
  if (NAVER_INTERNAL.some((token) => h.includes(token))) return { kind: 'exclude', url }
  if (SOCIAL_NON_HOMEPAGE.some((token) => h.includes(token))) return { kind: 'exclude', url }
  return { kind: 'homepage', url }
}

/**
 * 검색 결과 텍스트(HTML/문자열)에서 인스타그램 프로필 URL을 추출한다.
 * 네이버 리다이렉트로 감싸진 경우도 디코딩해서 본다.
 * 프로필형을 우선 반환하고, 없으면 첫 인스타 URL을 반환한다.
 */
export function extractInstagramFromText(text: string): string {
  if (!text) return ''

  const candidates: string[] = []

  // 1) 네이버 검색 결과의 리다이렉트 URL 안에 인스타 주소가 인코딩된 경우
  for (const m of text.matchAll(/https?[^\s"'<>]+/g)) {
    const decoded = decodeRedirect(m[0])
    if (isInstagramUrl(decoded)) candidates.push(normalizeInstagramUrl(decoded))
  }

  // 2) 본문에 직접 노출된 인스타 URL
  for (const m of text.matchAll(IG_REGEX)) {
    candidates.push(normalizeInstagramUrl(m[0]))
  }

  for (const url of candidates) {
    if (url && isProfileInstagram(url)) return url
  }
  for (const url of candidates) {
    if (url) return url
  }
  return ''
}

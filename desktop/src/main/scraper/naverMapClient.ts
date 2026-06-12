// 네이버 지도 브라우저 자동화 수집기 (naver_map_client.py 포팅, Playwright Node).
//
// 네이버 지도 검색 화면을 Playwright로 직접 열어 검색 결과를 스크롤하며
// 매장 정보를 수집한다. 공개 화면에 노출된 정보만 추출한다.
//
// 주의:
// - 네이버 지도의 DOM/셀렉터는 자주 바뀐다. 화면 구조가 바뀌면 아래 *_SELECTORS
//   상수를 갱신해야 할 수 있다.
// - 과도한 요청을 피하기 위해 동작 사이에 랜덤 딜레이를 적용한다.
// - 한 매장 추출이 실패해도 예외를 흘려보내지 않고 건너뛴다.
// - CAPTCHA / 로그인 요구 화면을 감지하면 CaptchaError를 던져 수집을 중단한다.

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Frame,
  type FrameLocator,
  type Locator
} from 'playwright'
import type { CollectedPlace, SearchConfig } from '../../shared/types'
import { classifyLink, extractInstagramFromText } from './linkUtils'
import { classifyPhone } from './dedupe'

// 네이버 지도 검색 URL (검색어를 경로에 직접 넣는 방식).
const SEARCH_URL_TEMPLATE = (query: string): string =>
  `https://map.naver.com/p/search/${encodeURIComponent(query)}`

// 인스타 보조 검색(네이버 통합검색) URL.
const NAVER_SEARCH_URL = (query: string): string =>
  `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`

// 검색 결과 목록 / 상세 패널 iframe.
const SEARCH_IFRAME = '#searchIframe'
const ENTRY_IFRAME = '#entryIframe'

// 결과 목록 스크롤 컨테이너 후보.
const LIST_SCROLL_SELECTORS = ['#_pcmap_list_scroll_container', 'div.Ryr1F']

// 결과 목록의 개별 매장 li 후보.
const LIST_ITEM_SELECTORS = [
  '#_pcmap_list_scroll_container > ul > li',
  'ul > li.UEzoS',
  'ul > li.VLTHu',
  'ul > li'
]

// 목록 카드에서 매장명(상세 진입용).
const LIST_NAME_SELECTORS = ['span.YwYLL', 'span.TYaxT', 'span.place_bluelink', 'a span']

// 상세 패널(entryIframe)에서의 필드 후보.
const DETAIL_NAME_SELECTORS = ['span.GHAhO', '#_title span', 'div.zD5Nm span.GHAhO']
const DETAIL_ADDRESS_SELECTORS = ['span.LDgIH', 'div.PkgBl span', 'a.PkgBl']
const DETAIL_PHONE_SELECTORS = ['span.xlx7Q', 'div.O8qbU span.xlx7Q']

// 상세 패널에서 외부 링크가 모여 있는 영역(홈페이지/소식/정보/예약/블로그 등).
const DETAIL_LINK_AREA_SELECTORS = [
  'div.place_section_content',
  'div.O8qbU',
  'div.jO09N',
  'div.CcOJv'
]

// 프레임/요소 대기 타임아웃(ms).
const FRAME_TIMEOUT = 15000
const SHORT_TIMEOUT = 4000

/** 수집 중 복구 불가능한 일반 오류. */
export class NaverMapError extends Error {}

/** CAPTCHA / 로그인 요구 화면 감지 시 던지는 오류. */
export class CaptchaError extends Error {}

/** 수집 진행을 외부(컨트롤러)에서 제어/관찰하기 위한 인터페이스. */
export interface CollectControl {
  /** 중단 요청 여부. true면 수집 루프를 즉시 빠져나간다. */
  shouldStop(): boolean
  /** 일시정지 상태면 재개될 때까지 대기한다. */
  waitIfPaused(): Promise<void>
  /** 로그 한 줄을 남긴다. */
  log(message: string, level?: 'info' | 'success' | 'warn' | 'error'): void
  /**
   * 매장 후보 1건을 컨트롤러에 전달한다.
   * 신규로 받아들여졌으면 true, 중복이면 false를 반환한다.
   */
  emitPlace(place: CollectedPlace): boolean
}

/** [min, max] 사이 랜덤 정수 ms 만큼 대기한다. */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const lo = Math.max(0, Math.min(minMs, maxMs))
  const hi = Math.max(minMs, maxMs)
  const ms = lo + Math.floor(Math.random() * (hi - lo + 1))
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class NaverMapClient {
  private readonly config: SearchConfig
  private pw: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null

  constructor(config: SearchConfig) {
    this.config = config
  }

  // ---- 생명주기 ----------------------------------------------------------

  async start(): Promise<void> {
    this.pw = await chromium.launch({ headless: this.config.headless })
    this.context = await this.pw.newContext({
      locale: 'ko-KR',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 }
    })
    this.page = await this.context.newPage()
  }

  async close(): Promise<void> {
    for (const closer of [
      () => this.context?.close(),
      () => this.pw?.close()
    ]) {
      try {
        await closer()
      } catch {
        /* 정리 중 예외는 무시 */
      }
    }
    this.page = null
    this.context = null
    this.pw = null
  }

  // ---- 유틸 --------------------------------------------------------------

  private sleep(): Promise<void> {
    return randomDelay(this.config.minDelayMs, this.config.maxDelayMs)
  }

  private static async firstText(
    scope: FrameLocator | Locator,
    selectors: string[]
  ): Promise<string> {
    for (const sel of selectors) {
      try {
        const loc = scope.locator(sel).first()
        if ((await loc.count()) === 0) continue
        const text = ((await loc.innerText({ timeout: SHORT_TIMEOUT })) || '').trim()
        if (text) return text
      } catch {
        continue
      }
    }
    return ''
  }

  private async listItems(frame: FrameLocator): Promise<Locator> {
    for (const sel of LIST_ITEM_SELECTORS) {
      const loc = frame.locator(sel)
      try {
        if ((await loc.count()) > 0) return loc
      } catch {
        continue
      }
    }
    return frame.locator('ul > li')
  }

  private async scrollList(frame: FrameLocator): Promise<void> {
    for (const sel of LIST_SCROLL_SELECTORS) {
      const container = frame.locator(sel).first()
      try {
        if ((await container.count()) > 0) {
          await container.evaluate((el) => el.scrollBy(0, el.scrollHeight))
          return
        }
      } catch {
        continue
      }
    }
    // 폴백: 마지막 항목을 화면에 노출시켜 추가 로딩 유도
    try {
      const items = await this.listItems(frame)
      await items.last().scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT })
    } catch {
      /* ignore */
    }
  }

  /**
   * CAPTCHA / 로그인 요구 화면을 감지하면 CaptchaError를 던진다.
   * 공개 검색 화면이 막혔다는 신호이므로 수집을 즉시 중단해야 한다.
   */
  private async assertNotBlocked(): Promise<void> {
    const page = this.page
    if (!page) return
    const url = (page.url() || '').toLowerCase()
    if (url.includes('captcha') || url.includes('nidlogin') || url.includes('nid.naver.com')) {
      throw new CaptchaError('CAPTCHA 또는 로그인 요구 화면이 감지되었습니다.')
    }
    try {
      const body = ((await page.locator('body').innerText({ timeout: SHORT_TIMEOUT })) || '')
        .toLowerCase()
      const signals = ['captcha', '자동 입력 방지', '로봇이 아닙니다', '보안 문자', '비정상적인 접근']
      if (signals.some((s) => body.includes(s.toLowerCase()))) {
        throw new CaptchaError('CAPTCHA 또는 비정상 접근 차단 화면이 감지되었습니다.')
      }
    } catch (err) {
      if (err instanceof CaptchaError) throw err
      // 본문 읽기 실패는 무시(차단으로 단정하지 않음)
    }
  }

  /**
   * 상세 패널의 링크 영역에서 모든 a[href]를 모은다.
   * 영역을 못 찾으면 패널 전체 a[href]로 폴백한다.
   */
  private async collectAnchorHrefs(entry: FrameLocator): Promise<string[]> {
    const hrefs: string[] = []
    const seen = new Set<string>()

    const scopes: Array<FrameLocator | Locator> = []
    for (const sel of DETAIL_LINK_AREA_SELECTORS) {
      try {
        const loc = entry.locator(sel)
        if ((await loc.count()) > 0) scopes.push(loc)
      } catch {
        continue
      }
    }
    if (scopes.length === 0) scopes.push(entry)

    for (const scope of scopes) {
      let count = 0
      try {
        const anchors = scope.locator('a[href]')
        count = Math.min(await anchors.count(), 60)
        for (let i = 0; i < count; i++) {
          let href = ''
          try {
            href = (await anchors.nth(i).getAttribute('href', { timeout: SHORT_TIMEOUT })) || ''
          } catch {
            continue
          }
          href = href.trim()
          if (href && !seen.has(href)) {
            seen.add(href)
            hrefs.push(href)
          }
        }
      } catch {
        continue
      }
    }
    return hrefs
  }

  /** 상세 패널의 외부 링크를 분류해 (홈페이지, 인스타그램)을 반환한다. */
  private async extractLinks(
    entry: FrameLocator,
    log: CollectControl['log']
  ): Promise<{ homepage: string; instagram: string }> {
    let homepage = ''
    let instagram = ''
    for (const href of await this.collectAnchorHrefs(entry)) {
      const { kind, url } = classifyLink(href)
      if (kind === 'instagram' && !instagram) {
        instagram = url
        log(`    [인스타] 링크 찾음: ${url}`, 'info')
      } else if (kind === 'homepage' && !homepage) {
        homepage = url
      } else if (kind === 'exclude') {
        const low = href.toLowerCase()
        if (low.includes('insta') || low.includes('threads')) {
          log(`    [인스타] 후보 제외: ${href}`, 'info')
        }
      }
    }
    return { homepage, instagram }
  }

  /** 상세에 인스타 링크가 없을 때 보조 검색으로 프로필 URL을 찾는다. */
  private async searchInstagram(
    placeName: string,
    regionHint: string,
    log: CollectControl['log']
  ): Promise<string> {
    if (!placeName || !this.context) return ''
    const terms = [placeName, regionHint, '인스타그램'].filter(Boolean)
    const query = terms.join(' ')
    let searchPage: Page | null = null
    try {
      searchPage = await this.context.newPage()
      await searchPage.goto(NAVER_SEARCH_URL(query), {
        waitUntil: 'domcontentloaded',
        timeout: FRAME_TIMEOUT
      })
      await this.sleep()
      const content = await searchPage.content()
      const url = extractInstagramFromText(content)
      if (url) log(`    [인스타] 보조검색 찾음: ${url} (검색어: ${query})`, 'info')
      else log(`    [인스타] 보조검색 없음 (검색어: ${query})`, 'info')
      return url
    } catch (err) {
      log(`    [인스타] 보조검색 실패: ${(err as Error).message}`, 'warn')
      return ''
    } finally {
      if (searchPage) {
        try {
          await searchPage.close()
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** 상세 패널(entryIframe)에서 매장명/주소/전화번호/링크를 추출. */
  private async extractDetail(
    log: CollectControl['log'],
    regionHint: string
  ): Promise<{
    placeName: string
    address: string
    phone: string
    homepage: string
    instagram: string
  }> {
    const detail = { placeName: '', address: '', phone: '', homepage: '', instagram: '' }
    const page = this.page
    if (!page) return detail

    try {
      await page.waitForSelector(ENTRY_IFRAME, { timeout: FRAME_TIMEOUT })
    } catch {
      return detail
    }

    const entry = page.frameLocator(ENTRY_IFRAME)
    detail.placeName = await NaverMapClient.firstText(entry, DETAIL_NAME_SELECTORS)
    detail.address = await NaverMapClient.firstText(entry, DETAIL_ADDRESS_SELECTORS)

    let phone = await NaverMapClient.firstText(entry, DETAIL_PHONE_SELECTORS)
    if (!phone) {
      // tel: 링크 폴백
      try {
        const tel = entry.locator("a[href^='tel:']").first()
        if ((await tel.count()) > 0) {
          const href = (await tel.getAttribute('href', { timeout: SHORT_TIMEOUT })) || ''
          phone = href.replace('tel:', '').trim()
        }
      } catch {
        /* ignore */
      }
    }
    detail.phone = phone

    const { homepage, instagram } = await this.extractLinks(entry, log)
    detail.homepage = homepage

    let ig = instagram
    const name = detail.placeName || ''
    if (!ig && this.config.instagramFallback) {
      ig = await this.searchInstagram(name, regionHint, log)
    }
    if (!ig) log(`    [인스타] 없음: ${name || '(이름미상)'}`, 'info')
    detail.instagram = ig

    return detail
  }

  // ---- 메인 수집 ---------------------------------------------------------

  /**
   * 검색어 하나에 대해 네이버 지도 검색 결과를 수집한다.
   * 각 매장 카드를 클릭해 상세 패널에서 전화번호/주소/링크까지 추출하고
   * control.emitPlace로 컨트롤러에 전달한다(중복 판정/저장은 컨트롤러 담당).
   */
  async collect(keyword: string, control: CollectControl): Promise<void> {
    const page = this.page
    if (!page) throw new NaverMapError('start()가 호출되지 않았습니다.')

    const regionHint = keyword.split(/\s+/)[0] || ''

    try {
      await page.goto(SEARCH_URL_TEMPLATE(keyword), {
        waitUntil: 'domcontentloaded',
        timeout: FRAME_TIMEOUT
      })
    } catch (err) {
      control.log(`  - [실패] 페이지 접속 실패: ${(err as Error).message}`, 'error')
      return
    }

    await this.sleep()
    await this.assertNotBlocked()

    try {
      await page.waitForSelector(SEARCH_IFRAME, { timeout: FRAME_TIMEOUT })
    } catch {
      control.log('  - [경고] 검색 결과 프레임을 찾지 못했습니다(결과 없음 가능).', 'warn')
      return
    }

    const search = page.frameLocator(SEARCH_IFRAME)

    let processed = 0 // 이미 처리한 li 인덱스 수
    let emptyRounds = 0
    const maxScroll = 200 // 안전 상한(목표 도달/중단/소진 중 먼저 만나면 종료)

    for (let round = 0; round < maxScroll; round++) {
      if (control.shouldStop()) return

      const items = await this.listItems(search)
      let total = 0
      try {
        total = await items.count()
      } catch {
        total = 0
      }

      let newInRound = 0
      for (let idx = processed; idx < total; idx++) {
        if (control.shouldStop()) return
        await control.waitIfPaused()

        const item = items.nth(idx)
        const name = await NaverMapClient.firstText(item, LIST_NAME_SELECTORS)
        if (!name) continue

        const place: CollectedPlace = {
          store_name: name,
          address: '',
          safe_phone: '',
          mobile_phone: '',
          instagram_url: '',
          homepage_url: '',
          naver_map_url: '',
          collected_at: new Date().toISOString()
        }

        // 상세 패널 진입 → 전화번호/주소/링크 추출
        try {
          let link: Locator = item.locator(LIST_NAME_SELECTORS.join(', ')).first()
          if ((await link.count()) === 0) link = item
          await link.click({ timeout: SHORT_TIMEOUT })
          await this.sleep()
          await this.assertNotBlocked()

          const detail = await this.extractDetail(control.log, regionHint)
          place.store_name = detail.placeName || name
          place.address = detail.address
          const { safe, mobile } = classifyPhone(detail.phone)
          place.safe_phone = safe
          place.mobile_phone = mobile
          place.homepage_url = detail.homepage
          place.instagram_url = detail.instagram
          place.collected_at = new Date().toISOString()
          // 클릭 후 URL이 곧 네이버 플레이스 매장 URL
          const currentUrl = page.url() || ''
          if (currentUrl.includes('/place/')) place.naver_map_url = currentUrl
        } catch (err) {
          if (err instanceof CaptchaError) throw err
          control.log(`    - 상세 추출 건너뜀(${name}): ${(err as Error).message}`, 'warn')
        }

        const accepted = control.emitPlace(place)
        if (accepted) newInRound += 1
        if (control.shouldStop()) return
      }

      processed = total

      // 더 이상 새 항목이 없으면 몇 번 더 시도하다 종료
      if (newInRound === 0) {
        emptyRounds += 1
        if (emptyRounds >= 3) break
      } else {
        emptyRounds = 0
      }

      await this.scrollList(search)
      await this.sleep()
    }
  }
}

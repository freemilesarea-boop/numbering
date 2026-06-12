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

// 검색 결과 목록 하단의 "다음페이지" 버튼 후보(여러 전략으로 시도).
// 텍스트 기반(place_blind "다음페이지")이 가장 안정적이고, 클래스 기반은 폴백.
const NEXT_PAGE_SELECTORS = [
  'a:has(span.place_blind:text-is("다음페이지"))',
  'button:has(span.place_blind:text-is("다음페이지"))',
  'a.eUTV2',
  'a:has-text("다음페이지")',
  'button:has-text("다음페이지")'
]

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
// 상세 패널 전환/로딩 대기 상한(ms). 항목 단위라 너무 길면 전체가 느려진다.
const DETAIL_WAIT_TIMEOUT = 8000

/** 수집 중 복구 불가능한 일반 오류. */
export class NaverMapError extends Error {}

/** CAPTCHA / 로그인 요구 화면 감지 시 던지는 오류. */
export class CaptchaError extends Error {}

/** Chromium 브라우저 실행 실패(미설치 등) 시 던지는 오류. */
export class BrowserLaunchError extends Error {}

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
    try {
      this.pw = await chromium.launch({ headless: this.config.headless })
    } catch (err) {
      const msg = (err as Error).message || ''
      // Playwright는 브라우저가 없을 때 "Executable doesn't exist" 등을 던진다.
      if (
        /executable doesn'?t exist/i.test(msg) ||
        /playwright install/i.test(msg) ||
        /browserType\.launch/i.test(msg)
      ) {
        throw new BrowserLaunchError(
          'Chromium 브라우저가 설치되어 있지 않거나 실행할 수 없습니다.\n' +
            'desktop 폴더에서 아래 명령으로 브라우저를 설치한 뒤 다시 시도해 주세요:\n' +
            '  npx playwright install chromium'
        )
      }
      throw new BrowserLaunchError(`브라우저 실행 실패: ${msg}`)
    }
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

  /** 상세 패널의 이름이 보일 때까지(=새 매장이 로드될 때까지) 대기한다. */
  private async waitForDetailReady(entry: FrameLocator): Promise<boolean> {
    const deadline = Date.now() + DETAIL_WAIT_TIMEOUT
    while (Date.now() < deadline) {
      for (const sel of DETAIL_NAME_SELECTORS) {
        try {
          const loc = entry.locator(sel).first()
          if ((await loc.count()) > 0) {
            const t = ((await loc.innerText({ timeout: SHORT_TIMEOUT })) || '').trim()
            if (t) return true
          }
        } catch {
          /* 아직 로딩 중 */
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }

  /**
   * 필드를 여러 번 재시도하며 읽는다. 상세 패널이 떠도 전화번호/주소가
   * 이름보다 살짝 늦게 채워지는 경우가 있어, 짧게 폴링해 누락을 줄인다.
   */
  private static async readWithRetry(
    entry: FrameLocator,
    selectors: string[],
    attempts = 5
  ): Promise<string> {
    for (let i = 0; i < attempts; i++) {
      const text = await NaverMapClient.firstText(entry, selectors)
      if (text) return text
      await new Promise((r) => setTimeout(r, 300))
    }
    return ''
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
    // 새 매장 패널이 실제로 로드될 때까지 대기(이름 노출 기준).
    await this.waitForDetailReady(entry)

    detail.placeName = await NaverMapClient.firstText(entry, DETAIL_NAME_SELECTORS)
    detail.address = await NaverMapClient.readWithRetry(entry, DETAIL_ADDRESS_SELECTORS)

    let phone = await NaverMapClient.readWithRetry(entry, DETAIL_PHONE_SELECTORS)
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

    const maxPages = 200 // 페이지 안전 상한(목표 도달/중단/소진 중 먼저 만나면 종료)
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      if (control.shouldStop()) return

      control.log(`  [페이지 ${pageNo}] 목록 수집 중…`, 'info')
      await this.processListPage(search, control, regionHint)
      if (control.shouldStop()) return

      // 현재 페이지를 모두 처리했으면 다음 페이지로 이동 시도.
      const moved = await this.goToNextPage(search, control)
      if (!moved) {
        control.log('  더 이상 페이지가 없습니다. 수집을 종료합니다.', 'info')
        break
      }
    }
  }

  /**
   * 현재 검색 결과 페이지의 목록을 끝까지 스크롤하며 각 매장을 처리한다.
   * 새 항목이 더 이상 로드되지 않으면(=페이지 소진) 반환한다.
   */
  private async processListPage(
    search: FrameLocator,
    control: CollectControl,
    regionHint: string
  ): Promise<void> {
    const page = this.page
    if (!page) return

    let processed = 0
    let emptyRounds = 0
    const maxScroll = 60

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
          const prevUrl = page.url() || ''
          let link: Locator = item.locator(LIST_NAME_SELECTORS.join(', ')).first()
          if ((await link.count()) === 0) link = item
          await link.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT }).catch(() => {})
          await link.click({ timeout: SHORT_TIMEOUT })
          // 클릭한 매장으로 상세가 실제로 바뀔 때까지 대기(이전 매장 정보 오독 방지).
          await this.waitForPlaceChange(prevUrl)
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

      // 더 이상 새 항목이 없으면 몇 번 더 시도하다 종료(페이지 소진).
      if (newInRound === 0) {
        emptyRounds += 1
        if (emptyRounds >= 3) return
      } else {
        emptyRounds = 0
      }

      await this.scrollList(search)
      await this.sleep()
    }
  }

  /**
   * 리스트 항목 클릭 후, 상세(/place/{id}) URL이 이전과 다르게 바뀔 때까지 대기.
   * 이전 매장의 패널을 그대로 읽어 전화번호/주소가 비거나 어긋나는 것을 막는다.
   */
  private async waitForPlaceChange(prevUrl: string): Promise<void> {
    const page = this.page
    if (!page) return
    const deadline = Date.now() + DETAIL_WAIT_TIMEOUT
    while (Date.now() < deadline) {
      const u = page.url() || ''
      if (u !== prevUrl && u.includes('/place/')) return
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  /**
   * 검색 결과 목록의 "다음페이지" 버튼을 찾아 클릭한다.
   * 이동했으면 true, 다음 페이지가 없거나 비활성(마지막 페이지)이면 false.
   */
  private async goToNextPage(search: FrameLocator, control: CollectControl): Promise<boolean> {
    for (const sel of NEXT_PAGE_SELECTORS) {
      let btn: Locator
      try {
        btn = search.locator(sel).last()
        if ((await btn.count()) === 0) continue
      } catch {
        continue
      }
      // 마지막 페이지에서는 aria-disabled="true"로 표시된다.
      const ariaDisabled = await btn.getAttribute('aria-disabled').catch(() => null)
      const domDisabled = await btn.isDisabled().catch(() => false)
      if (ariaDisabled === 'true' || domDisabled) return false

      try {
        await btn.scrollIntoViewIfNeeded({ timeout: SHORT_TIMEOUT }).catch(() => {})
        await btn.click({ timeout: SHORT_TIMEOUT })
        await this.sleep()
        await this.assertNotBlocked()
        // 새 페이지 목록이 그려질 시간을 잠시 더 준다.
        await new Promise((r) => setTimeout(r, 600))
        return true
      } catch {
        continue
      }
    }
    return false
  }
}

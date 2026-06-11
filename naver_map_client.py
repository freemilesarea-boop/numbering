"""네이버 지도 브라우저 자동화 수집기 (Playwright).

Kakao Local API 대신 네이버 지도 검색 화면을 Playwright로 직접 열어
검색 결과를 스크롤하며 매장 정보를 수집한다.

수집 필드(공통 place 스키마):
    place_name, phone, address, category, place_url

주의:
- 네이버 지도의 DOM/셀렉터는 자주 바뀐다. 가능한 한 여러 후보 셀렉터와
  텍스트/role 기반 접근을 섞어 안정성을 높였지만, 화면 구조가 바뀌면
  아래 *_SELECTORS 상수를 갱신해야 할 수 있다.
- 과도한 요청을 피하기 위해 동작 사이에 delay_seconds를 적용한다.
- 한 매장 추출이 실패해도 예외를 흘려보내지 않고 건너뛴다.
"""

from __future__ import annotations

import time
from urllib.parse import quote

import link_utils

# Playwright는 선택 의존성이다. source="naver_map"일 때만 필요하므로
# import 실패 시 친절한 안내를 위해 여기서 잡아 둔다.
try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - 설치 안내용
    sync_playwright = None


# 네이버 지도 검색 URL (검색어를 경로에 직접 넣는 방식).
SEARCH_URL_TEMPLATE = "https://map.naver.com/p/search/{query}"

# 인스타 보조 검색(네이버 통합검색) URL.
NAVER_SEARCH_URL = "https://search.naver.com/search.naver?query={query}"

# 검색 결과 목록 / 상세 패널 iframe.
SEARCH_IFRAME = "#searchIframe"
ENTRY_IFRAME = "#entryIframe"

# 결과 목록 스크롤 컨테이너 후보.
LIST_SCROLL_SELECTORS = [
    "#_pcmap_list_scroll_container",
    "div.Ryr1F",
]

# 결과 목록의 개별 매장 li 후보.
LIST_ITEM_SELECTORS = [
    "#_pcmap_list_scroll_container > ul > li",
    "ul > li.UEzoS",
    "ul > li.VLTHu",
    "ul > li",
]

# 목록 카드에서 매장명/카테고리(상세 진입 전 1차 추출).
LIST_NAME_SELECTORS = ["span.YwYLL", "span.TYaxT", "span.place_bluelink", "a span"]
LIST_CATEGORY_SELECTORS = ["span.YzBgS", "span.KCMnt"]

# 상세 패널(entryIframe)에서의 필드 후보.
DETAIL_NAME_SELECTORS = ["span.GHAhO", "#_title span", "div.zD5Nm span.GHAhO"]
DETAIL_CATEGORY_SELECTORS = ["span.lnJFt", "span.DJJvD"]
DETAIL_ADDRESS_SELECTORS = ["span.LDgIH", "div.PkgBl span", "a.PkgBl"]
DETAIL_PHONE_SELECTORS = ["span.xlx7Q", "div.O8qbU span.xlx7Q"]

# 상세 패널에서 외부 링크가 모여 있는 영역(홈페이지/소식/정보/예약/블로그 등).
# 영역을 못 찾으면 패널 전체의 a[href]로 폴백한다.
DETAIL_LINK_AREA_SELECTORS = [
    "div.place_section_content",
    "div.O8qbU",
    "div.jO09N",
    "div.CcOJv",
]

# 프레임/요소 대기 타임아웃(ms).
FRAME_TIMEOUT = 15000
SHORT_TIMEOUT = 4000


class NaverMapError(Exception):
    """네이버 지도 수집 중 복구 불가능한 오류."""


class NaverMapClient:
    """네이버 지도 검색 결과를 Playwright로 수집하는 클라이언트.

    수집기 공통 인터페이스: start(), collect_places(...), close().
    """

    def __init__(self, settings: dict):
        if sync_playwright is None:
            raise NaverMapError(
                "playwright가 설치되어 있지 않습니다.\n"
                "  pip install playwright\n"
                "  playwright install chromium\n"
                "위 명령으로 설치한 뒤 다시 실행해 주세요."
            )
        self.headless = bool(settings.get("headless", False))
        self.delay = float(settings.get("delay_seconds", 1.0) or 0)
        self.scroll_count = int(settings.get("scroll_count", 30) or 30)

        self._pw = None
        self._browser = None
        self._context = None
        self._page = None

    # ---- 생명주기 ----------------------------------------------------------

    def start(self) -> None:
        """Playwright 브라우저를 띄운다."""
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.headless)
        self._context = self._browser.new_context(
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
        )
        self._page = self._context.new_page()

    def close(self) -> None:
        """브라우저/Playwright 자원을 정리한다(예외는 무시)."""
        for closer in (
            getattr(self._context, "close", None),
            getattr(self._browser, "close", None),
            getattr(self._pw, "stop", None),
        ):
            try:
                if closer:
                    closer()
            except Exception:
                pass
        self._page = self._context = self._browser = self._pw = None

    # ---- 유틸 --------------------------------------------------------------

    def _sleep(self) -> None:
        if self.delay > 0:
            time.sleep(self.delay)

    @staticmethod
    def _first_text(scope, selectors: list[str]) -> str:
        """후보 셀렉터들을 순서대로 시도해 첫 번째 비어있지 않은 텍스트를 반환."""
        for sel in selectors:
            try:
                loc = scope.locator(sel).first
                if loc.count() == 0:
                    continue
                text = (loc.inner_text(timeout=SHORT_TIMEOUT) or "").strip()
                if text:
                    return text
            except Exception:
                continue
        return ""

    def _list_items(self, frame):
        """결과 목록의 li Locator 모음을 반환(후보 셀렉터 순서대로 첫 매칭)."""
        for sel in LIST_ITEM_SELECTORS:
            loc = frame.locator(sel)
            try:
                if loc.count() > 0:
                    return loc
            except Exception:
                continue
        return frame.locator("ul > li")

    def _scroll_list(self, frame) -> None:
        """결과 목록 컨테이너를 아래로 스크롤한다."""
        for sel in LIST_SCROLL_SELECTORS:
            container = frame.locator(sel).first
            try:
                if container.count() > 0:
                    container.evaluate("el => el.scrollBy(0, el.scrollHeight)")
                    return
            except Exception:
                continue
        # 폴백: 마지막 항목을 화면에 노출시켜 추가 로딩 유도
        try:
            self._list_items(frame).last.scroll_into_view_if_needed(
                timeout=SHORT_TIMEOUT
            )
        except Exception:
            pass

    def _collect_anchor_hrefs(self, entry) -> list[str]:
        """상세 패널의 링크 영역(홈페이지/소식/정보/예약/블로그)에서 모든
        a[href]를 모은다. 영역을 못 찾으면 패널 전체 a[href]로 폴백한다."""
        hrefs: list[str] = []
        seen: set[str] = set()

        scopes = []
        for sel in DETAIL_LINK_AREA_SELECTORS:
            try:
                loc = entry.locator(sel)
                if loc.count() > 0:
                    scopes.append(loc)
            except Exception:
                continue
        # 영역 셀렉터가 하나도 안 잡히면 패널 전체에서 수집
        if not scopes:
            scopes = [entry]

        for scope in scopes:
            try:
                anchors = scope.locator("a[href]")
                count = min(anchors.count(), 60)
            except Exception:
                continue
            for i in range(count):
                try:
                    href = anchors.nth(i).get_attribute(
                        "href", timeout=SHORT_TIMEOUT
                    ) or ""
                except Exception:
                    continue
                href = href.strip()
                if href and href not in seen:
                    seen.add(href)
                    hrefs.append(href)
        return hrefs

    def _extract_links(self, entry, log) -> tuple[str, str]:
        """상세 패널의 모든 외부 링크를 분류해 (홈페이지, 인스타그램)을 반환한다.

        - 네이버 리다이렉트/공유 URL은 실제 외부 URL로 디코딩 후 판정한다.
        - instagram.com / instagr.am / threads.net → 인스타그램.
        - 네이버 내부/타 소셜 → 제외(저장하지 않음).
        - 인스타 후보를 제외한 경우 로그를 남긴다.
        """
        homepage, instagram = "", ""
        for href in self._collect_anchor_hrefs(entry):
            kind, url = link_utils.classify_link(href)
            if kind == "instagram" and not instagram:
                instagram = url
                self._log(log, f"    [인스타] 링크 찾음: {url}")
            elif kind == "homepage" and not homepage:
                homepage = url
            elif kind == "exclude":
                low = href.lower()
                if ("insta" in low) or ("threads" in low):
                    # 인스타처럼 보였지만 유효 프로필로 분류되지 않은 후보
                    self._log(log, f"    [인스타] 후보 제외: {href}")
        return homepage, instagram

    @staticmethod
    def _log(log, msg: str) -> None:
        if log is not None:
            log.log(msg)

    def _search_instagram(self, place_name: str, region_hint: str, log) -> str:
        """상세에 인스타 링크가 없을 때 보조 검색으로 프로필 URL을 찾는다.

        '업체명 지역 인스타그램'으로 네이버 통합검색을 열어 결과 본문에서
        instagram.com 프로필 URL만 추출한다.
        """
        if not place_name:
            return ""
        terms = [t for t in (place_name, region_hint, "인스타그램") if t]
        query = " ".join(terms)
        search_page = None
        try:
            search_page = self._context.new_page()
            search_page.goto(
                NAVER_SEARCH_URL.format(query=quote(query)),
                wait_until="domcontentloaded",
                timeout=FRAME_TIMEOUT,
            )
            self._sleep()
            content = search_page.content()
            url = link_utils.extract_instagram_from_text(content)
            if url:
                self._log(log, f"    [인스타] 보조검색 찾음: {url} (검색어: {query})")
            else:
                self._log(log, f"    [인스타] 보조검색 없음 (검색어: {query})")
            return url
        except Exception as exc:
            self._log(log, f"    [인스타] 보조검색 실패: {exc}")
            return ""
        finally:
            if search_page is not None:
                try:
                    search_page.close()
                except Exception:
                    pass

    def _extract_detail(self, log, region_hint: str = "", search_fallback: bool = True) -> dict:
        """상세 패널(entryIframe)에서 매장명/카테고리/주소/전화번호/링크를 추출."""
        detail = {
            "place_name": "",
            "category": "",
            "address": "",
            "phone": "",
            "homepage_url": "",
            "instagram_url": "",
        }
        page = self._page
        try:
            page.wait_for_selector(ENTRY_IFRAME, timeout=FRAME_TIMEOUT)
        except Exception:
            return detail

        entry = page.frame_locator(ENTRY_IFRAME)
        detail["place_name"] = self._first_text(entry, DETAIL_NAME_SELECTORS)
        detail["category"] = self._first_text(entry, DETAIL_CATEGORY_SELECTORS)
        detail["address"] = self._first_text(entry, DETAIL_ADDRESS_SELECTORS)

        phone = self._first_text(entry, DETAIL_PHONE_SELECTORS)
        if not phone:
            # tel: 링크 폴백
            try:
                tel = entry.locator("a[href^='tel:']").first
                if tel.count() > 0:
                    href = tel.get_attribute("href", timeout=SHORT_TIMEOUT) or ""
                    phone = href.replace("tel:", "").strip()
            except Exception:
                pass
        detail["phone"] = phone

        homepage, instagram = self._extract_links(entry, log)
        detail["homepage_url"] = homepage

        name = detail["place_name"] or ""
        if not instagram and search_fallback:
            instagram = self._search_instagram(name, region_hint, log)
        if not instagram:
            self._log(log, f"    [인스타] 없음: {name or '(이름미상)'}")

        detail["instagram_url"] = instagram
        return detail

    # ---- 메인 수집 ---------------------------------------------------------

    def collect_places(
        self,
        keyword: str,
        settings: dict,
        log=None,
        max_results: int | None = None,
    ) -> list[dict]:
        """키워드 하나에 대해 네이버 지도 검색 결과를 공통 스키마로 수집한다.

        각 매장 카드를 클릭해 상세 패널에서 전화번호/주소까지 추출한다.
        target_count(=max_results)에 도달하면 종료한다.
        """
        if self._page is None:
            raise NaverMapError("start()가 호출되지 않았습니다.")

        def _log(msg: str) -> None:
            if log is not None:
                log.log(msg)

        page = self._page
        results: list[dict] = []
        seen: set[str] = set()

        # 인스타 보조검색용 지역 힌트(검색어의 첫 토큰을 지역으로 사용).
        region_hint = keyword.split()[0] if keyword.split() else ""
        search_fallback = bool(settings.get("instagram_search_fallback", True))

        url = SEARCH_URL_TEMPLATE.format(query=quote(keyword))
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=FRAME_TIMEOUT)
        except Exception as exc:
            _log(f"  - [실패] 페이지 접속 실패: {exc}")
            return results

        self._sleep()

        try:
            page.wait_for_selector(SEARCH_IFRAME, timeout=FRAME_TIMEOUT)
        except Exception:
            _log("  - [경고] 검색 결과 프레임을 찾지 못했습니다(결과 없음 가능).")
            return results

        search = page.frame_locator(SEARCH_IFRAME)

        processed = 0  # 이미 처리한 li 인덱스 수
        empty_rounds = 0

        for _ in range(max(1, self.scroll_count)):
            items = self._list_items(search)
            try:
                total = items.count()
            except Exception:
                total = 0

            new_in_round = 0
            for idx in range(processed, total):
                if max_results is not None and len(results) >= max_results:
                    break

                item = items.nth(idx)
                name = self._first_text(item, LIST_NAME_SELECTORS)
                category = self._first_text(item, LIST_CATEGORY_SELECTORS)
                if not name:
                    continue

                place = {
                    "place_name": name,
                    "phone": "",
                    "address": "",
                    "category": category,
                    "place_url": "",
                    "homepage_url": "",
                    "instagram_url": "",
                }

                # 상세 패널 진입 → 전화번호/주소/링크 추출
                try:
                    link = item.locator(
                        ", ".join(LIST_NAME_SELECTORS)
                    ).first
                    if link.count() == 0:
                        link = item
                    link.click(timeout=SHORT_TIMEOUT)
                    self._sleep()
                    detail = self._extract_detail(
                        log, region_hint=region_hint, search_fallback=search_fallback
                    )
                    place["place_name"] = detail["place_name"] or name
                    place["category"] = detail["category"] or category
                    place["address"] = detail["address"]
                    place["phone"] = detail["phone"]
                    place["homepage_url"] = detail["homepage_url"]
                    place["instagram_url"] = detail["instagram_url"]
                    # 클릭 후 URL이 곧 네이버 플레이스 매장 URL
                    if "/place/" in (page.url or ""):
                        place["place_url"] = page.url
                except Exception as exc:
                    _log(f"    - 상세 추출 건너뜀({name}): {exc}")

                key = place["place_url"] or f"{place['place_name']}|{place['address']}"
                if key in seen:
                    continue
                seen.add(key)
                results.append(place)
                new_in_round += 1

                if max_results is not None and len(results) >= max_results:
                    break

            processed = total

            if max_results is not None and len(results) >= max_results:
                break

            # 더 이상 새 항목이 없으면 몇 번 더 시도하다 종료
            if new_in_round == 0:
                empty_rounds += 1
                if empty_rounds >= 3:
                    break
            else:
                empty_rounds = 0

            self._scroll_list(search)
            self._sleep()

        return results

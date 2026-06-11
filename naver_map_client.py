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

# Playwright는 선택 의존성이다. source="naver_map"일 때만 필요하므로
# import 실패 시 친절한 안내를 위해 여기서 잡아 둔다.
try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - 설치 안내용
    sync_playwright = None


# 네이버 지도 검색 URL (검색어를 경로에 직접 넣는 방식).
SEARCH_URL_TEMPLATE = "https://map.naver.com/p/search/{query}"

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

    def _extract_detail(self, log) -> dict:
        """상세 패널(entryIframe)에서 매장명/카테고리/주소/전화번호를 추출."""
        detail = {"place_name": "", "category": "", "address": "", "phone": ""}
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
                }

                # 상세 패널 진입 → 전화번호/주소 추출
                try:
                    link = item.locator(
                        ", ".join(LIST_NAME_SELECTORS)
                    ).first
                    if link.count() == 0:
                        link = item
                    link.click(timeout=SHORT_TIMEOUT)
                    self._sleep()
                    detail = self._extract_detail(log)
                    place["place_name"] = detail["place_name"] or name
                    place["category"] = detail["category"] or category
                    place["address"] = detail["address"]
                    place["phone"] = detail["phone"]
                    # 클릭 후 URL이 곧 네이버 지도 매장 URL
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

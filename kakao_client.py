"""Kakao Local API 키워드 검색 클라이언트.

공식 키워드 장소 검색 API만 사용한다. 화면 크롤링은 하지 않는다.
GET https://dapi.kakao.com/v2/local/search/keyword.json
"""

from __future__ import annotations

import time

import requests

KAKAO_KEYWORD_SEARCH_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

# Kakao API가 허용하는 페이지당 최대 결과 수.
MAX_PAGE_SIZE = 15

# 단일 HTTP 요청 타임아웃(초).
REQUEST_TIMEOUT = 10


class KakaoApiError(Exception):
    """Kakao API 호출 중 발생한 복구 불가능한 오류."""


class KakaoClient:
    """Kakao Local API 클라이언트.

    API 키는 생성자에서 받는다. 키가 비어 있으면 즉시 오류를 낸다.
    """

    def __init__(self, api_key: str):
        if not api_key or not api_key.strip():
            raise KakaoApiError(
                "KAKAO_REST_API_KEY가 설정되지 않았습니다. "
                ".env 파일에 카카오 REST API 키를 입력해 주세요."
            )
        self.api_key = api_key.strip()
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"KakaoAK {self.api_key}"}
        )

    def search_keyword(self, keyword: str, page: int = 1, size: int = 15) -> dict:
        """Kakao Local API 키워드 검색을 호출하고 응답 JSON(dict)을 반환한다.

        HTTP 오류나 JSON 파싱 실패는 KakaoApiError로 변환한다.
        """
        size = min(max(int(size), 1), MAX_PAGE_SIZE)
        params = {"query": keyword, "page": page, "size": size}

        try:
            response = self.session.get(
                KAKAO_KEYWORD_SEARCH_URL,
                params=params,
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as exc:
            raise KakaoApiError(f"네트워크 오류: {exc}") from exc

        if response.status_code == 401:
            raise KakaoApiError(
                "인증 실패(401): KAKAO_REST_API_KEY가 올바른지 확인해 주세요."
            )
        if response.status_code != 200:
            raise KakaoApiError(
                f"HTTP 오류 {response.status_code}: {response.text[:200]}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise KakaoApiError(f"응답 JSON 파싱 실패: {exc}") from exc

    def collect_places(
        self,
        keyword: str,
        max_pages: int,
        delay_seconds: float,
    ) -> list[dict]:
        """특정 키워드의 여러 페이지를 순회하며 장소(raw document)를 수집한다.

        - 각 페이지 호출 사이에 delay_seconds 만큼 대기한다.
        - 마지막 페이지(is_end)거나 결과가 비면 조기 종료한다.
        - 특정 키워드 수집 중 오류가 나면 KakaoApiError를 그대로 전파한다.
          (호출자가 키워드 단위로 실패 처리)
        """
        places: list[dict] = []

        for page in range(1, max(1, max_pages) + 1):
            data = self.search_keyword(keyword, page=page, size=MAX_PAGE_SIZE)

            documents = data.get("documents", []) or []
            places.extend(documents)

            meta = data.get("meta", {}) or {}
            # is_end가 True거나, 더 이상 문서가 없으면 종료
            if meta.get("is_end", True) or not documents:
                break

            # API 호출 사이 대기 (마지막 페이지가 아닐 때만)
            if delay_seconds > 0:
                time.sleep(delay_seconds)

        return places

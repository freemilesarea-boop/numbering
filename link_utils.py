"""링크 분류/디코딩 유틸 (브라우저 비의존, 단위 테스트 가능).

네이버 플레이스 상세에서 긁어온 a[href] 들을 분류한다.
- 네이버 리다이렉트/공유 URL이면 실제 외부 URL로 디코딩
- instagram.com / instagr.am / threads.net → 인스타그램 링크
- 네이버 내부/타 소셜 → 제외
- 그 외 외부 링크 → 홈페이지 후보
- 검색 결과 텍스트에서 인스타그램 프로필 URL 추출
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit

# 인스타그램 계열 호스트(스레드 포함).
INSTAGRAM_HOSTS = ("instagram.com", "instagr.am", "threads.net")

# 리다이렉트 URL에서 실제 목적지를 담는 쿼리 키 후보.
REDIRECT_PARAMS = (
    "url", "u", "outurl", "outlink", "link", "target",
    "redirect", "landingurl", "returl", "to", "dest",
)

# 홈페이지 후보에서 제외할 네이버 내부 호스트 조각.
NAVER_INTERNAL = (
    "naver.com", "naver.me", "pstatic.net", "navercorp.com",
    "place.naver", "map.naver", "booking.naver", "blog.naver",
    "cafe.naver", "shopping.naver", "smartstore.naver", "pcmap",
    "nid.naver", "search.naver", "m.place.naver",
)

# 홈페이지로 보지 않는 타 소셜/메신저 호스트 조각(인스타는 별도 분류).
SOCIAL_NON_HOMEPAGE = (
    "facebook.com", "fb.com", "youtube.com", "youtu.be",
    "twitter.com", "x.com", "tiktok.com", "kakao.com",
    "pf.kakao", "band.us", "blog.me",
)

# 인스타그램에서 프로필이 아닌 예약 경로(첫 path 세그먼트).
_RESERVED_IG_SEGMENTS = {
    "p", "reel", "reels", "explore", "stories", "tv", "accounts",
    "about", "developer", "legal", "directory", "web", "graphql",
    "challenge", "session",
}

_IG_REGEX = re.compile(
    r"(?:https?:)?//(?:www\.|m\.)?(?:instagram\.com|instagr\.am|threads\.net)"
    r"/[A-Za-z0-9_.@][A-Za-z0-9_./@%-]*",
    re.IGNORECASE,
)


def _ensure_scheme(url: str) -> str:
    """스킴이 없으면 https://를 붙인다(프로토콜 상대경로 포함)."""
    url = (url or "").strip()
    if not url:
        return ""
    if url.startswith("//"):
        return "https:" + url
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", url):
        # 'instagram.com/foo' 처럼 스킴 없는 호스트형이면 https 부여
        if "." in url.split("/")[0]:
            return "https://" + url
    return url


def _host(url: str) -> str:
    try:
        return urlsplit(_ensure_scheme(url)).netloc.lower()
    except ValueError:
        return ""


def decode_redirect(href: str, _depth: int = 0) -> str:
    """네이버 등 리다이렉트/공유 URL이면 실제 외부 URL을 디코딩해서 반환한다.

    예) https://cross.naver.com/redirect?...&url=https%3A%2F%2Finstagram.com%2Fx
        → https://instagram.com/x
    중첩 인코딩도 몇 단계까지 풀어준다.
    """
    href = _ensure_scheme(href)
    if not href or _depth > 5:
        return href

    parts = urlsplit(href)
    host = parts.netloc.lower()
    looks_like_redirector = ("naver" in host) or (
        "redirect" in (parts.path + "?" + parts.query).lower()
    )
    if parts.query and looks_like_redirector:
        qs = parse_qs(parts.query)
        for key in REDIRECT_PARAMS:
            for actual_key in (key, key.lower(), key.upper()):
                if actual_key in qs and qs[actual_key]:
                    candidate = unquote(qs[actual_key][0])
                    if candidate.startswith(("http", "//")):
                        return decode_redirect(candidate, _depth + 1)
    return href


def is_instagram_url(url: str) -> bool:
    """인스타그램/스레드 호스트인지 판별한다."""
    host = _host(url)
    if not host:
        return False
    return any(host == d or host.endswith("." + d) for d in INSTAGRAM_HOSTS)


def _is_profile_instagram(url: str) -> bool:
    """게시물/예약 경로가 아닌 '프로필' 링크로 보이는지."""
    parts = urlsplit(_ensure_scheme(url))
    if parts.netloc.lower().endswith("threads.net"):
        return True
    segments = [s for s in parts.path.split("/") if s]
    if not segments:
        return False
    first = segments[0].lower().lstrip("@")
    return first not in _RESERVED_IG_SEGMENTS


def normalize_instagram_url(url: str) -> str:
    """추적 쿼리/프래그먼트를 제거하고 https 정규형으로 만든다."""
    url = _ensure_scheme(url)
    parts = urlsplit(url)
    netloc = parts.netloc.lower() or ""
    path = parts.path.rstrip("/")
    if not netloc:
        return ""
    return urlunsplit(("https", netloc, path, "", ""))


def classify_link(raw_href: str) -> tuple[str, str]:
    """원본 href 하나를 (종류, 정규화 URL)로 분류한다.

    종류: 'instagram' | 'homepage' | 'exclude'
    - 먼저 네이버 리다이렉트를 디코딩한 실제 URL로 판단한다.
    """
    url = decode_redirect(raw_href)
    if not url or not url.startswith(("http", "//")):
        return ("exclude", "")
    url = _ensure_scheme(url)

    if is_instagram_url(url):
        norm = normalize_instagram_url(url)
        # 게시물(/p/), 릴스, 예약 경로 등 비(非)프로필 링크는 저장하지 않는다.
        if _is_profile_instagram(norm):
            return ("instagram", norm)
        return ("exclude", norm)

    host = _host(url)
    if not host:
        return ("exclude", url)
    if any(token in host for token in NAVER_INTERNAL):
        return ("exclude", url)
    if any(token in host for token in SOCIAL_NON_HOMEPAGE):
        return ("exclude", url)
    return ("homepage", url)


def extract_instagram_from_text(text: str) -> str:
    """검색 결과 텍스트(HTML/문자열)에서 인스타그램 프로필 URL을 추출한다.

    네이버 리다이렉트로 감싸진 경우도 디코딩해서 본다.
    프로필형을 우선 반환하고, 없으면 첫 인스타 URL을 반환한다.
    """
    if not text:
        return ""

    candidates: list[str] = []

    # 1) 네이버 검색 결과의 리다이렉트 URL 안에 인스타 주소가 인코딩된 경우
    for m in re.finditer(r"https?[^\s\"'<>]+", text):
        decoded = decode_redirect(m.group(0))
        if is_instagram_url(decoded):
            candidates.append(normalize_instagram_url(decoded))

    # 2) 본문에 직접 노출된 인스타 URL
    for m in _IG_REGEX.finditer(text):
        candidates.append(normalize_instagram_url(m.group(0)))

    # 프로필형 우선
    for url in candidates:
        if url and _is_profile_instagram(url):
            return url
    for url in candidates:
        if url:
            return url
    return ""

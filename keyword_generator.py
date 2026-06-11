"""검색 키워드 생성 모듈.

지역(region)과 업종(business_type)을 조합해서 Kakao Local API에 던질
검색 키워드 리스트를 만든다. 지역별 별칭(REGION_ALIASES)을 활용해
"성수 카페" 하나가 아니라 "성수동 카페", "서울숲 카페" 등으로 확장한다.
"""

from __future__ import annotations

# 지역명 -> 확장 키워드(별칭) 목록.
# 첫 번째 원소는 보통 입력값 자신을 포함하지만, 입력값은 어차피
# 기본 키워드로 항상 추가되므로 여기서는 검색 범위를 넓혀줄 별칭들을 둔다.
REGION_ALIASES: dict[str, list[str]] = {
    "성수": ["성수", "성수동", "성수역", "서울숲", "뚝섬"],
    "강남": ["강남", "강남역", "역삼", "신논현", "논현"],
    "홍대": ["홍대", "홍대입구", "연남", "합정", "상수"],
    "송파": ["송파", "잠실", "석촌", "문정", "가락"],
}


def generate_keywords(
    region: str,
    business_type: str,
    extra_keywords: list[str] | None = None,
) -> list[str]:
    """지역 + 업종 기반 검색 키워드 목록을 만든다.

    순서:
    1. 기본 키워드 "{region} {business_type}"
    2. REGION_ALIASES에 등록된 별칭 각각에 업종을 붙인 키워드
    3. config에서 사용자가 직접 넣은 extra_keywords

    중복은 입력 순서를 보존하면서 제거한다.
    """
    region = (region or "").strip()
    business_type = (business_type or "").strip()

    keywords: list[str] = []

    # 1. 기본 키워드
    if region and business_type:
        keywords.append(f"{region} {business_type}")
    elif region:
        keywords.append(region)
    elif business_type:
        keywords.append(business_type)

    # 2. 지역 별칭 확장
    for alias in REGION_ALIASES.get(region, []):
        alias = alias.strip()
        if not alias:
            continue
        if business_type:
            keywords.append(f"{alias} {business_type}")
        else:
            keywords.append(alias)

    # 3. 사용자 추가 키워드
    for extra in extra_keywords or []:
        extra = (extra or "").strip()
        if extra:
            keywords.append(extra)

    # 순서를 유지하면서 중복 제거
    seen: set[str] = set()
    unique_keywords: list[str] = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique_keywords.append(kw)

    return unique_keywords

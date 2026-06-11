"""중복 제거 모듈.

정규화된 레코드(dict) 리스트를 받아 중복을 제거한다.

중복 판정 기준:
1순위: 전화번호(숫자만 추출) 일치
2순위: 전화번호가 없으면 (매장명 + 주소) 정규화 후 일치
"""

from __future__ import annotations

import re

# 매장명/주소 정규화 시 제거할 특수문자(공백은 별도 처리).
_SPECIAL_CHARS = re.compile(r"[\s\-_.,()\[\]{}'\"~!@#$%^&*+=/\\|<>?:;]")


def normalize_phone(phone: str | None) -> str:
    """전화번호에서 숫자만 남긴다. 예) '02-123-4567' -> '021234567'."""
    if not phone:
        return ""
    return re.sub(r"\D", "", phone)


def normalize_text(text: str | None) -> str:
    """매장명/주소 비교용 정규화. 공백/특수문자 제거 + 소문자 변환."""
    if not text:
        return ""
    return _SPECIAL_CHARS.sub("", text).lower()


def _dedupe_key(record: dict) -> str:
    """레코드 하나의 중복 판정 키를 만든다."""
    phone = normalize_phone(record.get("전화번호"))
    if phone:
        return f"phone:{phone}"

    name = normalize_text(record.get("매장명"))
    address = normalize_text(record.get("주소"))
    return f"na:{name}|{address}"


def dedupe(records: list[dict]) -> tuple[list[dict], dict]:
    """중복을 제거하고 (결과 리스트, 통계 dict)를 반환한다.

    통계 dict 키:
        original_count  : 원본 수집 수
        removed_count   : 중복 제거 수
        final_count     : 최종 저장 수
        with_phone      : 전화번호 있는 매장 수(최종 기준)
        without_phone   : 전화번호 없는 매장 수(최종 기준)
    """
    seen: set[str] = set()
    result: list[dict] = []

    for record in records:
        key = _dedupe_key(record)
        if key in seen:
            continue
        seen.add(key)
        result.append(record)

    with_phone = sum(1 for r in result if normalize_phone(r.get("전화번호")))
    without_phone = len(result) - with_phone

    stats = {
        "original_count": len(records),
        "removed_count": len(records) - len(result),
        "final_count": len(result),
        "with_phone": with_phone,
        "without_phone": without_phone,
    }

    return result, stats

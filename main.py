"""numbering - 로컬 실행형 리드 수집 도구.

config.json의 jobs를 읽어 지역+업종 기반으로 Kakao Local API를 호출하고,
중복을 제거한 뒤 영업용 엑셀 리스트를 만든다.

실행:
    python main.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date

from dotenv import load_dotenv

from dedupe import dedupe, normalize_phone
from excel_exporter import export_to_excel
from kakao_client import KakaoApiError, KakaoClient
from keyword_generator import generate_keywords
from logger import RunLogger

CONFIG_PATH = "config.json"
CONFIG_EXAMPLE_PATH = "config.example.json"


def load_config(path: str = CONFIG_PATH) -> dict:
    """config.json을 로드한다. 없으면 복사 안내 후 종료한다."""
    if not os.path.exists(path):
        print(f"[오류] 설정 파일 '{path}'을(를) 찾을 수 없습니다.")
        print(f"       다음 명령으로 예시 설정을 복사한 뒤 수정해 주세요:")
        print(f"       cp {CONFIG_EXAMPLE_PATH} {path}")
        sys.exit(1)

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[오류] 설정 파일 '{path}' 읽기 실패: {exc}")
        sys.exit(1)


def normalize_record(doc: dict, region: str, business_type: str, keyword: str) -> dict:
    """Kakao API 응답 1건을 내부 표준 레코드로 변환한다."""
    return {
        "수집일": date.today().isoformat(),
        "지역": region,
        "업종": business_type,
        "검색키워드": keyword,
        "매장명": doc.get("place_name", ""),
        "전화번호": doc.get("phone", ""),
        "주소": doc.get("road_address_name") or doc.get("address_name", ""),
        "카테고리": doc.get("category_name", ""),
        "지도URL": doc.get("place_url", ""),
        "영업상태": "미접촉",
        "메모": "",
        "최근연락일": "",
        "다음연락일": "",
        "담당자": "",
    }


def run_job(job: dict, settings: dict, client: KakaoClient, log) -> bool:
    """단일 job을 실행한다. 성공하면 True, 실패하면 False를 반환한다."""
    region = job.get("region", "").strip()
    business_type = job.get("business_type", "").strip()
    target_count = int(job.get("target_count", 0) or 0)
    extra_keywords = job.get("extra_keywords", []) or []

    if not region or not business_type:
        log.log(f"[건너뜀] region/business_type이 비어 있는 작업: {job}")
        return False

    max_pages = int(settings.get("max_pages_per_keyword", 3) or 3)
    delay_seconds = float(settings.get("delay_seconds", 0.25) or 0)
    require_phone = bool(settings.get("require_phone", False))
    output_dir = settings.get("output_dir", "output")

    keywords = generate_keywords(region, business_type, extra_keywords)

    log.log("")
    log.log(f"작업: {region} / {business_type} / 목표 {target_count}개")

    collected: list[dict] = []
    for keyword in keywords:
        if target_count > 0 and len(collected) >= target_count:
            break

        log.log(f"검색 키워드: {keyword}")
        try:
            docs = client.collect_places(keyword, max_pages, delay_seconds)
        except KakaoApiError as exc:
            log.log(f"  - [실패] {keyword}: {exc}")
            continue

        count = 0
        for doc in docs:
            record = normalize_record(doc, region, business_type, keyword)
            if require_phone and not normalize_phone(record.get("전화번호")):
                continue
            collected.append(record)
            count += 1

        log.log(f"  - 수집: {count}개")

    if not collected:
        log.log("  - 수집된 매장이 없습니다. 엑셀을 생성하지 않습니다.")
        return False

    deduped, stats = dedupe(collected)

    try:
        path = export_to_excel(deduped, stats, region, business_type, output_dir)
    except Exception as exc:  # 엑셀 저장 실패도 작업 단위 실패로 처리
        log.log(f"  - [실패] 엑셀 저장 중 오류: {exc}")
        return False

    log.log("")
    log.log(f"원본 수집 수: {stats['original_count']}")
    log.log(f"중복 제거 수: {stats['removed_count']}")
    log.log(f"최종 저장 수: {stats['final_count']}")
    log.log(f"전화번호 있음: {stats['with_phone']}")
    log.log(f"전화번호 없음: {stats['without_phone']}")
    log.log(f"저장 파일: {path}")
    return True


def main() -> None:
    load_dotenv()
    api_key = os.getenv("KAKAO_REST_API_KEY", "")

    config = load_config()
    settings = config.get("settings", {}) or {}
    jobs = config.get("jobs", []) or []

    output_dir = settings.get("output_dir", "output")
    os.makedirs(output_dir, exist_ok=True)

    log = RunLogger(output_dir)
    log.log("==============================")
    log.log("numbering lead collector")
    log.log("==============================")
    log.log(f"[numbering 실행 시작] {date.today().isoformat()}")

    # API 키 확인 - 누락 시 친절한 메시지 출력 후 종료
    try:
        client = KakaoClient(api_key)
    except KakaoApiError as exc:
        log.log(f"[오류] {exc}")
        log.flush()
        sys.exit(1)

    if not jobs:
        log.log("[경고] 실행할 작업(jobs)이 없습니다. config.json을 확인해 주세요.")
        log.flush()
        sys.exit(0)

    success_count = 0
    for idx, job in enumerate(jobs, start=1):
        region = job.get("region", "?")
        business_type = job.get("business_type", "?")
        log.log("")
        log.log(f"[{idx}/{len(jobs)}] {region} {business_type} 수집 시작")
        try:
            if run_job(job, settings, client, log):
                success_count += 1
        except Exception as exc:  # 특정 job 실패가 전체를 막지 않도록
            log.log(f"  - [실패] 작업 처리 중 예기치 못한 오류: {exc}")

    log.log("")
    log.log(f"전체 작업 완료 (성공 {success_count}/{len(jobs)})")
    log.log("[numbering 실행 완료]")
    log.flush()


if __name__ == "__main__":
    main()

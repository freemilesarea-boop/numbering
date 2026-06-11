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

import database
from dedupe import dedupe, normalize_phone
from excel_exporter import export_to_excel
from kakao_client import KakaoApiError, KakaoClient
from keyword_generator import generate_keywords
from logger import RunLogger

CONFIG_PATH = "config.json"
CONFIG_EXAMPLE_PATH = "config.example.json"

# 지원하는 수집 소스
SOURCE_KAKAO = "kakao"
SOURCE_NAVER = "naver_map"
DEFAULT_SOURCE = SOURCE_KAKAO


def build_client(source: str, settings: dict, log):
    """source에 맞는 수집기를 생성해 반환한다.

    - kakao: KAKAO_REST_API_KEY가 필요(.env). 없으면 종료.
    - naver_map: API 키 없이 동작. Playwright 필요.
    실패 시 친절한 메시지를 출력하고 프로그램을 종료한다.
    """
    if source == SOURCE_KAKAO:
        api_key = os.getenv("KAKAO_REST_API_KEY", "")
        try:
            return KakaoClient(api_key)
        except KakaoApiError as exc:
            log.log(f"[오류] {exc}")
            log.flush()
            sys.exit(1)

    if source == SOURCE_NAVER:
        # Playwright는 선택 의존성이라 여기서 지연 import 한다.
        try:
            from naver_map_client import NaverMapClient, NaverMapError
        except ImportError as exc:
            log.log(f"[오류] 네이버 지도 수집기 로드 실패: {exc}")
            log.log("       pip install playwright && playwright install chromium")
            log.flush()
            sys.exit(1)
        try:
            return NaverMapClient(settings)
        except NaverMapError as exc:
            log.log(f"[오류] {exc}")
            log.flush()
            sys.exit(1)

    log.log(
        f"[오류] 알 수 없는 source '{source}'. "
        f"'{SOURCE_KAKAO}' 또는 '{SOURCE_NAVER}' 중 하나를 사용하세요."
    )
    log.flush()
    sys.exit(1)


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


def _classify_phone(phone: str) -> tuple[str, str]:
    """전화번호를 (안심번호, 일반전화번호)로 분리한다.

    0507로 시작하는 번호는 네이버 안심번호(가상번호)이므로 안심번호로,
    그 외 실제 전화번호는 일반전화번호로 분류한다.
    """
    digits = normalize_phone(phone)
    if digits.startswith("0507"):
        return phone, ""
    if phone:
        return "", phone
    return "", ""


def normalize_record(place: dict, region: str, business_type: str, keyword: str) -> dict:
    """공통 place 스키마 1건을 내부 표준 레코드로 변환한다.

    place 키: place_name, phone, address, category, place_url,
              homepage_url, instagram_url
    (Kakao/네이버 어떤 수집기든 동일한 공통 스키마로 들어온다.)
    """
    phone = place.get("phone", "") or ""
    safe_phone, normal_phone = _classify_phone(phone)

    homepage = (place.get("homepage_url", "") or "").strip()
    instagram = (place.get("instagram_url", "") or "").strip()
    # 홈페이지로 인스타그램 주소가 잡힌 경우 인스타그램 칸으로 옮긴다.
    if not instagram and "instagram.com" in homepage.lower():
        instagram, homepage = homepage, ""

    place_url = (place.get("place_url", "") or "").strip()
    # 네이버 플레이스 링크만 별도 컬럼에 저장(카카오 링크는 제외).
    naver_place = place_url if ("naver." in place_url.lower()) else ""

    return {
        "수집일": date.today().isoformat(),
        "지역": region,
        "업종": business_type,
        "검색키워드": keyword,
        "매장명": place.get("place_name", ""),
        "전화번호": phone,
        "안심번호": safe_phone,
        "일반전화번호": normal_phone,
        "주소": place.get("address", ""),
        "카테고리": place.get("category", ""),
        "네이버플레이스": naver_place,
        "홈페이지": homepage,
        "인스타그램": instagram,
        "지도URL": place_url,
        "status": "NEW",
        "영업상태": "미접촉",
        "메모": "",
        "최근연락일": "",
        "다음연락일": "",
        "담당자": "",
    }


def run_job(job: dict, settings: dict, client: KakaoClient, conn, log) -> bool:
    """단일 job을 실행한다. 성공하면 True, 실패하면 False를 반환한다."""
    region = job.get("region", "").strip()
    business_type = job.get("business_type", "").strip()
    target_count = int(job.get("target_count", 0) or 0)
    extra_keywords = job.get("extra_keywords", []) or []

    if not region or not business_type:
        log.log(f"[건너뜀] region/business_type이 비어 있는 작업: {job}")
        return False

    require_phone = bool(settings.get("require_phone", False))
    output_dir = settings.get("output_dir", "output")
    export_only_new = bool(settings.get("export_only_new", False))

    keywords = generate_keywords(region, business_type, extra_keywords)

    log.log("")
    log.log(f"작업: {region} / {business_type} / 목표 {target_count}개")

    collected: list[dict] = []
    for keyword in keywords:
        if target_count > 0 and len(collected) >= target_count:
            break

        # 남은 목표 수만큼만 더 수집하도록 수집기에 상한을 전달
        remaining = None
        if target_count > 0:
            remaining = target_count - len(collected)

        log.log(f"검색 키워드: {keyword}")
        try:
            places = client.collect_places(
                keyword, settings, log, max_results=remaining
            )
        except Exception as exc:  # 키워드 단위 실패는 전체를 막지 않는다
            log.log(f"  - [실패] {keyword}: {exc}")
            continue

        count = 0
        for place in places:
            record = normalize_record(place, region, business_type, keyword)
            if require_phone and not normalize_phone(record.get("전화번호")):
                continue
            collected.append(record)
            count += 1
            if target_count > 0 and len(collected) >= target_count:
                break

        log.log(f"  - 수집: {count}개")

    if not collected:
        log.log("  - 수집된 매장이 없습니다. 엑셀을 생성하지 않습니다.")
        return False

    deduped, stats = dedupe(collected)

    # DB upsert: 신규/기존 판별 + DB에 영속 저장된 status 반영
    new_count = 0
    existing_count = 0
    for record in deduped:
        result = database.upsert_lead(conn, record)
        record["status"] = result.status  # DB의 영속 status를 엑셀에 반영
        record["_is_new"] = result.is_new  # 내부 플래그(엑셀에는 출력 안 됨)
        if result.is_new:
            new_count += 1
        else:
            existing_count += 1

    stats["new_count"] = new_count
    stats["existing_count"] = existing_count

    # export_only_new=true면 기존 리드는 엑셀에서 제외
    if export_only_new:
        export_records = [r for r in deduped if r.get("_is_new")]
    else:
        export_records = deduped

    if not export_records:
        log.log("")
        log.log(f"원본 수집 수: {stats['original_count']}")
        log.log(f"중복 제거 수: {stats['removed_count']}")
        log.log(f"최종 저장 수: {stats['final_count']}")
        log.log(f"신규 리드: {new_count} / 기존 리드: {existing_count}")
        log.log("  - 엑셀로 내보낼 신규 리드가 없습니다. (export_only_new=true)")
        return True

    try:
        path = export_to_excel(
            export_records, stats, region, business_type, output_dir
        )
    except Exception as exc:  # 엑셀 저장 실패도 작업 단위 실패로 처리
        log.log(f"  - [실패] 엑셀 저장 중 오류: {exc}")
        return False

    log.log("")
    log.log(f"원본 수집 수: {stats['original_count']}")
    log.log(f"중복 제거 수: {stats['removed_count']}")
    log.log(f"최종 저장 수: {stats['final_count']}")
    log.log(f"신규 리드: {new_count} / 기존 리드: {existing_count}")
    if export_only_new:
        log.log(f"엑셀 출력(신규만): {len(export_records)}개")
    log.log(f"전화번호 있음: {stats['with_phone']}")
    log.log(f"전화번호 없음: {stats['without_phone']}")
    log.log(f"저장 파일: {path}")
    return True


def main() -> None:
    load_dotenv()

    config = load_config()
    settings = config.get("settings", {}) or {}
    jobs = config.get("jobs", []) or []

    source = settings.get("source", DEFAULT_SOURCE)
    output_dir = settings.get("output_dir", "output")
    os.makedirs(output_dir, exist_ok=True)

    log = RunLogger(output_dir)
    log.log("==============================")
    log.log("numbering lead collector")
    log.log("==============================")
    log.log(f"[numbering 실행 시작] {date.today().isoformat()}")
    log.log(f"수집 소스: {source}")

    if not jobs:
        log.log("[경고] 실행할 작업(jobs)이 없습니다. config.json을 확인해 주세요.")
        log.flush()
        sys.exit(0)

    # source에 맞는 수집기 생성(키/의존성 누락 시 내부에서 친절히 종료)
    client = build_client(source, settings, log)

    # SQLite 연결 (leads.db / leads 테이블 보장)
    db_path = settings.get("db_path", database.DEFAULT_DB_PATH)
    conn = database.connect(db_path)

    success_count = 0
    try:
        client.start()  # 네이버: 브라우저 기동 / 카카오: no-op
        for idx, job in enumerate(jobs, start=1):
            region = job.get("region", "?")
            business_type = job.get("business_type", "?")
            log.log("")
            log.log(f"[{idx}/{len(jobs)}] {region} {business_type} 수집 시작")
            try:
                if run_job(job, settings, client, conn, log):
                    success_count += 1
            except Exception as exc:  # 특정 job 실패가 전체를 막지 않도록
                log.log(f"  - [실패] 작업 처리 중 예기치 못한 오류: {exc}")
    finally:
        try:
            client.close()
        except Exception:
            pass
        conn.close()

    log.log("")
    log.log(f"전체 작업 완료 (성공 {success_count}/{len(jobs)})")
    log.log("[numbering 실행 완료]")
    log.flush()


if __name__ == "__main__":
    main()

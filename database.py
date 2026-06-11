"""SQLite 저장 모듈.

수집한 매장(리드)을 leads.db의 leads 테이블에 upsert한다.

중복(동일 리드) 판정 기준은 dedupe 모듈과 동일하다.
- 전화번호가 있으면 숫자만 추출한 전화번호
- 없으면 매장명 + 주소 정규화 값

영업상태(status)는 DB에 영속 저장되며, 같은 리드를 다시 수집해도
기존 status를 유지한다. first_collected_at / last_collected_at으로
최초/최근 수집 시각을 추적한다.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import NamedTuple

from dedupe import _dedupe_key

DEFAULT_DB_PATH = "leads.db"

# 영업상태 허용 값. 기본값은 NEW.
STATUS_NEW = "NEW"
ALLOWED_STATUSES = (
    "NEW",
    "CONTACTED",
    "INTERESTED",
    "TRIAL",
    "CUSTOMER",
    "REJECTED",
)


class UpsertResult(NamedTuple):
    """upsert 결과. is_new=True면 이번에 새로 들어온 리드."""

    is_new: bool
    status: str


def connect(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """DB에 연결하고 테이블을 보장한 뒤 커넥션을 반환한다."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """leads 테이블을 생성한다(없을 때만)."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            dedupe_key          TEXT UNIQUE NOT NULL,
            region              TEXT,
            business_type       TEXT,
            search_keyword      TEXT,
            place_name          TEXT,
            phone               TEXT,
            address             TEXT,
            category            TEXT,
            place_url           TEXT,
            status              TEXT NOT NULL DEFAULT 'NEW',
            memo                TEXT DEFAULT '',
            last_contact_date   TEXT DEFAULT '',
            next_contact_date   TEXT DEFAULT '',
            assignee            TEXT DEFAULT '',
            first_collected_at  TEXT NOT NULL,
            last_collected_at   TEXT NOT NULL
        )
        """
    )
    conn.commit()


def upsert_lead(conn: sqlite3.Connection, record: dict) -> UpsertResult:
    """레코드 1건을 upsert한다.

    - 기존 리드면: last_collected_at과 일부 정보 필드만 갱신하고
      status / first_collected_at은 보존한다. is_new=False 반환.
    - 신규 리드면: status=NEW로 새로 삽입한다. is_new=True 반환.

    반환되는 status는 DB에 저장된(또는 저장될) 최종 status 값이다.
    """
    key = _dedupe_key(record)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    row = conn.execute(
        "SELECT status FROM leads WHERE dedupe_key = ?", (key,)
    ).fetchone()

    if row is not None:
        # 기존 리드: 최근 수집 시각 + 변동 가능한 정보 필드 갱신
        conn.execute(
            """
            UPDATE leads
               SET region = ?,
                   business_type = ?,
                   search_keyword = ?,
                   place_name = ?,
                   phone = ?,
                   address = ?,
                   category = ?,
                   place_url = ?,
                   last_collected_at = ?
             WHERE dedupe_key = ?
            """,
            (
                record.get("지역", ""),
                record.get("업종", ""),
                record.get("검색키워드", ""),
                record.get("매장명", ""),
                record.get("전화번호", ""),
                record.get("주소", ""),
                record.get("카테고리", ""),
                record.get("지도URL", ""),
                now,
                key,
            ),
        )
        conn.commit()
        return UpsertResult(is_new=False, status=row["status"])

    # 신규 리드 삽입
    conn.execute(
        """
        INSERT INTO leads (
            dedupe_key, region, business_type, search_keyword,
            place_name, phone, address, category, place_url,
            status, first_collected_at, last_collected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            key,
            record.get("지역", ""),
            record.get("업종", ""),
            record.get("검색키워드", ""),
            record.get("매장명", ""),
            record.get("전화번호", ""),
            record.get("주소", ""),
            record.get("카테고리", ""),
            record.get("지도URL", ""),
            STATUS_NEW,
            now,
            now,
        ),
    )
    conn.commit()
    return UpsertResult(is_new=True, status=STATUS_NEW)

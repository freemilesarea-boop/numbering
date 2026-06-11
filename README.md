# numbering

`지역 + 업종`을 입력하면 매장 정보를 자동 검색해 **영업용 엑셀 리스트**로
정리해 주는 로컬 실행형 리드 수집 도구입니다.

퇴근 전에 실행해두면, 다음 날 출근 시 바로 영업 가능한 매장 리스트가
`output/` 폴더에 엑셀로 준비됩니다.

```
지역: 성수
업종: 카페
목표 수집 수: 300개

실행 결과:
output/leads_성수_카페_2026-06-11.xlsx
```

## 동작 방식

수집 소스(`settings.source`)를 두 가지 중에서 선택할 수 있습니다.

| source | 방식 | API 키 | 비고 |
|---|---|---|---|
| `naver_map` | **네이버 지도 브라우저 자동화(Playwright)** | 불필요 | 기본 예시. 브라우저로 검색 결과를 스크롤하며 수집 |
| `kakao` | **Kakao Local API**(공식 키워드 장소 검색) | 필요(`.env`) | `GET /v2/local/search/keyword.json` |

어느 소스든 **수집 → 중복 제거 → SQLite 저장 → 엑셀 생성 → 로그 저장**의
동일한 흐름으로 동작하며, dedupe/database/excel_exporter 구조를 공유합니다.

> ⚠️ `naver_map`은 네이버 지도 화면을 자동화하는 방식이라 네이버의 약관 및
> DOM 구조 변경에 영향을 받습니다. 셀렉터가 바뀌면 `naver_map_client.py`의
> `*_SELECTORS` 상수를 갱신해야 할 수 있습니다.

## 설치 및 실행

```bash
# 1. 패키지 설치
pip install -r requirements.txt

# 2. (naver_map 사용 시) Playwright 브라우저 설치 — 최초 1회
playwright install chromium

# 3. 환경변수 파일 생성 (.env.example을 복사) — kakao 소스에서만 필요
cp .env.example .env

# 4. 설정 파일 생성
cp config.example.json config.json

# 5. 실행
python main.py
```

> `source="naver_map"`이면 API 키 없이 바로 실행됩니다(3번 단계 생략 가능).
> `source="kakao"`이면 아래 `.env` 설정이 필요합니다.

### `.env` 설정 (필수)

카카오 REST API 키는 **반드시 `.env` 파일**을 통해 주입합니다. 키를 코드나
`config.json`에 직접 넣지 마세요. (`.env`는 `.gitignore`에 등록되어 커밋되지
않습니다.)

1. 예시 파일을 복사합니다.

   ```bash
   cp .env.example .env
   ```

2. 복사된 `.env`를 열고 발급받은 실제 키로 값을 바꿉니다.

   `.env.example` (복사 전, 그대로 두기):

   ```env
   KAKAO_REST_API_KEY=your_kakao_rest_api_key_here
   ```

   `.env` (복사 후, 실제 키로 교체):

   ```env
   KAKAO_REST_API_KEY=a1b2c3d4e5f6...   # 본인의 실제 REST API 키
   ```

3. 키 발급: [Kakao Developers](https://developers.kakao.com) → 애플리케이션
   추가 → **앱 키 > REST API 키**를 복사해 위 `.env`에 붙여넣습니다.

> 키가 비어 있거나 잘못되면 실행 시 `KAKAO_REST_API_KEY가 설정되지 않았습니다`
> 또는 `인증 실패(401)` 메시지가 출력됩니다.

## 설정 파일 (`config.json`)

```json
{
  "settings": {
    "source": "naver_map",
    "headless": false,
    "delay_seconds": 1.0,
    "scroll_count": 30,
    "max_pages_per_keyword": 3,
    "require_phone": true,
    "export_only_new": true,
    "output_dir": "output",
    "db_path": "leads.db"
  },
  "jobs": [
    {
      "region": "성수",
      "business_type": "카페",
      "target_count": 300,
      "extra_keywords": ["성수동 카페", "서울숲 카페", "뚝섬 카페"]
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `source` | 수집 소스: `naver_map`(브라우저 자동화) 또는 `kakao`(API). 미지정 시 `kakao` |
| `headless` | (naver_map 전용) `false`면 브라우저 창이 보이게 실행 |
| `delay_seconds` | 요청/동작 사이 대기 시간(초). 너무 빠른 수집 방지 |
| `scroll_count` | (naver_map 전용) 검색 결과 목록 최대 스크롤 횟수 |
| `instagram_search_fallback` | (naver_map 전용) 상세에 인스타 링크가 없으면 `업체명+지역+인스타그램`으로 보조 검색. 기본 `true` |
| `max_pages_per_keyword` | (kakao 전용) 검색어 하나당 최대 페이지 수 (페이지당 최대 15개) |
| `require_phone` | `true`면 전화번호 없는 매장은 제외 |
| `output_dir` | 엑셀/로그 저장 폴더 |
| `export_only_new` | `true`면 이미 DB에 있던 기존 리드는 엑셀에서 제외(신규만 출력) |
| `db_path` | SQLite DB 파일 경로 (기본 `leads.db`) |
| `jobs` | 수집 작업 목록 |
| `region` | 지역명 |
| `business_type` | 업종명 |
| `target_count` | 목표 수집 개수(수집 시도 기준) |
| `extra_keywords` | 사용자가 추가하는 검색어 |

## 산출물

- **엑셀**: `output/leads_{지역}_{업종}_{YYYY-MM-DD}.xlsx`
  - 시트: `전체리스트` / `전화번호있음` / `전화번호없음` / `요약`
  - 컬럼: 수집일, 지역, 업종, 검색키워드, 매장명, 전화번호, **안심번호**,
    **일반전화번호**, 주소, 카테고리, **네이버플레이스**, **홈페이지**,
    **인스타그램**, 지도URL, status, 영업상태, 메모, 최근연락일,
    다음연락일, 담당자
  - 헤더 고정, 필터, 컬럼 너비 자동 조정, 링크 컬럼 하이퍼링크
- **로그**: `output/run_log_{YYYY-MM-DD_HHMMSS}.txt`

### 전화번호 / 링크 컬럼 설명

| 컬럼 | 설명 |
|---|---|
| `전화번호` | 수집된 원본 전화번호(분류 전, 중복 제거·필터 기준) |
| `안심번호` | `0507`로 시작하는 네이버 안심번호(가상번호)만 분리 |
| `일반전화번호` | `0507`이 아닌 실제 전화번호만 분리 |
| `네이버플레이스` | 네이버 플레이스 매장 링크(`map.naver.com` 등) |
| `홈페이지` | 매장 홈페이지 링크(네이버 내부/소셜 링크는 제외) |
| `인스타그램` | 인스타그램/스레드 **프로필** 링크(클릭 가능한 하이퍼링크) |
| `지도URL` | 수집 소스의 매장 지도 링크(네이버/카카오 공통) |

> 홈페이지/인스타그램은 `naver_map` 소스의 상세 패널에서 추출합니다. Kakao
> Local API는 해당 정보를 제공하지 않아 `kakao` 소스에서는 비어 있습니다.

### 인스타그램 수집 동작 (naver_map)

1. 상세 패널의 **홈페이지/소식/정보/예약/블로그** 영역 `a[href]`를 모두 수집합니다.
2. 네이버 리다이렉트/공유 URL은 **실제 외부 URL로 디코딩**한 뒤 판정합니다.
3. `instagram.com` / `instagr.am` / `threads.net` **프로필** 링크만
   `인스타그램`으로 분류합니다(게시물 `/p/`·예약 경로 등은 저장하지 않음).
4. 직접 링크가 없으면 `업체명 + 지역 + 인스타그램`으로 **보조 검색**해
   결과에서 인스타 프로필 URL만 추출합니다(`instagram_search_fallback`).
5. 끝까지 못 찾으면 빈칸으로 두고, 네이버 내부/타 소셜 링크는 저장하지 않습니다.
6. 실행 로그에 `[인스타] 링크 찾음 / 후보 제외 / 보조검색 찾음/없음 / 없음`을
   남겨 라이브 추출 실패를 추적할 수 있습니다.

## 중복 제거 기준

1. **전화번호** 기준 (숫자만 추출 후 비교)
2. 전화번호가 없으면 **매장명 + 주소** 정규화 후 비교

## SQLite 영속 저장 (`leads.db`)

수집한 매장은 `leads.db`의 `leads` 테이블에 **upsert**됩니다.

- 동일 리드 판정 기준은 위 중복 제거 기준과 같습니다(전화번호 → 매장명+주소).
- `first_collected_at` / `last_collected_at`으로 최초·최근 수집 시각을 추적합니다.
- 같은 리드를 다시 수집해도 중복 삽입되지 않고 `last_collected_at`만 갱신됩니다.

### 영업상태 (`status`)

각 리드는 영업상태(`status`)를 가지며 DB에 영속 저장됩니다. 엑셀에도 `status`
컬럼으로 출력됩니다.

- 기본값: `NEW`
- 가능한 값: `NEW`, `CONTACTED`, `INTERESTED`, `TRIAL`, `CUSTOMER`, `REJECTED`
- DB에서 `status`를 바꾸면 다음 수집/엑셀에도 그 값이 그대로 유지됩니다.

### 기존 리드 제외 (`export_only_new`)

`settings.export_only_new`를 `true`로 두면 이미 DB에 있던 기존 리드는 엑셀에서
제외하고 이번에 새로 발견된 리드만 출력합니다. `false`면 전체를 출력합니다.
(DB에는 두 경우 모두 저장됩니다.)

## 프로젝트 구조

```
numbering/
├─ .env.example
├─ config.example.json
├─ requirements.txt
├─ README.md
├─ DEVELOPMENT_PLAN.md
├─ main.py               # 실행 진입점 / 소스 선택 / 전체 흐름 제어
├─ keyword_generator.py  # 지역+업종 검색 키워드 생성
├─ kakao_client.py       # Kakao Local API 클라이언트 (source=kakao)
├─ naver_map_client.py   # 네이버 지도 Playwright 수집기 (source=naver_map)
├─ dedupe.py             # 중복 제거
├─ database.py           # SQLite 저장 / upsert / status 관리
├─ excel_exporter.py     # 엑셀 생성
├─ logger.py             # 실행 로그
├─ leads.db              # SQLite 리드 영속 저장소(실행 시 생성, git 제외)
└─ output/               # 엑셀/로그 산출물
```

## 주의사항

- 수집 방식은 `source`로 선택합니다. `kakao`는 공식 API, `naver_map`은
  네이버 지도 브라우저 자동화입니다.
- `naver_map`은 네이버 약관/DOM 변경에 영향을 받을 수 있으므로 과도한 수집을
  피하고 `delay_seconds`를 충분히 두세요. 셀렉터 변경 시 `naver_map_client.py`
  의 `*_SELECTORS`를 갱신합니다.
- 전화번호는 숫자가 깨지지 않도록 엑셀에서 문자열로 저장됩니다.
- 특정 작업/매장 수집이 실패해도 전체 실행은 중단되지 않고 로그만 남깁니다.
- `.env`와 `config.json`은 `.gitignore`에 포함되어 커밋되지 않습니다.

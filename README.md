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

화면 크롤링을 하지 않고 **Kakao Local API**(공식 키워드 장소 검색)만 사용합니다.

```
GET https://dapi.kakao.com/v2/local/search/keyword.json
```

수집 → 중복 제거 → 엑셀 생성 → 로그 저장의 흐름으로 동작합니다.

## 설치 및 실행

```bash
# 1. 패키지 설치
pip install -r requirements.txt

# 2. 환경변수 파일 생성
cp .env.example .env

# 3. .env에 카카오 REST API 키 입력
#    KAKAO_REST_API_KEY=실제_키

# 4. 설정 파일 생성
cp config.example.json config.json

# 5. 실행
python main.py
```

> 카카오 REST API 키는 [Kakao Developers](https://developers.kakao.com)에서
> 애플리케이션을 만든 뒤 **REST API 키**를 발급받아 사용합니다.

## 설정 파일 (`config.json`)

```json
{
  "settings": {
    "delay_seconds": 0.25,
    "max_pages_per_keyword": 3,
    "require_phone": false,
    "output_dir": "output"
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
| `delay_seconds` | API 호출 사이 대기 시간(초) |
| `max_pages_per_keyword` | 검색어 하나당 최대 페이지 수 (페이지당 최대 15개) |
| `require_phone` | `true`면 전화번호 없는 매장은 제외 |
| `output_dir` | 엑셀/로그 저장 폴더 |
| `jobs` | 수집 작업 목록 |
| `region` | 지역명 |
| `business_type` | 업종명 |
| `target_count` | 목표 수집 개수(수집 시도 기준) |
| `extra_keywords` | 사용자가 추가하는 검색어 |

## 산출물

- **엑셀**: `output/leads_{지역}_{업종}_{YYYY-MM-DD}.xlsx`
  - 시트: `전체리스트` / `전화번호있음` / `전화번호없음` / `요약`
  - 컬럼: 수집일, 지역, 업종, 검색키워드, 매장명, 전화번호, 주소,
    카테고리, 지도URL, 영업상태, 메모, 최근연락일, 다음연락일, 담당자
  - 헤더 고정, 필터, 컬럼 너비 자동 조정, 지도URL 하이퍼링크
- **로그**: `output/run_log_{YYYY-MM-DD_HHMMSS}.txt`

## 중복 제거 기준

1. **전화번호** 기준 (숫자만 추출 후 비교)
2. 전화번호가 없으면 **매장명 + 주소** 정규화 후 비교

## 프로젝트 구조

```
numbering/
├─ .env.example
├─ config.example.json
├─ requirements.txt
├─ README.md
├─ DEVELOPMENT_PLAN.md
├─ main.py               # 실행 진입점 / 전체 흐름 제어
├─ keyword_generator.py  # 지역+업종 검색 키워드 생성
├─ kakao_client.py       # Kakao Local API 클라이언트
├─ dedupe.py             # 중복 제거
├─ excel_exporter.py     # 엑셀 생성
├─ logger.py             # 실행 로그
└─ output/               # 엑셀/로그 산출물
```

## 주의사항

- 화면 크롤링은 하지 않습니다. 공식 API만 사용합니다.
- 전화번호는 숫자가 깨지지 않도록 엑셀에서 문자열로 저장됩니다.
- 특정 작업이 실패해도 전체 실행은 중단되지 않습니다.
- `.env`와 `config.json`은 `.gitignore`에 포함되어 커밋되지 않습니다.

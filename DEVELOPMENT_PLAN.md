# numbering 개발 계획서

## 0. 프로젝트 한 줄 정의

**numbering**은 사용자가 입력한 `지역 + 업종`을 기준으로 매장 정보를 자동
검색하고, 영업용 엑셀 리스트로 정리하는 로컬 실행형 리드 수집 도구다.

```
지역: 성수
업종: 카페
목표 수집 수: 300개

실행 결과:
output/leads_성수_카페_2026-06-11.xlsx
```

## 1. 개발 목표

퇴근 전에 프로그램을 실행해두면, 다음 날 출근 시 바로 영업 가능한 매장
리스트를 확보하는 것이 목표다.

1. `config.json`에 지역/업종/목표 개수를 입력한다.
2. `python main.py`를 실행한다.
3. 공식 API로 장소 데이터를 수집한다.
4. 중복을 제거한다.
5. 전화번호/주소/지도링크가 정리된 엑셀 파일을 만든다.

## 2. MVP 범위

### 구현
- Python CLI 실행
- `.env`에서 카카오 REST API 키 로드
- `config.json` 기반 다중 작업 실행
- 지역 + 업종 기반 검색 키워드 자동 생성
- Kakao Local API 키워드 검색 + 페이지네이션
- 목표 수집 수까지 반복 수집
- 전화번호 / 매장명+주소 기준 중복 제거
- 엑셀 파일 + 실행 로그 생성
- 작업 단위 실패 처리(전체 중단 방지)

### 제외
화면 크롤링, 웹 스크래핑, 문자 발송, 웹 대시보드, 로그인, 스케줄러,
AI 분류, 유사도 기반 고급 중복 제거.

## 3. 공식 API 사용

화면 크롤링은 차단/약관/유지보수 리스크가 크므로 **Kakao Local API**의
키워드 장소 검색만 사용한다.

```
GET https://dapi.kakao.com/v2/local/search/keyword.json
Authorization: KakaoAK {KAKAO_REST_API_KEY}
```

주요 응답 필드: `place_name`, `phone`, `road_address_name`,
`address_name`, `category_name`, `place_url`, `x`, `y`.

## 4. 폴더 구조

```
numbering/
├─ .env.example
├─ config.example.json
├─ requirements.txt
├─ README.md
├─ DEVELOPMENT_PLAN.md
├─ main.py
├─ keyword_generator.py
├─ kakao_client.py
├─ dedupe.py
├─ excel_exporter.py
├─ logger.py
└─ output/
```

## 5~7. 환경/의존성/설정

- `.env.example`: `KAKAO_REST_API_KEY`
- `requirements.txt`: requests, python-dotenv, pandas, openpyxl
- `config.example.json`: settings(delay_seconds, max_pages_per_keyword,
  require_phone, output_dir) + jobs(region, business_type, target_count,
  extra_keywords)

## 8. 키워드 생성 정책

기본 키워드 `{region} {business_type}` + 지역 별칭 확장(REGION_ALIASES) +
사용자 추가 키워드(extra_keywords). 중복 키워드는 순서를 유지하며 제거.

## 9. Kakao API 클라이언트

- `search_keyword(keyword, page, size)`
- `collect_places(keyword, max_pages, delay_seconds)`
- 파라미터: query, page(1부터), size(최대 15)
- 예외: 키 누락 시 종료, HTTP/파싱 오류는 키워드 단위 실패, 결과 없으면 빈 리스트

## 10. 데이터 정규화

응답 1건 → 표준 레코드(수집일, 지역, 업종, 검색키워드, 매장명, 전화번호,
주소, 카테고리, 지도URL, 영업상태='미접촉', 메모, 최근연락일, 다음연락일,
담당자).

## 11. 중복 제거 정책

1순위 전화번호(숫자만), 2순위 매장명+주소 정규화(공백/특수문자 제거, 소문자).
통계: 원본/중복제거/최종/전화번호 유무 개수를 로그에 기록.

## 12. 엑셀 생성 정책

- 파일명 `output/leads_{지역}_{업종}_{YYYY-MM-DD}.xlsx`
- 시트: 전체리스트 / 전화번호있음 / 전화번호없음 / 요약
- 헤더 bold, freeze pane, 필터, 컬럼 너비 자동 조정
- 전화번호 문자열 유지, 지도URL 하이퍼링크

## 13. 실행 로그 정책

`output/run_log_{YYYY-MM-DD_HHMMSS}.txt`에 작업별 키워드/수집 수/통계/저장
파일 경로를 기록.

## 14. main.py 흐름

.env 로드 → API 키 확인 → config 로드 → output 생성 → jobs 반복(키워드 생성
→ API 호출 → 정규화 → target_count 도달 시 종료 → require_phone 필터 →
중복 제거 → 엑셀 저장 → 로그) → 요약 출력.

## 17. 완료 기준

`python main.py` 무오류 동작, jobs 순차 실행, Kakao API 연동, output 엑셀
생성(매장명/전화번호/주소/카테고리/지도URL 포함), 중복 제거, 로그 생성,
API 키 누락 시 친절한 오류 메시지.

## 18. 로드맵

- v1.1: 시트 분리, 네이버/인스타 검색 링크, 업종별 키워드 템플릿
- v1.2: SQLite 저장, 기존/신규 비교, 접촉 매장 제외, 상태 이력
- v1.3: Supabase 연동, 웹 대시보드, 칸반, 담당자 배정
- v2.0: 알리고 문자 API 연동, 발송 이력, 전환율 리포트

## 19. 주의사항

화면 크롤링 금지, delay_seconds 적용, 전화번호 문자열 저장, 한글 파일명
처리, 작업 단위 실패 격리, target_count는 수집 시도 기준(로그에 최종 개수
명시), config 누락 시 복사 안내, output 자동 생성.

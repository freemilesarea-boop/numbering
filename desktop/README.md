# Numbering Desktop — 네이버지도 매장 정보 수집기

터미널 명령어 대신, **앱을 실행해 기준 위치 / 반경 / 업종 / 수집 개수를 입력하면**
네이버지도에 공개적으로 노출된 매장 정보를 자동 수집해 **CSV / XLSX**로 저장하는
데스크톱 프로그램입니다. 영업팀이 바로 사용할 수 있도록 UI · 상태관리 · 파일저장 ·
에러처리를 갖췄습니다.

> 루트의 Python 스크립트(`naver_map_client.py`, `link_utils.py`, `dedupe.py`)의
> 네이버지도 수집/링크분류/중복제거 로직을 TypeScript(Playwright)로 포팅해
> 재사용했습니다.

## 기술 스택

- **Electron** — 데스크톱 셸
- **React + TypeScript** — UI
- **Playwright (Chromium)** — 네이버지도 브라우저 자동화 (메인 프로세스에서 실행)
- **xlsx** — XLSX 저장 / CSV는 직접 생성(UTF-8 BOM)
- **electron-vite** — 빌드 도구

## 설치 및 실행

```bash
cd desktop
npm install              # 의존성 설치 + Chromium 자동 설치(postinstall)
npm run dev              # 개발 모드 실행 (핫 리로드)
```

배포용 빌드 / 패키징:

```bash
npm run build            # main/preload/renderer 번들
npm run package          # 현재 OS용 설치 파일 생성 (dist/)
npm run package:win      # 윈도우 설치 파일(nsis)만
npm run package:mac      # 맥 설치 파일(dmg)만
```

> 패키징 전에 번들할 Chromium을 `pw-browsers/`에 받아둬야 합니다.
> `PLAYWRIGHT_BROWSERS_PATH="$PWD/pw-browsers" npx playwright install chromium`
> (CI에서는 자동으로 수행됩니다.)

## GitHub Actions에서 윈도우 / 맥 빌드 다운로드

별도 빌드 환경 없이 **Actions에서 설치 파일을 바로 받을 수 있습니다.**

1. GitHub 저장소 → **Actions** → **Build Desktop App** 워크플로
2. **Run workflow**(수동 실행)를 누르면 윈도우(x64) · 맥(Intel x64 · Apple Silicon arm64)
   설치 파일이 빌드됩니다.
3. 완료 후 실행 페이지 하단 **Artifacts**에서 다운로드:
   - `Numbering-windows-x64` → `.exe` (NSIS 설치 관리자)
   - `Numbering-macos-x64` / `Numbering-macos-arm64` → `.dmg`

`v1.0.0` 같은 `v*` 태그를 푸시하면 동일 산출물이 **GitHub Release**에도 자동 첨부됩니다.

각 OS 네이티브 러너에서 빌드하므로 해당 OS·아키텍처용 Chromium이 앱에 함께 번들되어,
사용자는 **추가 설치 없이 바로 실행**할 수 있습니다.

### macOS 첫 실행 안내 (Gatekeeper)

정식 Apple Developer ID 서명/공증(notarization)은 유료 계정이 필요해 적용하지 않고,
대신 빌드 시 **ad-hoc 코드 서명**을 적용합니다. 따라서 다운로드한 앱은
첫 실행 시 "확인되지 않은 개발자" 경고가 날 수 있으며, 아래 중 하나로 실행합니다.

- **우클릭 → 열기** 후 대화상자에서 "열기" 선택, 또는
- 시스템 설정 → 개인정보 보호 및 보안 → "확인 없이 열기"

만약 **"손상되었기 때문에 열 수 없습니다"** 오류가 보이면(quarantine 플래그 문제),
앱을 응용 프로그램 폴더로 옮긴 뒤 터미널에서 quarantine 속성을 제거합니다:

```bash
xattr -cr "/Applications/Numbering.app"
```

타입 체크:

```bash
npm run typecheck
```

## 화면 구성

- **좌측**: 검색 조건 입력 패널 (기준 위치 · 반경 · 업종 · 최대 개수 · 저장 형식 ·
  안전장치 고급 설정 · 진행률 바)
- **우측 상단**: 실시간 수집 결과 테이블 (수집 즉시 한 행씩 추가, 검색 필터)
- **우측 하단**: 진행 로그 (info / success / warn / error 색상 구분, 자동 스크롤)
- **상단 툴바**: 수집 시작 / 일시정지 · 재개 / 중단 / 결과 저장 / 초기화 + 상태 배지

## 수집 동작

1. Playwright로 네이버지도(`map.naver.com/p/search/...`) 브라우저를 띄웁니다.
2. `기준 위치 + 업종 키워드`로 검색합니다.
3. 검색 결과 목록을 스크롤하며 순회하고, 각 매장 상세 패널에 진입합니다.
4. 공개 화면에 노출된 정보만 추출합니다.
5. **네이버지도 URL** 또는 **매장명+주소** 기준으로 중복을 제거합니다.
6. 진행률 · 결과 · 로그를 UI에 실시간 표시합니다.
7. 최대 수집 개수 도달 / 결과 소진 / 사용자 중단 시 종료합니다.
8. 결과 저장 버튼으로 CSV / XLSX 파일을 내보냅니다.

### 수집 필드 → 결과 파일 컬럼

| UI 표시 | 결과 컬럼 | 설명 |
|---|---|---|
| 매장명 | `store_name` | |
| 주소 | `address` | |
| 안심/대표번호 | `safe_phone` | 0507 안심번호 또는 02/0xx 대표번호 |
| 휴대폰 | `mobile_phone` | 010/011 등 휴대폰 번호 |
| 인스타 | `instagram_url` | 프로필 링크만 (게시물/예약 경로 제외) |
| 홈페이지 | `homepage_url` | 네이버 내부/타 소셜 제외한 외부 홈페이지 |
| 지도 | `naver_map_url` | 네이버 플레이스 매장 URL |
| 수집일시 | `collected_at` | ISO 문자열 |

## 안전장치

- **요청 간 랜덤 딜레이**: `최소~최대(ms)` 사이 무작위 대기로 과도한 빠른 요청 방지.
- **CAPTCHA / 로그인 감지**: URL·본문에서 차단 신호 감지 시 수집을 자동 중단하고
  사용자에게 알립니다.
- **공개 정보만 수집**: 화면에 보이는 항목만 추출합니다.
- **실패 매장 스킵**: 개별 매장 추출이 실패해도 전체는 멈추지 않고 로그에 남깁니다.
- **에러 비종료**: 오류가 나도 앱은 종료되지 않고 상태/로그에 표시됩니다.

## 중간 저장 / 복구

- 수집 상태(설정 · 결과 · 로그 · 진행 상태)를 사용자 데이터 폴더의
  `collection-state.json`에 **디바운스 저장**합니다.
  (`%APPDATA%/numbering-desktop` · `~/Library/Application Support/numbering-desktop` 등)
- 프로그램이 중간에 꺼져도 **재시작 시 이전 결과를 복구**합니다.
- 복구 후 "현재 결과에 이어서 더 수집" 또는 "초기화"를 선택할 수 있습니다.

## 프로젝트 구조

```
desktop/
├─ electron.vite.config.ts
├─ src/
│  ├─ shared/types.ts            # main ↔ renderer 공유 타입
│  ├─ main/                      # Electron 메인 프로세스
│  │  ├─ index.ts                # 진입점 / 윈도우 생성
│  │  ├─ ipc.ts                  # IPC 핸들러
│  │  ├─ controller.ts           # 수집 조율 / 중복제거 / 이벤트 / 상태
│  │  ├─ scraper/
│  │  │  ├─ naverMapClient.ts    # Playwright 수집기 (naver_map_client.py 포팅)
│  │  │  ├─ linkUtils.ts         # 링크 분류/디코딩 (link_utils.py 포팅)
│  │  │  └─ dedupe.ts            # 중복제거 / 전화번호 분류 (dedupe.py 포팅)
│  │  ├─ store/stateStore.ts     # JSON 중간 저장 / 복구
│  │  └─ export/exporter.ts      # CSV / XLSX 저장
│  ├─ preload/index.ts           # contextBridge IPC API
│  └─ renderer/                  # React UI
│     ├─ index.html
│     └─ src/
│        ├─ App.tsx
│        ├─ styles.css
│        └─ components/
│           ├─ SearchPanel.tsx
│           ├─ ResultsTable.tsx
│           ├─ LogPanel.tsx
│           └─ Toolbar.tsx
└─ package.json
```

## 주의사항

- 네이버지도의 DOM/셀렉터는 자주 바뀝니다. 화면 구조 변경으로 수집이 안 되면
  `src/main/scraper/naverMapClient.ts`의 `*_SELECTORS` 상수를 갱신하세요.
- 네이버 약관 및 robots 정책을 준수하고, 공개 정보만 적정 속도로 수집하세요.
- 반경(`radius`)은 검색 컨텍스트 힌트로 사용되며, 네이버지도 특성상 정확한
  반경 필터링은 보장되지 않습니다.

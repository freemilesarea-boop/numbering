// Playwright Chromium을 앱에 번들하기 위한 스크립트.
//
// Chromium을 desktop/.playwright-browsers 폴더로 설치한다.
// electron-builder가 이 폴더를 extraResources(resources/ms-playwright)로 패키징하고,
// 런타임(메인 프로세스)에서 PLAYWRIGHT_BROWSERS_PATH를 그 위치로 지정한다.
// 결과적으로 Chromium이 없는 PC에서도 설치 파일만으로 바로 실행된다.

import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const browsersDir = join(desktopRoot, '.playwright-browsers')

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir }

console.log(`[bundle-chromium] Chromium을 다음 위치에 설치합니다: ${browsersDir}`)
execSync('npx playwright install chromium', { stdio: 'inherit', cwd: desktopRoot, env })
console.log('[bundle-chromium] 완료')

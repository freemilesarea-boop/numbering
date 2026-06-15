// electron-builder afterPack 훅: macOS 앱을 ad-hoc 코드 서명한다.
//
// 정식 Apple Developer ID 인증서가 없으면 electron-builder는 서명을 건너뛰고(미서명),
// 그 결과 Apple Silicon 맥에서는 다운로드한 앱이 "손상되어 열 수 없습니다" 오류로
// 실행 자체가 막힌다. ad-hoc 서명(`codesign --sign -`)으로 유효한 서명을 부여하면
// 앱이 정상 실행되고, 다운로드 시에도 "손상됨" 대신 일반적인 미확인 개발자 경고로
// 바뀌어 우클릭 → 열기 또는 quarantine 해제로 실행할 수 있다.
//
// 주: 완전한 무경고 배포(공증/notarization)는 유료 Apple Developer 계정이 필요하다.

const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  // 번들 내부의 모든 중첩 바이너리(Electron 헬퍼, 번들된 Chromium 등)까지 ad-hoc 서명.
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
  // eslint-disable-next-line no-console
  console.log(`[afterPack] ad-hoc signed: ${appPath}`)
}

// Electron 메인 프로세스 진입점.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { CollectionController } from './controller'
import { registerIpc } from './ipc'
import { StateStore } from './store/stateStore'

// 패키징된 앱에서는 설치 과정에서 함께 번들된 Chromium을 사용한다.
// electron-builder의 extraResources로 복사된 `resources/pw-browsers` 폴더를
// Playwright 브라우저 경로로 지정해, 사용자가 별도로 `playwright install`을
// 실행하지 않아도 바로 동작하게 한다. (개발 모드에서는 기본 캐시를 사용)
// Playwright는 실제 launch 시점에 이 환경변수를 읽으므로 진입점에서 설정하면 충분하다.
if (app.isPackaged && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'pw-browsers')
}

const store = new StateStore()
const controller = new CollectionController(store)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Numbering — 네이버지도 매장 수집기',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 외부 링크는 기본 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // renderer가 준비되면 컨트롤러에 WebContents를 연결한다(이벤트 발행 대상).
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) controller.attach(mainWindow.webContents)
  })

  // electron-vite: 개발 시 dev 서버, 빌드 시 로컬 파일을 로드한다.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await store.load()
  registerIpc(controller)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void store.flush().finally(() => app.quit())
  }
})

app.on('before-quit', () => {
  void store.flush()
})

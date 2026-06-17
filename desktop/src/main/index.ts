// Electron 메인 프로세스 진입점.

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { CollectionController } from './controller'
import { registerIpc } from './ipc'
import { StateStore } from './store/stateStore'

// 패키징된 앱에서는 함께 번들한 Chromium(resources/ms-playwright)을 사용한다.
// 이렇게 하면 Chromium이 설치되지 않은 PC에서도 설치 파일만으로 바로 동작한다.
// (개발 모드에서는 전역 캐시의 Chromium을 그대로 사용한다.)
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'ms-playwright')
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

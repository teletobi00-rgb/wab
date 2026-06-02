# WAB

메신저(Baileys/WhatsApp Web 프로토콜)를 데스크톱·웹에서 쓰는 개인용 클라이언트.
QR 로그인 후 채팅·미디어·답장·반응 등 대부분의 기능을 지원한다.

회사 네트워크가 `web.whatsapp.com`을 차단한 경우, **클라우드 서버에서 메신저에
연결하고 회사 PC는 그 서버에 HTTPS로 접속**하는 "클라우드 릴레이" 모드로 우회할
수 있다.

```
회사 PC ──HTTPS──▶ 내 클라우드 서버(Railway) ──WebSocket──▶ web.whatsapp.com
   (회사가 허용)            (회사망 밖이라 연결 가능)
```

---

## ⚠️ 먼저 읽어주세요

- 비공식 클라이언트라 **계정 정지 위험**이 있습니다. 본인 계정으로만, 본인 책임
  하에 사용하세요.
- 클라우드 릴레이는 **대화가 외부 서버를 경유**합니다. 회사 보안정책상 민감할 수
  있으니 각자 판단하에 사용하세요.
- **각자 자기 서버를 띄우세요(1인 1서버).** 한 서버에 여러 명을 몰면 한 명의
  사고가 전원에게 번지고 세션 키가 한곳에 모여 위험합니다. 아래대로 각자 배포하면
  세션이 분리되어 안전합니다.

---

## ☁️ 클라우드 배포 (각자 1인용) — 약 10분

> 무료인 GitHub 계정과 Railway 계정이 필요합니다.

### 1. 이 저장소를 내 계정으로 Fork

GitHub 저장소 페이지 우측 상단 **`Fork`** → **`Create fork`**. 내 계정에
`내아이디/wab` 복사본이 생깁니다.

### 2. 접속 비밀번호(토큰) 정하기

WAB 접속 시 쓸 **나만의 비밀번호**를 정합니다. 영문+숫자 섞어 **20자 이상**
아무거나 (예: `mywab2026secretKEY12345`). 메모해 두세요.

### 3. Railway에 배포

1. <https://railway.app> → **`Login with GitHub`**.
2. **`New Project` → `Deploy from GitHub repo`** → Fork한 `wab` 선택
   (처음이면 GitHub 접근 권한 한 번 허용).
3. Railway가 `Dockerfile`을 자동 감지해 빌드 (약 5분).

### 4. 비밀번호 등록

서비스 박스 클릭 → **`Variables`** 탭 → **`+ New Variable`**:
- **Name**: `WAB_ACCESS_TOKEN`
- **Value**: 2번 비밀번호

### 5. 세션 저장용 볼륨 붙이기 (중요)

볼륨이 없으면 서버 재시작마다 QR을 다시 스캔해야 합니다.
서비스 박스 **우클릭 → `Attach Volume`** (또는 `Ctrl/Cmd + K` → "Volume") →
**Mount path** 에 `/data` 입력.

### 6. 주소 만들고 접속

서비스 → **`Settings` → `Networking` → `Generate Domain`** → 생기는 주소
(`xxxx.up.railway.app`)를 회사 PC 브라우저에서 엽니다 → **토큰 입력** →
**QR 스캔**(휴대폰 WhatsApp → 연결된 기기) → 끝!

자세한 옵션(Fly.io, Koyeb, 로컬 클라우드 모드 테스트)은 [`DEPLOY.md`](./DEPLOY.md).

---

## 스택

- Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- Baileys (메신저 프로토콜) + Socket.IO
- Electron 33 (데스크톱 패키징) / Docker (클라우드 서버)
- Biome (lint/format)

## 기능

- QR 인증 로그인 (멀티 디바이스 연결)
- 텍스트 / 이미지 / 영상 / 음성 / 문서 / 스티커 송수신
- 드래그&드롭·붙여넣기 파일 송부
- 답장(인용) · 반응(이모지) · 전달 · 삭제 · 읽음 표시(✓✓) · 타이핑 인디케이터
- 채팅 검색 · 대화 내 검색 · 키워드 알림 · 내보내기 · 예약 전송
- 사용자 지정 별칭(이름) · 고정/음소거 · 라이트/다크 테마
- 시스템 트레이 백그라운드 실행 (데스크톱) · 자동 업데이트

## 환경변수

| 변수 | 설명 |
|------|------|
| `WAB_ACCESS_TOKEN` | 클라우드 접속 비밀번호(필수). 없으면 토큰 게이트 비활성(로컬 전용). |
| `WAB_BIND_HOST` | 바인드 주소. 토큰 있으면 `0.0.0.0`, 없으면 `127.0.0.1`. |
| `PORT` | 포트 (플랫폼이 자동 주입, 기본 3000) |
| `WAB_AUTH_DIR` / `WAB_MEDIA_DIR` / `WAB_ALIAS_FILE` / `WAB_LOG_FILE` | 세션·미디어·별칭·로그 경로 (Dockerfile에서 `/data`로 설정) |

---

## 로컬 개발

```bash
npm install
npm run dev          # 브라우저 모드 http://localhost:3000
npm run electron:dev # Electron 모드 (창 + DevTools)
npx tsc --noEmit     # 타입 체크
npm run check        # Biome lint/format
```

### 클라우드 모드 로컬 테스트

```powershell
$env:WAB_ACCESS_TOKEN="test123"; npm run build; npm run start
# http://localhost:3000 → 토큰 게이트 확인 (test123)
```

## 데스크톱 빌드 (Windows)

```bash
npm run dist         # NSIS 인스톨러 (release/ 출력)
npm run dist:dir     # 인스톨러 없이 폴더만 (빠른 검증)
```

> 빌드 시 출력 폴더가 OneDrive 동기화 경로 안에 있으면 OneDrive가 `app.asar`를
> 잠가 빌드가 실패할 수 있다. OneDrive 밖 경로로 출력하려면:
> `npx electron-builder --dir -c.directories.output=C:/wab-rel`

`dist` 계열 스크립트는 `fix:wincodesign`을 먼저 실행해 electron-builder의
winCodeSign 심볼릭 링크 추출 실패(Windows 권한 문제)를 우회한다.

## 데이터 위치

- 데스크톱: `%APPDATA%\WAB\` (auth, media, aliases.json, wab.log)
- 클라우드: 볼륨 `/data/` (auth, media, aliases.json)
- 세션·미디어는 민감 정보 — 커밋되지 않음 (`.gitignore`)

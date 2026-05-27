# WAB

내부 사용 메신저 데스크톱 클라이언트.

## 스택

- Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- Baileys (메신저 프로토콜) + Socket.IO
- Electron 33 (데스크톱 패키징)
- Biome (lint/format)

## 개발

```bash
# 의존성 설치
npm install

# 브라우저 모드 (http://localhost:3000)
npm run dev

# Electron 모드 (창 + DevTools 자동 오픈)
npm run electron:dev

# 아이콘 재생성
npm run icons

# 타입 체크 + lint
npx tsc --noEmit
npm run check
```

## 배포 빌드

```bash
# 로컬 .exe 빌드 (release/ 에 출력)
npm run dist

# 빠른 검증용 (인스톨러 없이 폴더만)
npm run dist:dir

# GitHub Releases에 게시 (GH_TOKEN 필요)
$env:GH_TOKEN = "ghp_..."
npm run publish
```

## 데이터 위치

- 세션: `%APPDATA%\WAB\auth\`
- 미디어 캐시: `%APPDATA%\WAB\media\`
- 위 두 폴더는 민감 정보 포함 — 커밋되지 않음

## 기능

- QR 인증 로그인 (멀티 디바이스 연결)
- 텍스트 / 이미지 / 영상 / 음성 / 문서 / 스티커 송수신
- 드래그&드롭 파일 송부
- 답장(인용) · 읽음 표시(✓✓) · 타이핑 인디케이터
- 시스템 알림 (옵션 토글)
- 채팅 검색
- 시스템 트레이 백그라운드 실행
- electron-updater 자동 업데이트 (GitHub Releases)

## 자동 업데이트 설정

`package.json` 의 `build.publish` 섹션에서 `owner` / `repo` 본인 정보로 교체:

```json
"publish": [
  {
    "provider": "github",
    "owner": "<github-username>",
    "repo": "<repo-name>"
  }
]
```

이후 `npm version patch` → `npm run publish` 로 새 릴리즈 발행하면 기존 사용자 앱이 자동 감지.

# WAB 클라우드 배포 (본인 1명용 검증)

회사 네트워크가 `web.whatsapp.com`(Meta IP 대역)을 차단해서, 회사 PC에서
Baileys가 WhatsApp에 직접 연결할 수 없다. 대신 **회사망 밖 클라우드 서버**에서
WhatsApp 연결을 띄우고, 회사 PC는 그 서버에 **HTTPS로 접속만** 한다.

```
회사 PC ──HTTPS/WSS──▶ 클라우드 서버(Railway 등) ──WebSocket──▶ web.whatsapp.com
        (회사가 허용)                                (클라우드는 회사망 밖이라 허용)
```

> ⚠️ **보안/정책 주의**
> - 이 구성은 업무 대화가 **외부 서버를 경유**한다. 회사 DLP 관점에서 단순 차단
>   우회보다 민감하게 취급될 수 있다. 본인 책임 하에 사용.
> - 클라우드 URL은 공개되므로 **반드시 접근 토큰(`WAB_ACCESS_TOKEN`)을 설정**한다.
>   토큰이 없으면 URL을 아는 누구나 당신의 WhatsApp에 접속할 수 있다.
> - WhatsApp ToS상 비공식 클라이언트는 계정 정지 위험이 있다(본인 계정으로만 사용).
> - **인스턴스는 반드시 1개만 유지하세요(`numReplicas: 1`).** Baileys는 한 계정당
>   연결 1개만 허용합니다. 2개 이상 띄우면 서로 세션을 뺏으며 무한 충돌(440)해
>   계정이 빠르게 밴될 수 있습니다. 재배포 시 잠깐 2개가 겹치는 것을 피하려면
>   Railway 배포 전략을 **"Recreate"**(중단 후 시작)로 두는 것을 권장합니다.

---

## 1. 접근 토큰 생성

길고 무작위한 토큰을 만든다. 예:

```powershell
# PowerShell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

이 값을 `WAB_ACCESS_TOKEN`으로 쓴다. (분실 시 접속 불가하니 따로 보관)

---

## 2. Railway 배포 (추천 — 가장 쉬움)

1. 코드가 GitHub(`teletobi00-rgb/wab`)에 push 되어 있어야 한다.
2. <https://railway.app> 가입 → **New Project → Deploy from GitHub repo** → `wab` 선택.
3. Railway가 루트의 **`Dockerfile`을 자동 감지**해서 빌드한다.
4. **Variables** 탭에서 환경변수 추가:
   - `WAB_ACCESS_TOKEN` = (1번에서 만든 토큰)
   - (그 외 `PORT`, `WAB_BIND_HOST`, `WAB_*_DIR`은 Dockerfile에 이미 설정됨)
5. **Volumes** 탭 → 볼륨 추가, **Mount path = `/data`**.
   (세션을 영구 저장해서 재시작해도 QR 재스캔이 필요 없게 함)
6. **Settings → Networking → Generate Domain** 으로 공개 도메인 생성
   (`xxxx.up.railway.app`).
7. 회사 PC 브라우저에서 그 도메인 접속 → **토큰 입력** → **QR 스캔** → 끝.

> Railway는 월 $5 크레딧 제공, 소진 후 사용량 과금($5/월~). 상시 실행·WebSocket·
> 볼륨을 모두 지원한다.

---

## 3. Fly.io 대안

```bash
fly launch --no-deploy          # fly.toml 생성 (Dockerfile 자동 감지)
fly volumes create wabdata -s 1 # 1GB 볼륨
# fly.toml 의 [mounts] 에 source="wabdata", destination="/data" 추가
# [http_service] internal_port = 3000
fly secrets set WAB_ACCESS_TOKEN=<토큰>
fly deploy
```

생성된 `https://<app>.fly.dev` 로 접속.

---

## 4. 로컬에서 클라우드 모드 미리 테스트

배포 전에 클라우드 모드(토큰 게이트 + 0.0.0.0)를 로컬에서 확인:

```bash
# PowerShell
$env:WAB_ACCESS_TOKEN="test123"; npm run build; npm run start
```

`http://localhost:3000` 접속 → 토큰 입력 화면이 뜨고 `test123` 입력 시 통과하면
정상. (로컬 PC도 web.whatsapp.com이 막혀 있으면 QR까지는 못 가지만, 토큰
게이트·서버 동작은 확인된다.)

---

## 5. AI 대화 요약 (선택)

채팅을 기간별로 Gemini AI가 요약해주는 기능. 쓰려면:

1. <https://aistudio.google.com/apikey> 에서 **Gemini API 키** 발급 (무료 등급 있음).
2. Railway **Variables** 탭에 추가:
   - `WAB_GEMINI_API_KEY` = 발급받은 키
   - (선택) `WAB_SUMMARY_PASSWORD` = 요약 비밀번호 (기본 `1812`)
3. 앱에서 채팅 열고 헤더의 **✨ 버튼** → 기간·비밀번호 입력 → 요약.

> ⚠️ API 키는 **서버 환경변수에만** 두세요. 코드에 하드코딩하면 공개 repo에
> 노출되어 누구나 당신의 키로 호출 → 요금이 청구될 수 있습니다.

## 환경변수 요약

| 변수 | 용도 | 기본값 |
|------|------|--------|
| `WAB_ACCESS_TOKEN` | 접속 토큰(필수, 클라우드) | (없으면 게이트 비활성=로컬 모드) |
| `WAB_GEMINI_API_KEY` | AI 요약용 Gemini 키 | (없으면 요약 비활성) |
| `WAB_SUMMARY_PASSWORD` | AI 요약 비밀번호 | `1812` |
| `WAB_GEMINI_MODEL` | Gemini 모델(선택) | `gemini-2.5-flash` |
| `WAB_MEDIA_CACHE_MB` | 미디어 캐시 상한(MB). 볼륨보다 작게 | `350` |
| `WAB_BIND_HOST` | 바인드 주소 | 토큰 있으면 `0.0.0.0`, 없으면 `127.0.0.1` |
| `PORT` | 포트 | `3000` (플랫폼이 주입) |
| `WAB_AUTH_DIR` | Baileys 세션 | `/data/auth` (Dockerfile) |
| `WAB_MEDIA_DIR` | 미디어 캐시 | `/data/media` |
| `WAB_ALIAS_FILE` | 별칭 저장 | `/data/aliases.json` |
| `WAB_LOG_FILE` | 로그 | `/data/wab.log` |

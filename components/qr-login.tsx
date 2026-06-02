"use client";

import type { Status } from "@/lib/whatsapp/types";

export function QrLogin({ qr, status }: { qr: string | null; status: Status }) {
  const message =
    status.state === "connecting" && !qr
      ? "QR 생성 중..."
      : status.state === "disconnected"
        ? "서버 연결 중..."
        : "스캔을 기다리는 중...";

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-wa-bg p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-wa-border bg-wa-panel shadow-2xl">
        <div className="bg-wa-panel-soft px-8 pb-5 pt-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-wa-green text-xl">
              💬
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-wa-text">WAB</h1>
              <p className="text-xs text-wa-text-muted">사내용 메시지 클라이언트</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6">
          <p className="mb-5 text-sm leading-relaxed text-wa-text-muted">
            폰의 메신저 앱에서{" "}
            <strong className="text-wa-text">설정 → 연결된 기기 → 기기 연결</strong>로 들어가 아래
            QR 코드를 스캔하세요.
          </p>

          <div className="flex items-center justify-center rounded-xl bg-white p-4 shadow-inner">
            {qr ? (
              <img src={qr} alt="QR Code" className="h-64 w-64" />
            ) : (
              <div className="flex h-64 w-64 flex-col items-center justify-center gap-3 text-center text-sm text-zinc-500">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-wa-green" />
                <span>{message}</span>
              </div>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] text-wa-text-muted">
            QR은 약 1분 후 만료되며 자동 갱신됩니다.
          </p>
        </div>
      </div>
    </div>
  );
}

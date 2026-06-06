// Minimal Gemini REST client (no SDK dependency). Used server-side only so the
// API key never reaches the browser. Key is read from WAB_GEMINI_API_KEY.

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function getMaxOutputTokens(): number {
  const raw = Number(process.env.WAB_GEMINI_MAX_OUTPUT_TOKENS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(Math.max(Math.floor(raw), 1024), 32768);
}

export function geminiConfigured(): boolean {
  return !!process.env.WAB_GEMINI_API_KEY?.trim();
}

export async function generateContent(parts: GeminiPart[]): Promise<string> {
  const key = process.env.WAB_GEMINI_API_KEY?.trim();
  if (!key) throw new Error("WAB_GEMINI_API_KEY is not set");
  const model = process.env.WAB_GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: getMaxOutputTokens() },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Surface a concise, non-secret error (don't echo the key/url).
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`요청이 차단되었습니다: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
  let text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini가 빈 응답을 반환했습니다.");
  if (candidate?.finishReason === "MAX_TOKENS") {
    text +=
      "\n\n---\n※ 응답이 길어 AI 출력 제한에 도달했습니다. 서버 환경변수 WAB_GEMINI_MAX_OUTPUT_TOKENS를 더 크게 설정하면 뒤쪽 잘림을 줄일 수 있습니다.";
  }
  return text;
}

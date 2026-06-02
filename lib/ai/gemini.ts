// Minimal Gemini REST client (no SDK dependency). Used server-side only so the
// API key never reaches the browser. Key is read from WAB_GEMINI_API_KEY.

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Surface a concise, non-secret error (don't echo the key/url).
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) {
    throw new Error(`요청이 차단되었습니다: ${data.promptFeedback.blockReason}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini가 빈 응답을 반환했습니다.");
  return text;
}

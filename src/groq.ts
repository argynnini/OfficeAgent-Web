const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqTestResult {
  ok: boolean;
  message: string;
  /** ok のときだけ入る、利用できるモデル ID の一覧 */
  models?: string[];
}

/** Groq API キーが有効かを、モデル一覧の取得で確認する (生成トークンを消費しない)。ok ならその一覧も返す */
export async function testGroqKey(apiKey: string): Promise<GroqTestResult> {
  if (!apiKey) return { ok: false, message: "APIキーを入力してください" };
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401) return { ok: false, message: "APIキーが正しくありません" };
    if (!res.ok) return { ok: false, message: `エラー (${res.status})` };
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).sort();
    return { ok: true, message: "接続できました", models };
  } catch (e) {
    return { ok: false, message: `通信できませんでした: ${(e as Error).message}` };
  }
}

export interface GroqChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatResult {
  ok: boolean;
  /** ok なら AI の返答、そうでなければエラーメッセージ */
  message: string;
}

/** これまでのやり取り (messages) に続けて質問し、AI の返答を 1 つ受け取る */
export async function askGroq(apiKey: string, model: string, messages: GroqChatMessage[]): Promise<GroqChatResult> {
  if (!apiKey) return { ok: false, message: "設定 (⚙) で Groq の API キーを登録してください" };
  if (!model) return { ok: false, message: "設定 (⚙) で疎通確認してモデルを選んでください" };
  try {
    const res = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages }),
    });
    if (res.status === 401) return { ok: false, message: "APIキーが正しくありません" };
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `エラー (${res.status})${text ? `: ${text.slice(0, 200)}` : ""}` };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content?.trim();
    return content ? { ok: true, message: content } : { ok: false, message: "応答が空でした" };
  } catch (e) {
    return { ok: false, message: `通信できませんでした: ${(e as Error).message}` };
  }
}

import type { Spec } from "@/components/GenUI";

const BASE = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8765";

export type Status = {
  backend: string;
  backend_label: string;
  codex_logged_in: boolean;
  backends: string[];
  openai_key?: boolean;
  stt_ready?: boolean;
  codex_model?: string | null;
  codex_models?: string[];
  reasoning_effort?: string;
  reasoning_efforts?: string[];
  lang?: string;
  langs?: string[];
  stt_provider?: string;
  stt_providers?: string[];
  elevenlabs_key?: boolean;
};

export type Route = {
  kind: "chat" | "action" | "none";
  query?: string;
  say?: string;
  confidence?: number; // 0~1, 실시간 개입 게이트용
};

export type MeetingMeta = {
  id: string;
  title: string;
  folder?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_sec?: number | null;
  utterance_count?: number;
  has_minutes?: boolean;
};

export async function getStatus(): Promise<Status> {
  const r = await fetch(`${BASE}/api/status`);
  if (!r.ok) throw new Error("status failed");
  return r.json();
}

export async function setBackend(backend: string): Promise<Status> {
  const r = await fetch(`${BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend }),
  });
  if (!r.ok) throw new Error("config failed");
  return getStatus();
}

/** 발화 분류: chat / action / none (+ 먼저 건넬 say, confidence) */
export async function route(text: string, context = "", meetingId = ""): Promise<Route> {
  const r = await fetch(`${BASE}/api/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, context, meeting_id: meetingId }),
  });
  if (!r.ok) throw new Error("route failed");
  return r.json();
}

// ── 회의 라이프사이클 (일시 기준 폴더 저장) ──────────────────────────────────
export async function startMeeting(): Promise<MeetingMeta> {
  const r = await fetch(`${BASE}/api/meetings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error("start meeting failed");
  return (await r.json()).meeting;
}
export async function endMeeting(meetingId: string): Promise<void> {
  try { await fetch(`${BASE}/api/meetings/${meetingId}/end`, { method: "POST" }); } catch { /* ignore */ }
}
export async function setMeetingTitle(meetingId: string, title: string): Promise<MeetingMeta | null> {
  try {
    const r = await fetch(`${BASE}/api/meetings/${meetingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    return (await r.json()).meeting ?? null;
  } catch { return null; }
}
export async function setMeetingFolder(meetingId: string, folder: string): Promise<MeetingMeta | null> {
  try {
    const r = await fetch(`${BASE}/api/meetings/${meetingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
    return (await r.json()).meeting ?? null;
  } catch { return null; }
}
export async function getMeeting(meetingId: string): Promise<any | null> {
  try { return (await (await fetch(`${BASE}/api/meetings/${meetingId}`)).json()).meeting ?? null; } catch { return null; }
}
export type ScriptParagraph = { t?: string; cleaned: string; bullets: string[] };
export async function getScript(meetingId: string, flush = false): Promise<ScriptParagraph[]> {
  try { return (await (await fetch(`${BASE}/api/meetings/${meetingId}/script${flush ? "?flush=true" : ""}`)).json()).script || []; } catch { return []; }
}
export async function setMeetingContext(meetingId: string, context: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/meetings/${meetingId}/context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context }) });
    return (await r.json()).ok;
  } catch { return false; }
}

export type ProgressItem = {
  text: string;
  kind?: string;   // "command" 등
  id?: string;     // 같은 id면 갱신(상태 업데이트)
  full?: string;   // 전체 명령(펼침용)
  status?: string; // "running" | "done" | "failed"
};

type StreamHandlers = {
  onProgress?: (p: ProgressItem) => void;
  onResult?: (spec: Spec, backendLabel?: string) => void;
  onError?: (err: string) => void;
};

/** 공통 SSE 스트림 리더. 반환값은 중단 함수. */
function streamSSE(path: string, body: object, h: StreamHandlers): () => void {
  const ctrl = new AbortController();
  (async () => {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) throw new Error("stream failed");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let ev = "message";
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload: any;
        try { payload = JSON.parse(data); } catch { continue; }
        if (ev === "progress") h.onProgress?.(payload as ProgressItem);
        else if (ev === "result") h.onResult?.(payload.spec, payload.backend_label);
        else if (ev === "error") h.onError?.(payload.error);
      }
    }
  })().catch((e) => {
    if (!ctrl.signal.aborted) h.onError?.(String(e));
  });
  return () => ctrl.abort();
}

/** 작업 수행 (먼저 대답 후) */
export function streamAct(query: string, context: string, h: StreamHandlers, meetingId = "") {
  return streamSSE("/api/act/stream", { query, context, meeting_id: meetingId }, h);
}

/** 회의 종료 → 회의록 생성 (요약·결정·액션·손글씨). meeting_id 있으면 저장 전사 전체 사용. */
export function streamMinutes(transcript: string, h: StreamHandlers, meetingId = "") {
  return streamSSE("/api/minutes/stream", { transcript, meeting_id: meetingId }, h);
}

/** 백그라운드 자율 생성 */
export function streamProactive(transcript: string, h: StreamHandlers, meetingId = "") {
  return streamSSE("/api/proactive/stream", { transcript, meeting_id: meetingId }, h);
}

/** 5분 다이제스트(기본 동작): 롤링 요약 + 미해결 1건 자동조사(능력 될 때만) */
export function streamDigest(meetingId: string, h: StreamHandlers, autoResearch = true, whenLabel = "") {
  return streamSSE("/api/digest/stream", { meeting_id: meetingId, auto_research: autoResearch, when_label: whenLabel }, h);
}

export async function getConnectors(): Promise<{ name: string; status: string }[]> {
  try { return (await (await fetch(`${BASE}/api/connectors`)).json()).connectors || []; } catch { return []; }
}

export type RegistryConnector = { name: string; label: string; url: string; connected: boolean };
export async function getConnectorRegistry(): Promise<{ connectors: RegistryConnector[]; custom: string[] }> {
  try { return await (await fetch(`${BASE}/api/connectors/registry`)).json(); } catch { return { connectors: [], custom: [] }; }
}
export async function connectConnector(name: string, url = ""): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const r = await fetch(`${BASE}/api/connectors/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}
export async function removeConnector(name: string): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(`${BASE}/api/connectors/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    return await r.json();
  } catch { return { ok: false }; }
}
export async function getTools(): Promise<{ name: string; desc: string; on: boolean }[]> {
  try { return (await (await fetch(`${BASE}/api/tools`)).json()).tools || []; } catch { return []; }
}
export async function setCodex(model: string | null, effort?: string): Promise<Status> {
  await fetch(`${BASE}/api/codex`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model ?? "", effort }),
  });
  return getStatus();
}

export async function setSttProvider(provider: string): Promise<Status> {
  await fetch(`${BASE}/api/stt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
  return getStatus();
}
export async function setElevenKey(key: string): Promise<Status> {
  await fetch(`${BASE}/api/apikey/elevenlabs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
  return getStatus();
}

export async function setLang(lang: string): Promise<void> {
  try { await fetch(`${BASE}/api/lang`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang }) }); } catch { /* ignore */ }
}

export async function setApiKey(key: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/apikey`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    return (await r.json()).set;
  } catch { return false; }
}
export async function getMeetings(): Promise<MeetingMeta[]> {
  try { return (await (await fetch(`${BASE}/api/meetings`)).json()).meetings || []; } catch { return []; }
}

// ── 저장 위치 ────────────────────────────────────────────────────────────────
export type Storage = { home: string; meetings_dir: string; env_locked?: boolean };
export async function getStorage(): Promise<Storage | null> {
  try { return await (await fetch(`${BASE}/api/storage`)).json(); } catch { return null; }
}
export async function setStorage(path: string): Promise<{ ok: boolean; home?: string; message?: string; error?: string }> {
  try {
    const r = await fetch(`${BASE}/api/storage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}

// ── 로컬 ASR 모델 (완전 로컬 에디션 첫 실행 다운로드) ─────────────────────────
export type SttModel = { repo: string; present: boolean; state: "idle" | "downloading" | "done" | "error"; downloaded: number; total: number; percent: number; error?: string | null };
export async function getSttModel(): Promise<SttModel | null> {
  try { return await (await fetch(`${BASE}/api/stt/model`)).json(); } catch { return null; }
}
export async function downloadSttModel(): Promise<SttModel | null> {
  try { return await (await fetch(`${BASE}/api/stt/model/download`, { method: "POST" })).json(); } catch { return null; }
}

// 전역 용어집 (Word Memory)
export type GlossaryItem = { term: string; note?: string };
export async function getGlossary(): Promise<GlossaryItem[]> {
  try { return (await (await fetch(`${BASE}/api/glossary`)).json()).glossary || []; } catch { return []; }
}
export async function setGlossary(items: GlossaryItem[]): Promise<GlossaryItem[]> {
  try { return (await (await fetch(`${BASE}/api/glossary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ glossary: items }) })).json()).glossary || []; } catch { return items; }
}

export type SttModelOption = { id: string; label: string; lang?: string; approx_gb?: number };
export type SttModels = { local: SttModelOption[]; local_active: string; cloud: SttModelOption[]; cloud_active: string };
export async function getSttModels(): Promise<SttModels | null> {
  try { return await (await fetch(`${BASE}/api/stt/models`)).json(); } catch { return null; }
}
export async function selectSttModel(kind: "local" | "cloud", modelId: string): Promise<{ ok: boolean; model?: string }> {
  try {
    const r = await fetch(`${BASE}/api/stt/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, model_id: modelId }) });
    return await r.json();
  } catch { return { ok: false }; }
}
export function streamMinutesFor(transcript: string, h: StreamHandlers) {
  return streamSSE("/api/minutes/stream", { transcript }, h);
}

export async function transcribe(blob: Blob, meetingId = "", source = "mic"): Promise<string> {
  const fd = new FormData();
  fd.append("audio", blob, blob.type.includes("wav") ? "audio.wav" : "audio.webm");
  if (meetingId) fd.append("meeting_id", meetingId);
  fd.append("source", source);
  const r = await fetch(`${BASE}/api/transcribe`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("transcribe failed");
  return ((await r.json()).text || "").trim();
}

export async function ttsUrl(text: string): Promise<string> {
  const r = await fetch(`${BASE}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error("tts failed");
  return URL.createObjectURL(await r.blob());
}

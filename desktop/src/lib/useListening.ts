import { useCallback, useRef, useState } from "react";

export type Source = "mic" | "system";

const SILENCE_MS = 1500;    // 발화 후 침묵 1.5s → 문장 끝으로 보고 종료(=다듬기 트리거). 여유있게 잡아
                            // 문장 중간 숨(보통 <1s)에 안 끊기고, 진짜 마침에서만 정식 문장으로 정제.
const INTERIM_MS = 2000;    // 발화 중 이 주기로 '초안' 전사(회색). 주기를 늘려 최종 정제와의 깜빡임 줄임.
const START_MS = 120;       // 이만큼 연속 음성이면 발화 시작으로 확정
const PREROLL_MS = 320;     // 시작 검출 전 이만큼을 앞에 붙여 앞 잘림 방지
const TAIL_MS = 350;        // 종료 후 이만큼 더 포함해 뒤 잘림 방지(문장 끝 여유)
const MIN_SPEECH_MS = 280;  // 너무 짧은 잡음 무시
const MAX_UTTER_MS = 20000; // 최대 발화 길이
const RING_SEC = 26;        // 링버퍼 길이

/** 입력 PCM을 16kHz로 다운샘플(parakeet 입력용). 단순 데시메이션. */
function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000) return input;
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * 상시 청취 + VAD endpointing (원시 PCM 링버퍼).
 * 발화 시작 전 PREROLL, 종료 후 TAIL을 포함해 앞뒤 잘림을 방지하고, 깨끗한 WAV로 전사한다.
 */
export function useListening() {
  const streamRef = useRef<MediaStream | null>(null);
  const sysStreamRef = useRef<MediaStream | null>(null);   // 캐시된 시스템 오디오 스트림(권한 재요청 방지)
  const curSourceRef = useRef<Source>("mic");
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const onUttRef = useRef<((b: Blob) => void) | null>(null);
  const onInterimRef = useRef<((b: Blob) => void) | null>(null);
  const interimMsRef = useRef(0);
  // 네이티브 토큰-스트리밍(parakeet ws / ElevenLabs realtime ws). interim-blob 대신 ws 부분결과.
  const wsRef = useRef<WebSocket | null>(null);
  const onPartialRef = useRef<((text: string) => void) | null>(null);     // 부분(초안)
  const onCommittedRef = useRef<((text: string) => void) | null>(null);   // 확정(최종 라인) — 있으면 ws final이 주도
  const streamUrlRef = useRef<string | null>(null);

  // 링버퍼
  const ringRef = useRef<Float32Array | null>(null);
  const writtenRef = useRef(0);      // 누적 샘플 수 (절대)
  const rateRef = useRef(48000);

  // VAD 상태
  const noiseRef = useRef(0.012);
  const inSpeechRef = useRef(false);
  const startFramesRef = useRef(0);
  const candStartRef = useRef(0);
  const silenceMsRef = useRef(0);
  const speechMsRef = useRef(0);

  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const extract = useCallback((fromAbs: number, toAbs: number): Float32Array => {
    const ring = ringRef.current!;
    const N = ring.length;
    const lo = Math.max(0, fromAbs, writtenRef.current - N);
    const len = Math.max(0, toAbs - lo);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = ring[(lo + i) % N];
    return out;
  }, []);

  const finalize = useCallback(() => {
    // 네이티브 스트리밍: 엔드포인트를 디코더에 알린다(현재 가설 확정). 최종 정제는 배치가 담당.
    if (wsRef.current?.readyState === 1) {
      try { wsRef.current.send('{"final":true}'); } catch { /* ignore */ }
    }
    const rate = rateRef.current;
    const tail = Math.floor((TAIL_MS / 1000) * rate);
    const toAbs = writtenRef.current + 0; // 종료 시점 (침묵 포함되어 tail 충분하지만 약간 더)
    const fromAbs = candStartRef.current - Math.floor((PREROLL_MS / 1000) * rate);
    const samples = extract(fromAbs, Math.min(writtenRef.current, toAbs + tail));
    if (speechMsRef.current >= MIN_SPEECH_MS && samples.length > rate * 0.2) {
      onUttRef.current?.(encodeWav(samples, rate));
    }
  }, [extract]);

  const onAudio = useCallback((ev: AudioProcessingEvent) => {
    const input = ev.inputBuffer.getChannelData(0);
    const n = input.length;
    const ring = ringRef.current!;
    const N = ring.length;
    // 링버퍼에 쓰기
    let wp = writtenRef.current;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const s = input[i];
      ring[wp % N] = s;
      wp++;
      sum += s * s;
    }
    writtenRef.current = wp;
    const rms = Math.sqrt(sum / n);
    setLevel((l) => l * 0.6 + Math.min(1, rms * 9) * 0.4);

    // 네이티브 스트리밍: 매 프레임을 16k로 다운샘플해 ws로 흘린다(디코더는 연속 오디오를 원함).
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      try { ws.send(downsampleTo16k(input, rateRef.current).buffer); } catch { /* ignore */ }
    }

    const frameMs = (n / rateRef.current) * 1000;
    const startThresh = Math.max(0.016, noiseRef.current * 2.5);
    const endThresh = Math.max(0.010, noiseRef.current * 1.5);

    if (!inSpeechRef.current) {
      noiseRef.current = noiseRef.current * 0.97 + rms * 0.03;
      if (rms > startThresh) {
        if (startFramesRef.current === 0) candStartRef.current = wp - n; // 이 프레임 시작
        startFramesRef.current += frameMs;
        if (startFramesRef.current >= START_MS) {
          inSpeechRef.current = true;
          setSpeaking(true);
          speechMsRef.current = START_MS;
          silenceMsRef.current = 0;
          interimMsRef.current = 0;
        }
      } else {
        startFramesRef.current = 0;
      }
    } else {
      speechMsRef.current += frameMs;
      if (rms < endThresh) silenceMsRef.current += frameMs;
      else silenceMsRef.current = 0;
      // 발화 중 주기적 '초안' 전사 — 단, 네이티브 ws 스트리밍이 켜져 있으면 그쪽이 초안을 담당.
      if (onInterimRef.current && !wsRef.current) {
        interimMsRef.current += frameMs;
        if (interimMsRef.current >= INTERIM_MS) {
          interimMsRef.current = 0;
          const rate = rateRef.current;
          const fromAbs = candStartRef.current - Math.floor((PREROLL_MS / 1000) * rate);
          const samples = extract(fromAbs, writtenRef.current);
          if (samples.length > rate * 0.3) onInterimRef.current(encodeWav(samples, rate));
        }
      }
      if (silenceMsRef.current >= SILENCE_MS || speechMsRef.current >= MAX_UTTER_MS) {
        inSpeechRef.current = false;
        startFramesRef.current = 0;
        interimMsRef.current = 0;
        setSpeaking(false);
        finalize();
      }
    }
  }, [finalize]);

  const acquire = useCallback(async (source: Source, deviceId?: string) => {
    let stream: MediaStream;
    if (source === "system") {
      // 시스템 오디오 스트림은 세션 내 캐시·재사용 → getDisplayMedia(=화면녹화 권한 프롬프트)가
      // 청취를 다시 켤 때마다 뜨지 않게 한다. (release()에서만 완전 해제)
      const cached = sysStreamRef.current;
      if (cached && cached.getAudioTracks().some((t) => t.readyState === "live")) {
        stream = cached;
      } else {
        const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        d.getVideoTracks().forEach((t) => t.stop());
        if (!d.getAudioTracks().length) throw new DOMException("시스템 오디오를 가져오지 못했습니다", "NotFoundError");
        stream = new MediaStream(d.getAudioTracks());
        sysStreamRef.current = stream;
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
    }
    curSourceRef.current = source;
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    rateRef.current = ctx.sampleRate;
    ringRef.current = new Float32Array(Math.ceil(RING_SEC * ctx.sampleRate));
    writtenRef.current = 0;

    // 네이티브 스트리밍 ws (parakeet). 실패해도 무시 → 2-pass 배치로 폴백.
    if (streamUrlRef.current && onPartialRef.current) {
      try {
        const ws = new WebSocket(streamUrlRef.current);
        ws.binaryType = "arraybuffer";
        ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            if (d.error) { ws.close(); wsRef.current = null; return; }  // 미지원 → 폴백
            if (typeof d.text !== "string") return;
            // final + onCommitted 핸들러가 있으면(ElevenLabs realtime) 확정 라인으로 처리.
            // 없으면(parakeet) final이든 아니든 전부 라이브 초안으로.
            if (d.final && onCommittedRef.current) onCommittedRef.current(d.text);
            else onPartialRef.current?.(d.text);
          } catch { /* ignore */ }
        };
        ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null; };
        ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } if (wsRef.current === ws) wsRef.current = null; };
        wsRef.current = ws;
      } catch { wsRef.current = null; }
    }

    const srcNode = ctx.createMediaStreamSource(stream);
    srcNodeRef.current = srcNode;
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = onAudio;
    procRef.current = proc;
    const sink = ctx.createGain();
    sink.gain.value = 0; // 출력 무음 (에코 방지)
    srcNode.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
  }, [onAudio]);

  const start = useCallback(
    async (onUtterance: ((b: Blob) => void) | null, onInterim: ((b: Blob) => void) | null, source: Source = "mic", deviceId?: string,
           streamUrl?: string | null, onPartial?: ((text: string) => void) | null,
           onCommitted?: ((text: string) => void) | null) => {
      onUttRef.current = onUtterance;
      onInterimRef.current = onInterim;   // null이면 초안(interim) 비활성
      streamUrlRef.current = streamUrl || null;   // 있으면 네이티브 ws 스트리밍
      onPartialRef.current = onPartial || null;
      onCommittedRef.current = onCommitted || null;   // 있으면 ws final이 확정 라인을 주도(realtime)
      inSpeechRef.current = false;
      startFramesRef.current = 0;
      silenceMsRef.current = 0;
      interimMsRef.current = 0;
      noiseRef.current = 0.012;
      await acquire(source, deviceId); // 권한/지원 에러는 throw → 호출부 처리
    },
    [acquire]
  );

  const stop = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { procRef.current?.disconnect(); } catch {}
    try { srcNodeRef.current?.disconnect(); } catch {}
    try { ctxRef.current?.close(); } catch {}
    // 마이크는 즉시 해제(프라이버시 표시 끔). 시스템 스트림은 캐시 유지 → 재청취 시 권한 재요청 X.
    if (curSourceRef.current !== "system") {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    procRef.current = null;
    srcNodeRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    inSpeechRef.current = false;
    setSpeaking(false);
    setLevel(0);
  }, []);

  // 완전 해제 — 캐시된 시스템 스트림까지 종료(모드 나갈 때/홈 복귀 시).
  const release = useCallback(() => {
    stop();
    sysStreamRef.current?.getTracks().forEach((t) => t.stop());
    sysStreamRef.current = null;
  }, [stop]);

  return { start, stop, release, level, speaking };
}

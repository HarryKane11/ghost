import { useCallback, useRef, useState } from "react";

export type Source = "mic" | "system";

const SILENCE_MS = 950;     // 발화 후 침묵 950ms → 종료 (문장 중간 숨에서 안 끊기게 상향)
const START_MS = 120;       // 이만큼 연속 음성이면 발화 시작으로 확정
const PREROLL_MS = 320;     // 시작 검출 전 이만큼을 앞에 붙여 앞 잘림 방지
const TAIL_MS = 250;        // 종료 후 이만큼 더 포함해 뒤 잘림 방지
const MIN_SPEECH_MS = 280;  // 너무 짧은 잡음 무시
const MAX_UTTER_MS = 20000; // 최대 발화 길이
const RING_SEC = 26;        // 링버퍼 길이

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
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const onUttRef = useRef<((b: Blob) => void) | null>(null);

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
        }
      } else {
        startFramesRef.current = 0;
      }
    } else {
      speechMsRef.current += frameMs;
      if (rms < endThresh) silenceMsRef.current += frameMs;
      else silenceMsRef.current = 0;
      if (silenceMsRef.current >= SILENCE_MS || speechMsRef.current >= MAX_UTTER_MS) {
        inSpeechRef.current = false;
        startFramesRef.current = 0;
        setSpeaking(false);
        finalize();
      }
    }
  }, [finalize]);

  const acquire = useCallback(async (source: Source, deviceId?: string) => {
    let stream: MediaStream;
    if (source === "system") {
      const d = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      d.getVideoTracks().forEach((t) => t.stop());
      if (!d.getAudioTracks().length) throw new DOMException("시스템 오디오를 가져오지 못했습니다", "NotFoundError");
      stream = new MediaStream(d.getAudioTracks());
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
    }
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    rateRef.current = ctx.sampleRate;
    ringRef.current = new Float32Array(Math.ceil(RING_SEC * ctx.sampleRate));
    writtenRef.current = 0;

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
    async (onUtterance: (b: Blob) => void, source: Source = "mic", deviceId?: string) => {
      onUttRef.current = onUtterance;
      inSpeechRef.current = false;
      startFramesRef.current = 0;
      silenceMsRef.current = 0;
      noiseRef.current = 0.012;
      await acquire(source, deviceId); // 권한/지원 에러는 throw → 호출부 처리
    },
    [acquire]
  );

  const stop = useCallback(() => {
    try { procRef.current?.disconnect(); } catch {}
    try { srcNodeRef.current?.disconnect(); } catch {}
    try { ctxRef.current?.close(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    procRef.current = null;
    srcNodeRef.current = null;
    ctxRef.current = null;
    streamRef.current = null;
    inSpeechRef.current = false;
    setSpeaking(false);
    setLevel(0);
  }, []);

  return { start, stop, level, speaking };
}

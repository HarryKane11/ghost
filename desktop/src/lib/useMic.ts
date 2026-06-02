import { useRef, useState, useCallback } from "react";

export type Source = "mic" | "system";

/** 이 환경에서 MediaRecorder가 지원하는 오디오 컨테이너를 고른다. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg;codecs=opus",
  ];
  const MR: typeof MediaRecorder | undefined =
    typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined;
  if (MR && typeof MR.isTypeSupported === "function") {
    for (const c of candidates) {
      try {
        if (MR.isTypeSupported(c)) return c;
      } catch {
        /* ignore */
      }
    }
  }
  return ""; // 브라우저 기본값 사용
}

/** 오디오 캡처 훅. 마이크 또는 시스템(루프백) 소스, 윈도우 녹음 + 일회성 녹음. */
export function useMic() {
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<Source | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const loopRef = useRef<boolean>(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const mimeRef = useRef<string | null>(null);
  const [level, setLevel] = useState(0);

  const mime = useCallback(() => {
    if (mimeRef.current == null) mimeRef.current = pickMimeType();
    return mimeRef.current;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    sourceRef.current = null;
  }, []);

  const ensureStream = useCallback(
    async (source: Source) => {
      if (streamRef.current && sourceRef.current === source) return streamRef.current;
      stopStream();

      let stream: MediaStream;
      if (source === "system") {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        display.getVideoTracks().forEach((t) => t.stop());
        if (display.getAudioTracks().length === 0) {
          display.getTracks().forEach((t) => t.stop());
          throw new DOMException("시스템 오디오를 가져오지 못했습니다(데스크탑 앱에서만 지원)", "NotFoundError");
        }
        stream = new MediaStream(display.getAudioTracks());
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      sourceRef.current = source;

      // 레벨 미터 (실패해도 캡처 자체는 진행)
      try {
        if (!ctxRef.current) ctxRef.current = new AudioContext();
        if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
        const src = ctxRef.current.createMediaStreamSource(stream);
        const analyser = ctxRef.current.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyserRef.current = analyser;
      } catch {
        analyserRef.current = null;
      }
      return stream;
    },
    [stopStream]
  );

  const tick = useCallback(() => {
    const a = analyserRef.current;
    if (a) {
      const data = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      setLevel(Math.min(1, avg / 110));
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const recordWindow = useCallback(
    (ms: number, source: Source = "mic"): Promise<Blob> =>
      new Promise(async (resolve, reject) => {
        try {
          const stream = await ensureStream(source);
          const chunks: BlobPart[] = [];
          const type = mime();
          const rec = type
            ? new MediaRecorder(stream, { mimeType: type })
            : new MediaRecorder(stream);
          recRef.current = rec;
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onerror = () => reject(new Error("녹음 중 오류"));
          rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }));
          rec.start();
          setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
        } catch (e) {
          reject(e);
        }
      }),
    [ensureStream, mime]
  );

  const startListening = useCallback(
    async (onSegment: (b: Blob) => void, source: Source = "mic", windowMs = 5000) => {
      await ensureStream(source); // 권한/지원 에러는 여기서 throw → 호출부에서 처리
      loopRef.current = true;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
      while (loopRef.current) {
        let blob: Blob | null = null;
        try {
          blob = await recordWindow(windowMs, source);
        } catch {
          break; // 캡처 중단
        }
        if (!loopRef.current) break;
        if (blob && blob.size > 1200) onSegment(blob);
      }
    },
    [ensureStream, recordWindow, tick]
  );

  const stopListening = useCallback(() => {
    loopRef.current = false;
    try {
      recRef.current?.state !== "inactive" && recRef.current?.stop();
    } catch {}
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopStream();
    setLevel(0);
  }, [stopStream]);

  return { startListening, stopListening, recordWindow, level };
}

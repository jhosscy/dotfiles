import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { Mistral } from "@mistralai/mistralai";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const TTS_MODEL = "voxtral-mini-tts-2603";
const STREAM_FORMAT = "opus";
const REPLAY_FORMAT = "mp3";
const STATUS_KEY = "tts";
const MISTRAL_PROVIDER = "mistral";
const MISTRAL_AUTH_MODEL = "mistral-large-latest";
const TAG_PATTERN = /<tts-message>([\s\S]*?)<\/tts-message>/gi;
const CUSTOM_ENTRY_TYPE = "tts-replay";
const PRICE_PER_1K_CHARS_USD = 0.016;
const MAX_WORDS_PER_SEGMENT = 300;
const MIN_PLAYBACK_SPEED = 0.75;
const MAX_PLAYBACK_SPEED = 2;
const DEFAULT_PLAYBACK_SPEED = 1;

const VOICES = [
  {
    id: "5d54857e-ad56-49dd-b7b6-f509b6321851",
    name: "doe",
  },
] as const;

type Voice = (typeof VOICES)[number];

type UsageInfo = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type SpeechAudioDeltaEvent = {
  event: "speech.audio.delta";
  data: {
    audioData?: string;
    audio_data?: string;
  };
};

type SpeechAudioDoneEvent = {
  event: "speech.audio.done";
  data: {
    usage?: UsageInfo;
  };
};

type SpeechAudioEvent = SpeechAudioDeltaEvent | SpeechAudioDoneEvent;

type SpeechResponse = {
  audioData: string;
};

type SegmentResult = {
  audio: Buffer;
  format: typeof STREAM_FORMAT | typeof REPLAY_FORMAT;
  metrics: Metrics;
};

type ReplayAudio = {
  audio: Buffer;
  metrics: Metrics;
  voice: Voice;
  audioPath?: string;
};

type ResponseRun = {
  source: "response";
  segments: string[];
  voice: Voice;
};

type ReplayRun = {
  source: "replay";
  audio: Buffer;
  metrics: Metrics;
  voice: Voice;
};

type TtsRun = ResponseRun | ReplayRun;

type Metrics = {
  source: TtsRun["source"];
  voice: string;
  model: string;
  format: string;
  chunks: number;
  bytes: number;
  characters: number;
  estimatedCostUsd: number;
  generationMs: number;
  playbackMs: number;
  segmentIndex: number;
  segmentCount: number;
  usage?: UsageInfo;
};

type TtsState = "idle" | "queued" | "generating" | "playing" | "combining" | "error";

type SegmentTaskResult =
  | { ok: true; result: SegmentResult }
  | { ok: false; error: unknown };

type PersistedTtsReplay = {
  version: 1;
  audioPath: string;
  format: typeof REPLAY_FORMAT;
  voiceName: Voice["name"];
  voiceId: Voice["id"];
  metrics: Metrics;
  createdAt: string;
};

type TtsActivity = {
  phase: "generating" | "playing" | "combining" | "replay";
  segmentIndex?: number;
  segmentCount?: number;
};

const subcommands = ["generate", "replay", "stop", "voice", "speed", "status", "files"] as const;
const statusCompletions = ["full"] as const;
const speedCompletions = ["0.75", "1", "1.25", "1.5", "1.75", "2"] as const;
let activeVoice: Voice = VOICES[0];
let state: TtsState = "idle";
let runQueue: TtsRun[] = [];
let processing = false;
let currentAbortController: AbortController | undefined;
let currentPlayer: ReturnType<typeof createPlayer> | undefined;
let lastReplayAudio: ReplayAudio | undefined;
let lastMetrics: Metrics | undefined;
let lastError: string | undefined;
let currentVoiceName: string | undefined;
let sessionCostUsd = 0;
let lastGeneratedCostUsd = 0;
let playbackSpeed = DEFAULT_PLAYBACK_SPEED;
let activity: TtsActivity | undefined;

function getTtsMessageText(message: AssistantMessage): string | undefined {
  const text = message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  const matches = [...text.matchAll(TAG_PATTERN)]
    .map((match) => match[1].trim())
    .filter((match) => match.length > 0);

  return matches.length > 0 ? matches.join("\n\n") : undefined;
}

function splitIntoWordSegments(text: string): string[] {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  if (words.length <= MAX_WORDS_PER_SEGMENT) return [trimmed];

  const segments: string[] = [];
  for (let index = 0; index < words.length; index += MAX_WORDS_PER_SEGMENT) {
    segments.push(words.slice(index, index + MAX_WORDS_PER_SEGMENT).join(" "));
  }

  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMetrics(value: unknown): value is Metrics {
  if (!isRecord(value)) return false;
  return (
    typeof value.source === "string" &&
    typeof value.voice === "string" &&
    typeof value.model === "string" &&
    typeof value.format === "string" &&
    typeof value.chunks === "number" &&
    typeof value.bytes === "number" &&
    typeof value.characters === "number" &&
    typeof value.estimatedCostUsd === "number" &&
    typeof value.generationMs === "number" &&
    typeof value.playbackMs === "number" &&
    typeof value.segmentIndex === "number" &&
    typeof value.segmentCount === "number"
  );
}

function isPersistedTtsReplay(value: unknown): value is PersistedTtsReplay {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.audioPath === "string" &&
    value.format === REPLAY_FORMAT &&
    typeof value.voiceName === "string" &&
    typeof value.voiceId === "string" &&
    typeof value.createdAt === "string" &&
    isMetrics(value.metrics)
  );
}

function getPersistedReplays(ctx: ExtensionContext): PersistedTtsReplay[] {
  const replays: PersistedTtsReplay[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== CUSTOM_ENTRY_TYPE) continue;
    if (isPersistedTtsReplay(entry.data)) {
      replays.push(entry.data);
    }
  }

  return replays;
}

function createPlayer(onExit: () => void, options: { speed?: number } = {}) {
  const args = [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "error",
  ];

  const speed = options.speed ?? DEFAULT_PLAYBACK_SPEED;
  if (speed !== DEFAULT_PLAYBACK_SPEED) {
    args.push("-af", `atempo=${speed}`);
  }

  args.push(
    "-i",
    "pipe:0",
  );

  const player = spawn("ffplay", args, {
    stdio: ["pipe", "ignore", "ignore"],
    detached: true,
  });

  player.once("close", onExit);
  player.once("error", onExit);
  player.stdin.on("error", () => {});
  player.unref();

  return player;
}

function createAbortError() {
  return new Error("TTS aborted");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function estimateCostUsd(characters: number): number {
  return characters / 1000 * PRICE_PER_1K_CHARS_USD;
}

function formatCost(costUsd: number): string {
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(3)}`;
}

function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

function parsePlaybackSpeed(input: string): number | undefined {
  const speed = Number(input.trim().replace(/x$/i, ""));
  if (!Number.isFinite(speed)) return undefined;
  if (speed < MIN_PLAYBACK_SPEED || speed > MAX_PLAYBACK_SPEED) return undefined;
  return Number(speed.toFixed(2));
}

function usageToText(usage: UsageInfo | undefined): string {
  if (!usage) return "usage: n/a";
  const total = usage.totalTokens ?? usage.total_tokens ?? 0;
  const prompt = usage.promptTokens ?? usage.prompt_tokens ?? 0;
  const audio = usage.completionTokens ?? usage.completion_tokens ?? 0;
  return `usage: total ${total}, prompt ${prompt}, audio ${audio}`;
}

function updateStatus(ctx: ExtensionContext) {
  const queueSuffix = runQueue.length > 0 ? ` q${runQueue.length}` : "";
  const speedSuffix = playbackSpeed === DEFAULT_PLAYBACK_SPEED ? "" : ` ${formatSpeed(playbackSpeed)}`;
  const segmentSuffix = activity?.segmentCount && activity.segmentCount > 1 && activity.segmentIndex !== undefined
    ? ` ${activity.segmentIndex + 1}/${activity.segmentCount}`
    : "";

  if (state === "idle") {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  } else if (state === "queued") {
    ctx.ui.setStatus(STATUS_KEY, `\uf028  q${runQueue.length}`);
  } else if (state === "generating") {
    ctx.ui.setStatus(STATUS_KEY, `\uf110  gen${segmentSuffix}${queueSuffix}`);
  } else if (state === "playing") {
    const replayPrefix = activity?.phase === "replay" ? "replay " : "";
    ctx.ui.setStatus(STATUS_KEY, `\uf028  ${replayPrefix}${currentVoiceName ?? activeVoice.name}${segmentSuffix}${speedSuffix}${queueSuffix}`);
  } else if (state === "combining") {
    ctx.ui.setStatus(STATUS_KEY, `\uf1c7  mix${queueSuffix}`);
  } else {
    ctx.ui.setStatus(STATUS_KEY, "tts err");
  }
}

function clearWorking(ctx: ExtensionContext) {
  ctx.ui.setWorkingMessage();
}

function stopCurrentPlayback() {
  if (currentPlayer && !currentPlayer.killed) {
    currentPlayer.kill();
  }
  currentPlayer = undefined;
}

function abortCurrentGeneration() {
  currentAbortController?.abort();
  currentAbortController = undefined;
}

function stopAll(ctx: ExtensionContext) {
  runQueue = [];
  abortCurrentGeneration();
  stopCurrentPlayback();
  processing = false;
  state = "idle";
  currentVoiceName = undefined;
  activity = undefined;
  clearWorking(ctx);
  updateStatus(ctx);
}

function linkAbortSignals(controller: AbortController, signal: AbortSignal | undefined) {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message === "TTS aborted" || error.name === "AbortError" || error.name === "RequestAbortedError";
  }

  return false;
}

async function getMistralClient(ctx: ExtensionContext): Promise<Mistral | undefined> {
  const model = ctx.modelRegistry.find(MISTRAL_PROVIDER, MISTRAL_AUTH_MODEL);
  if (!model) {
    lastError = "Mistral provider not found";
    ctx.ui.notify(lastError, "warning");
    return undefined;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    lastError = auth.ok ? "No Mistral API key found" : auth.error;
    ctx.ui.notify(lastError, "warning");
    return undefined;
  }

  return new Mistral({ apiKey: auth.apiKey });
}

function makeMetrics(
  run: TtsRun,
  options: {
    source: TtsRun["source"];
    format: string;
    chunks: number;
    bytes: number;
    characters: number;
    generationMs: number;
    playbackMs: number;
    segmentIndex: number;
    segmentCount: number;
    usage?: UsageInfo;
  },
): Metrics {
  return {
    source: options.source,
    voice: run.voice.name,
    model: TTS_MODEL,
    format: options.format,
    chunks: options.chunks,
    bytes: options.bytes,
    characters: options.characters,
    estimatedCostUsd: estimateCostUsd(options.characters),
    generationMs: options.generationMs,
    playbackMs: options.playbackMs,
    segmentIndex: options.segmentIndex,
    segmentCount: options.segmentCount,
    usage: options.usage,
  };
}

async function runProcess(command: string, args: string[], signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw createAbortError();

  await new Promise<void>((resolve, reject) => {
    const process = spawn(command, args, {
      stdio: ["ignore", "ignore", "ignore"],
    });

    const abort = () => {
      process.kill();
      reject(createAbortError());
    };

    signal.addEventListener("abort", abort, { once: true });
    process.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    process.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(createAbortError());
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function concatListLine(path: string): string {
  return `file '${path.replace(/'/g, "'\\''")}'`;
}

async function convertOpusToMp3(audio: Buffer, signal: AbortSignal): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "pi-tts-"));
  try {
    const input = join(dir, "input.opus");
    const output = join(dir, "output.mp3");
    await writeFile(input, audio);
    await runProcess("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      input,
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      output,
    ], signal);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function combineMp3Segments(audios: Buffer[], signal: AbortSignal): Promise<Buffer> {
  if (audios.length === 1) return audios[0];

  const dir = await mkdtemp(join(tmpdir(), "pi-tts-"));
  try {
    const listPath = join(dir, "concat.txt");
    const outputPath = join(dir, "combined.mp3");
    const segmentPaths: string[] = [];

    for (let index = 0; index < audios.length; index++) {
      const segmentPath = join(dir, `segment-${index}.mp3`);
      await writeFile(segmentPath, audios[index]);
      segmentPaths.push(segmentPath);
    }

    await writeFile(listPath, segmentPaths.map(concatListLine).join("\n"));
    await runProcess("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      outputPath,
    ], signal);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function playAudio(audio: Buffer, ctx: ExtensionContext, voice: Voice): Promise<number> {
  const started = Date.now();
  state = "playing";
  currentVoiceName = voice.name;
  updateStatus(ctx);

  await new Promise<void>((resolve) => {
    const player = createPlayer(() => {
      currentPlayer = undefined;
      resolve();
    }, {
      speed: playbackSpeed,
    });

    currentPlayer = player;
    player.stdin.end(audio);
  });

  return Date.now() - started;
}

async function playStreamingOpus(
  client: Mistral,
  run: ResponseRun,
  ctx: ExtensionContext,
  controller: AbortController,
): Promise<SegmentResult | undefined> {
  const input = run.segments[0];
  const started = Date.now();
  const chunks: Buffer[] = [];
  let usage: UsageInfo | undefined;
  let chunkCount = 0;
  let playbackStarted = 0;
  let resolvePlayback: (() => void) | undefined;
  const playbackDone = new Promise<void>((resolve) => {
    resolvePlayback = resolve;
  });

  state = "generating";
  currentVoiceName = run.voice.name;
  activity = {
    phase: "generating",
    segmentIndex: 0,
    segmentCount: run.segments.length,
  };
  ctx.ui.setWorkingMessage("Generating audio...");
  updateStatus(ctx);

  const audio = await client.audio.speech.complete({
    model: TTS_MODEL,
    input,
    responseFormat: STREAM_FORMAT,
    stream: true,
    voiceId: run.voice.id,
  }, {
    signal: controller.signal,
  });

  if (controller.signal.aborted) return undefined;

  state = "playing";
  activity = {
    phase: "playing",
    segmentIndex: 0,
    segmentCount: run.segments.length,
  };
  updateStatus(ctx);
  playbackStarted = Date.now();

  const player = createPlayer(() => {
    currentPlayer = undefined;
    resolvePlayback?.();
  });
  currentPlayer = player;

  for await (const event of audio as AsyncIterable<SpeechAudioEvent>) {
    if (controller.signal.aborted) break;

    if (event.event === "speech.audio.delta") {
      const audioData = event.data.audioData ?? event.data.audio_data;
      if (!audioData) continue;

      const chunk = Buffer.from(audioData, "base64");
      chunks.push(chunk);
      chunkCount++;
      player.stdin.write(chunk);
    } else if (event.event === "speech.audio.done") {
      usage = event.data.usage;
      player.stdin.end();
    }
  }

  if (!player.stdin.destroyed && !player.stdin.closed) {
    player.stdin.end();
  }

  if (controller.signal.aborted) {
    stopCurrentPlayback();
    return undefined;
  }

  await playbackDone;
  if (controller.signal.aborted) return undefined;

  const audioBuffer = Buffer.concat(chunks);
  const metrics = makeMetrics(run, {
    source: "response",
    format: STREAM_FORMAT,
    chunks: chunkCount,
    bytes: audioBuffer.length,
    characters: input.length,
    generationMs: playbackStarted - started,
    playbackMs: Date.now() - playbackStarted,
    segmentIndex: 0,
    segmentCount: run.segments.length,
    usage,
  });

  return {
    audio: audioBuffer,
    format: STREAM_FORMAT,
    metrics,
  };
}

async function generateMp3Segment(
  client: Mistral,
  run: ResponseRun,
  index: number,
  signal: AbortSignal,
): Promise<SegmentResult> {
  const input = run.segments[index];
  const started = Date.now();
  const response = await client.audio.speech.complete({
    model: TTS_MODEL,
    input,
    responseFormat: REPLAY_FORMAT,
    stream: false,
    voiceId: run.voice.id,
  }, {
    signal,
  }) as SpeechResponse;

  if (signal.aborted) throw createAbortError();

  const audio = Buffer.from(response.audioData, "base64");
  const metrics = makeMetrics(run, {
    source: "response",
    format: REPLAY_FORMAT,
    chunks: 1,
    bytes: audio.length,
    characters: input.length,
    generationMs: Date.now() - started,
    playbackMs: 0,
    segmentIndex: index,
    segmentCount: run.segments.length,
  });

  return {
    audio,
    format: REPLAY_FORMAT,
    metrics,
  };
}

function recordGeneratedMetrics(result: SegmentResult) {
  sessionCostUsd += result.metrics.estimatedCostUsd;
  lastGeneratedCostUsd = result.metrics.estimatedCostUsd;
  lastMetrics = result.metrics;
  lastError = undefined;
}

async function processResponseRun(run: ResponseRun, ctx: ExtensionContext, pi: ExtensionAPI) {
  const client = await getMistralClient(ctx);
  if (!client) return;

  const controller = new AbortController();
  currentAbortController = controller;
  const unlinkAbortSignals = linkAbortSignals(controller, ctx.signal);
  const parallelMp3Results = run.segments
    .slice(1)
    .map((_segment, offset): Promise<SegmentTaskResult> =>
      generateMp3Segment(client, run, offset + 1, controller.signal)
        .then((result) => ({ ok: true, result }))
        .catch((error: unknown) => ({ ok: false, error }))
    );
  const orderedMp3s: Buffer[] = [];
  let playbackMsTotal = 0;
  const started = Date.now();

  try {
    const firstResult = await playStreamingOpus(client, run, ctx, controller);
    if (!firstResult) return;

    recordGeneratedMetrics(firstResult);
    state = "combining";
    updateStatus(ctx);
    const firstMp3 = await convertOpusToMp3(firstResult.audio, controller.signal);
    orderedMp3s[0] = firstMp3;

    for (let index = 0; index < parallelMp3Results.length; index++) {
      const task = await parallelMp3Results[index];
      if (!task.ok) throw task.error;

      const { result } = task;
      recordGeneratedMetrics(result);
      activity = {
        phase: "playing",
        segmentIndex: result.metrics.segmentIndex,
        segmentCount: result.metrics.segmentCount,
      };
      const playbackMs = await playAudio(result.audio, ctx, run.voice);
      result.metrics.playbackMs = playbackMs;
      playbackMsTotal += playbackMs;
      lastMetrics = result.metrics;
      orderedMp3s[index + 1] = result.audio;
    }

    state = "combining";
    activity = { phase: "combining" };
    updateStatus(ctx);
    const combinedAudio = await combineMp3Segments(orderedMp3s, controller.signal);
    const totalCharacters = run.segments.reduce((sum, segment) => sum + segment.length, 0);
    const totalCost = estimateCostUsd(totalCharacters);
    lastGeneratedCostUsd = totalCost;
    lastReplayAudio = {
      audio: combinedAudio,
      voice: run.voice,
      metrics: makeMetrics(run, {
        source: "response",
        format: REPLAY_FORMAT,
        chunks: orderedMp3s.length,
        bytes: combinedAudio.length,
        characters: totalCharacters,
        generationMs: Date.now() - started,
        playbackMs: firstResult.metrics.playbackMs + playbackMsTotal,
        segmentIndex: orderedMp3s.length - 1,
        segmentCount: orderedMp3s.length,
        usage: firstResult.metrics.usage,
      }),
    };
    const audioPath = await saveReplayAudio(ctx, combinedAudio);
    lastReplayAudio.audioPath = audioPath;
    pi.appendEntry<PersistedTtsReplay>(CUSTOM_ENTRY_TYPE, {
      version: 1,
      audioPath,
      format: REPLAY_FORMAT,
      voiceName: run.voice.name,
      voiceId: run.voice.id,
      metrics: lastReplayAudio.metrics,
      createdAt: new Date().toISOString(),
    });
    lastMetrics = lastReplayAudio.metrics;
  } finally {
    unlinkAbortSignals();
    currentAbortController = undefined;
    clearWorking(ctx);
  }
}

async function processReplayRun(run: ReplayRun, ctx: ExtensionContext) {
  activity = { phase: "replay" };
  const playbackMs = await playAudio(run.audio, ctx, run.voice);
  lastMetrics = {
    ...run.metrics,
    source: "replay",
    playbackMs,
  };
}

async function processQueue(ctx: ExtensionContext, pi: ExtensionAPI) {
  if (processing) return;
  processing = true;

  try {
    while (runQueue.length > 0) {
      const run = runQueue.shift();
      if (!run) continue;

      updateStatus(ctx);

      try {
        if (run.source === "response") {
          await processResponseRun(run, ctx, pi);
        } else {
          await processReplayRun(run, ctx);
        }
      } catch (error) {
        if (isAbortError(error)) continue;

        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        state = "error";
        ctx.ui.notify(`TTS failed: ${message}`, "warning");
        updateStatus(ctx);
        setTimeout(() => {
          if (state === "error") {
            state = runQueue.length > 0 ? "queued" : "idle";
            updateStatus(ctx);
          }
        }, 5000);
      }
    }
  } finally {
    processing = false;
    if (state !== "error") {
      state = "idle";
      currentVoiceName = undefined;
      activity = undefined;
      updateStatus(ctx);
    }
  }
}

function enqueueRun(run: TtsRun, ctx: ExtensionContext, pi: ExtensionAPI) {
  runQueue.push(run);
  if (!processing && !currentPlayer) {
    void processQueue(ctx, pi);
  } else {
    state = state === "idle" ? "queued" : state;
    updateStatus(ctx);
  }
}

function findVoice(name: string): Voice | undefined {
  return VOICES.find((voice) => voice.name.toLowerCase() === name.toLowerCase());
}

function findVoiceByPersistedData(data: PersistedTtsReplay): Voice | undefined {
  return VOICES.find((voice) => voice.name === data.voiceName && voice.id === data.voiceId);
}

function getTtsStorageDir(ctx: ExtensionContext): string {
  const sessionId = ctx.sessionManager.getSessionId();
  return join(process.cwd(), ".tts", sessionId);
}

function getTtsAudioPath(ctx: ExtensionContext): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(getTtsStorageDir(ctx), `${timestamp}.mp3`);
}

async function saveReplayAudio(ctx: ExtensionContext, audio: Buffer): Promise<string> {
  const audioPath = getTtsAudioPath(ctx);
  await mkdir(getTtsStorageDir(ctx), { recursive: true });
  await writeFile(audioPath, audio);
  return audioPath;
}

async function restoreReplayAudio(ctx: ExtensionContext) {
  let latest: PersistedTtsReplay | undefined;
  sessionCostUsd = 0;

  for (const replay of getPersistedReplays(ctx)) {
    sessionCostUsd += replay.metrics.estimatedCostUsd;
    latest = replay;
  }

  if (!latest) {
    lastReplayAudio = undefined;
    return;
  }

  const voice = findVoiceByPersistedData(latest);
  if (!voice) {
    lastReplayAudio = undefined;
    lastError = `Unknown persisted TTS voice: ${latest.voiceName}`;
    return;
  }

  try {
    const audio = await readFile(latest.audioPath);
    lastReplayAudio = {
      audio,
      audioPath: latest.audioPath,
      metrics: latest.metrics,
      voice,
    };
    lastMetrics = latest.metrics;
    lastGeneratedCostUsd = latest.metrics.estimatedCostUsd;
    lastError = undefined;
  } catch {
    lastReplayAudio = undefined;
    lastError = `Persisted TTS audio not found: ${latest.audioPath}`;
  }
}

function statusText(full = false) {
  const replayStatus = lastReplayAudio ? "ready" : "none";
  if (!full) {
    const lines = [
      `state: ${state}`,
      `voice: ${activeVoice.name}`,
      `speed: ${formatSpeed(playbackSpeed)}`,
      `replay: ${replayStatus}`,
      `cost: ${formatCost(sessionCostUsd)}`,
    ];

    if (lastMetrics) {
      lines.push(
        `last: ${lastMetrics.segmentCount} segment${lastMetrics.segmentCount === 1 ? "" : "s"}, ${formatBytes(lastMetrics.bytes)}, ${formatCost(lastGeneratedCostUsd)}`,
      );
    }

    if (lastError) {
      lines.push(`error: ${lastError}`);
    }

    return lines.join("\n");
  }

  const lines = [
    `state: ${state}`,
    `voice: ${activeVoice.name}`,
    `speed: ${formatSpeed(playbackSpeed)}`,
    `model: ${TTS_MODEL}`,
    `queue: ${runQueue.length}`,
    `replay: ${replayStatus}`,
  ];

  if (lastMetrics) {
    const segmentText = lastMetrics.segmentCount > 1
      ? `, segment ${lastMetrics.segmentIndex + 1}/${lastMetrics.segmentCount}`
      : "";

    lines.push(
      `last: ${lastMetrics.source}, ${lastMetrics.voice}, ${formatBytes(lastMetrics.bytes)}, ${lastMetrics.chunks} chunks${segmentText}`,
      `chars: ${lastMetrics.characters}`,
      `lastCost: ${formatCost(lastGeneratedCostUsd)}`,
      `cost: ${formatCost(sessionCostUsd)}`,
      usageToText(lastMetrics.usage),
      `timing: gen ${formatDuration(lastMetrics.generationMs)}, play ${formatDuration(lastMetrics.playbackMs)}`,
    );

    if (lastReplayAudio?.audioPath) {
      lines.push(`file: ${lastReplayAudio.audioPath}`);
    }
  }

  if (lastError) {
    lines.push(`error: ${lastError}`);
  }

  return lines.join("\n");
}

function filesText(ctx: ExtensionContext) {
  const replays = getPersistedReplays(ctx);
  if (replays.length === 0) return "No TTS files in current branch";

  return replays
    .map((replay, index) => {
      const number = index + 1;
      const cost = formatCost(replay.metrics.estimatedCostUsd);
      const size = formatBytes(replay.metrics.bytes);
      return `${number}. ${replay.createdAt} ${replay.voiceName} ${size} ${cost}\n${replay.audioPath}`;
    })
    .join("\n\n");
}

function enqueueTtsFromAssistantMessage(message: AssistantMessage, ctx: ExtensionContext, pi: ExtensionAPI): boolean {
  if (message.stopReason !== "stop") return false;

  const input = getTtsMessageText(message);
  if (!input) return false;

  const segments = splitIntoWordSegments(input);
  if (segments.length === 0) return false;

  enqueueRun({
    source: "response",
    segments,
    voice: activeVoice,
  }, ctx, pi);

  return true;
}

function findLatestTtsAssistantMessage(ctx: ExtensionContext): { index: number; message: AssistantMessage } | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    if (!getTtsMessageText(entry.message)) continue;
    return { index, message: entry.message };
  }

  return undefined;
}

async function hasReadablePersistedTtsForAssistant(ctx: ExtensionContext, index: number): Promise<boolean> {
  const branch = ctx.sessionManager.getBranch();

  for (const entry of branch.slice(index + 1)) {
    if (entry.type === "message" && entry.message.role === "assistant") return false;
    if (entry.type !== "custom" || entry.customType !== CUSTOM_ENTRY_TYPE || !isPersistedTtsReplay(entry.data)) continue;

    try {
      await readFile(entry.data.audioPath);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function registerTtsCommand(pi: ExtensionAPI) {
  pi.registerCommand("tts", {
    description: "Control Mistral TTS playback",
    getArgumentCompletions: (prefix) => {
      const [command, voicePrefix = ""] = prefix.trimStart().split(/\s+/, 2);

      if (command === "voice") {
        const items = VOICES
          .filter((voice) => voice.name.startsWith(voicePrefix))
          .map((voice) => ({ value: `voice ${voice.name}`, label: voice.name }));
        return items.length > 0 ? items : null;
      }

      if (command === "speed") {
        const items = speedCompletions
          .filter((speed) => speed.startsWith(voicePrefix))
          .map((speed) => ({ value: `speed ${speed}`, label: `${speed}x` }));
        return items.length > 0 ? items : null;
      }

      if (command === "status") {
        const items = statusCompletions
          .filter((status) => status.startsWith(voicePrefix))
          .map((status) => ({ value: `status ${status}`, label: status }));
        return items.length > 0 ? items : null;
      }

      const items = subcommands
        .filter((subcommand) => subcommand.startsWith(command ?? ""))
        .map((subcommand) => ({ value: subcommand, label: subcommand }));
      return items.length > 0 ? items : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const [command = "status", ...rest] = args.trim().split(/\s+/);

      if (command === "generate") {
        await ctx.waitForIdle();

        const latest = findLatestTtsAssistantMessage(ctx);
        if (!latest) {
          ctx.ui.notify("No assistant message with <tts-message> content found", "info");
          return;
        }

        if (await hasReadablePersistedTtsForAssistant(ctx, latest.index)) {
          ctx.ui.notify("TTS already exists for the latest tagged assistant message. Use /tts replay.", "info");
          return;
        }

        enqueueTtsFromAssistantMessage(latest.message, ctx, pi);
        ctx.ui.notify("TTS generation queued", "info");
        return;
      }

      if (command === "replay") {
        if (!lastReplayAudio) {
          ctx.ui.notify("No TTS audio to replay", "info");
          return;
        }

        enqueueRun({
          source: "replay",
          audio: lastReplayAudio.audio,
          metrics: lastReplayAudio.metrics,
          voice: lastReplayAudio.voice,
        }, ctx, pi);
        ctx.ui.notify("TTS replay queued", "info");
        return;
      }

      if (command === "stop") {
        stopAll(ctx);
        ctx.ui.notify("TTS stopped", "info");
        return;
      }

      if (command === "voice") {
        const name = rest.join(" ").trim();
        const voice = findVoice(name);

        if (!voice) {
          ctx.ui.notify(`Unknown TTS voice: ${name || "(empty)"}`, "warning");
          return;
        }

        activeVoice = voice;
        ctx.ui.notify(`TTS voice: ${voice.name}`, "info");
        updateStatus(ctx);
        return;
      }

      if (command === "speed") {
        const rawSpeed = rest.join(" ").trim();
        if (!rawSpeed) {
          ctx.ui.notify(`TTS speed: ${formatSpeed(playbackSpeed)}`, "info");
          return;
        }

        const speed = parsePlaybackSpeed(rawSpeed);
        if (speed === undefined) {
          ctx.ui.notify(`TTS speed must be between ${formatSpeed(MIN_PLAYBACK_SPEED)} and ${formatSpeed(MAX_PLAYBACK_SPEED)}`, "warning");
          return;
        }

        playbackSpeed = speed;
        ctx.ui.notify(`TTS speed: ${formatSpeed(playbackSpeed)}`, "info");
        updateStatus(ctx);
        return;
      }

      if (command === "status") {
        const mode = rest.join(" ").trim();
        if (mode && mode !== "full") {
          ctx.ui.notify("Usage: /tts status [full]", "warning");
          return;
        }

        ctx.ui.notify(statusText(mode === "full"), "info");
        return;
      }

      if (command === "files") {
        ctx.ui.notify(filesText(ctx), "info");
        return;
      }

      ctx.ui.notify("Usage: /tts generate | replay | stop | voice <name> | speed <0.75-2> | status [full] | files", "warning");
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerTtsCommand(pi);

  pi.on("agent_end", async (event, ctx) => {
    const message = [...event.messages]
      .reverse()
      .find((m): m is AssistantMessage => m.role === "assistant");

    if (!message) return;

    enqueueTtsFromAssistantMessage(message, ctx, pi);
  });

  pi.on("session_start", async (_event, ctx) => {
    await restoreReplayAudio(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await restoreReplayAudio(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopAll(ctx);
  });
}

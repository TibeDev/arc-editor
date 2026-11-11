import { listen } from "@tauri-apps/api/event";

type TerminalOutput = { id: string; data: string };
type Subscriber = { callback: (data: string) => void; active: boolean };
type BufferedChunk = { id: string; data: string };
type BufferedOutput = { chunks: BufferedChunk[]; size: number };

const bufferLimit = 2 * 1024 * 1024;
const chunkLimit = 8000;
const replayBatchLimit = 256 * 1024;
const subscribers = new Map<string, Set<Subscriber>>();
const outputHistory = new Map<string, BufferedOutput>();
const historyOrder: BufferedChunk[] = [];
const closedSessions = new Set<string>();
const closedSessionOrder: string[] = [];
let historySize = 0;
let historyHead = 0;
let listener: Promise<void> | undefined;

function trimHistory() {
  while (
    (historySize > bufferLimit ||
      historyOrder.length - historyHead > chunkLimit) &&
    historyHead < historyOrder.length
  ) {
    const oldest = historyOrder[historyHead];
    historyHead += 1;
    const owner = outputHistory.get(oldest.id);
    if (!owner) continue;
    const index = owner.chunks.indexOf(oldest);
    if (index < 0) continue;
    owner.chunks.splice(index, 1);
    owner.size -= oldest.data.length;
    historySize -= oldest.data.length;
    if (!owner.chunks.length) outputHistory.delete(oldest.id);
  }
  if (historyHead > 1024 && historyHead * 2 >= historyOrder.length) {
    historyOrder.splice(0, historyHead);
    historyHead = 0;
  }
}

function ensureListener() {
  if (!listener) {
    listener = listen<TerminalOutput>("terminal-output", ({ payload }) => {
      if (closedSessions.has(payload.id)) return;
      let history = outputHistory.get(payload.id);
      if (!history) {
        history = { chunks: [], size: 0 };
        outputHistory.set(payload.id, history);
      }
      const chunk = { id: payload.id, data: payload.data.length > bufferLimit ? payload.data.slice(-bufferLimit) : payload.data };
      history.chunks.push(chunk);
      history.size += chunk.data.length;
      historyOrder.push(chunk);
      historySize += chunk.data.length;
      trimHistory();
      for (const subscriber of subscribers.get(payload.id) ?? []) {
        if (subscriber.active) subscriber.callback(payload.data);
      }
    }).then(() => undefined).catch((error) => {
      listener = undefined;
      throw error;
    });
  }
  return listener;
}

export function subscribeTerminalOutput(id: string, callback: (data: string) => void) {
  const subscriber: Subscriber = { callback, active: false };
  const sessionSubscribers = subscribers.get(id) ?? new Set<Subscriber>();
  sessionSubscribers.add(subscriber);
  subscribers.set(id, sessionSubscribers);
  void ensureListener().then(() => {
    if (!sessionSubscribers.has(subscriber)) return;
    let batch = "";
    for (const chunk of outputHistory.get(id)?.chunks ?? []) {
      if (!sessionSubscribers.has(subscriber)) return;
      batch += chunk.data;
      if (batch.length >= replayBatchLimit) {
        callback(batch);
        batch = "";
      }
    }
    if (batch) callback(batch);
    if (sessionSubscribers.has(subscriber)) subscriber.active = true;
  }).catch((error) => callback(`\r\nTerminal output listener failed: ${String(error)}\r\n`));

  return () => {
    subscriber.active = false;
    sessionSubscribers.delete(subscriber);
    if (!sessionSubscribers.size) subscribers.delete(id);
  };
}

export function terminalOutputReady() {
  return ensureListener();
}

export function forgetTerminalOutput(id: string) {
  if (!closedSessions.has(id)) {
    closedSessions.add(id);
    closedSessionOrder.push(id);
    if (closedSessionOrder.length > 128) closedSessions.delete(closedSessionOrder.shift()!);
  }
  const history = outputHistory.get(id);
  if (history) {
    historySize -= history.size;
    outputHistory.delete(id);
    for (let index = historyOrder.length - 1; index >= 0; index -= 1) {
      if (historyOrder[index].id === id) historyOrder.splice(index, 1);
    }
    historyHead = 0;
  }
  subscribers.delete(id);
}

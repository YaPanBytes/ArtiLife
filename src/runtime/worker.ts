// Entry point of the simulation worker. All the logic is in WorkerRuntime.
import type { Command, Reply } from './protocol';
import { WorkerRuntime } from './worker-runtime';

const scope = self as unknown as {
  postMessage(message: Reply): void;
  onmessage: ((event: MessageEvent<Command>) => void) | null;
};

const runtime = new WorkerRuntime((reply) => scope.postMessage(reply));
scope.onmessage = (event) => runtime.handle(event.data);

// Normally look again every few milliseconds. When the simulation is running flat out and
// still behind, look again at once: a timer would leave it idle between bursts.
const channel = new MessageChannel();
const loop = () => {
  if (runtime.pump(performance.now())) channel.port2.postMessage(null);
  else setTimeout(loop, 4);
};
channel.port1.onmessage = loop;
loop();

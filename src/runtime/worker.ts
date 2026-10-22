// Entry point of the simulation worker. All the logic is in WorkerRuntime.
import type { Command, Reply } from './protocol';
import { WorkerRuntime } from './worker-runtime';

const scope = self as unknown as {
  postMessage(message: Reply): void;
  onmessage: ((event: MessageEvent<Command>) => void) | null;
};

const runtime = new WorkerRuntime((reply) => scope.postMessage(reply));
scope.onmessage = (event) => runtime.handle(event.data);

const loop = () => {
  runtime.pump(performance.now());
  setTimeout(loop, 4);
};
loop();

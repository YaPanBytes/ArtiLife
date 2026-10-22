import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../src/game';
import { attachInput } from '../src/ui/input';

type Handler = (e: { key: string; target?: unknown; preventDefault?: () => void }) => void;

class FakeButton {}
class FakeInput {
  constructor(public type: string) {}
}

describe('keyboard input', () => {
  const handlers = new Map<string, Handler>();
  let held: Set<string>;
  let toggles: number;

  beforeEach(() => {
    handlers.clear();
    held = new Set();
    toggles = 0;
    vi.stubGlobal('HTMLInputElement', FakeInput);
    vi.stubGlobal('HTMLButtonElement', FakeButton);
    vi.stubGlobal('window', {
      addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
    });
    const game = {
      view: { paused: false },
      keyDown: (k: string) => held.add(k),
      keyUp: (k: string) => held.delete(k),
      setPaused: () => toggles++,
    } as unknown as Game;
    const canvas = { addEventListener: () => undefined } as unknown as HTMLCanvasElement;
    attachInput(canvas, game);
  });
  afterEach(() => vi.unstubAllGlobals());

  const press = (key: string, target: unknown = {}) =>
    handlers.get('keydown')!({ key, target, preventDefault: () => undefined });
  const release = (key: string) => handlers.get('keyup')!({ key });

  it('stops scrolling when the key goes up, even if shift changed its case in between', () => {
    press('a');
    expect(held.has('a')).toBe(true);
    release('A');
    expect(held.size).toBe(0);
    press('D');
    expect(held.has('d')).toBe(true);
    release('d');
    expect(held.size).toBe(0);
  });

  it('pauses on space wherever the focus is, without also pressing a focused button', () => {
    press(' ');
    expect(toggles).toBe(1);
    // A button the player clicked earlier still has the focus: space pauses, and the
    // browser is told not to press the button as the key comes up.
    const button = new FakeButton();
    press(' ', button);
    expect(toggles).toBe(2);
    let prevented = 0;
    handlers.get('keyup')!({ key: ' ', target: button, preventDefault: () => prevented++ });
    expect(prevented).toBe(1);
    // Typing a seed is different: space belongs to the text box.
    press(' ', new FakeInput('number'));
    expect(toggles).toBe(2);
    handlers.get('keyup')!({
      key: ' ',
      target: new FakeInput('number'),
      preventDefault: () => prevented++,
    });
    expect(prevented).toBe(1);
  });
});

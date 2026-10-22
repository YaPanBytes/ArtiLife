import { SCREEN_H, SCREEN_W } from '../render/layout';
import type { Game } from '../game';

/** Pointer movement beyond this many CSS pixels turns a click into a drag. */
const DRAG_THRESHOLD = 4;

const PAN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd']);

/** Mouse, touch and keyboard controls for the playfield. */
export function attachInput(canvas: HTMLCanvasElement, game: Game): void {
  /** Screen pixel (0-255, 0-223) under a pointer event. */
  const toScreen = (e: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left - canvas.clientLeft) * SCREEN_W) / canvas.clientWidth;
    const y = ((e.clientY - rect.top - canvas.clientTop) * SCREEN_H) / canvas.clientHeight;
    return [Math.floor(x), Math.floor(y)];
  };

  let down: { x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD) {
      down.dragging = true;
    }
    if (down.dragging) {
      const pixelsPerScreenPixel = canvas.clientWidth / SCREEN_W;
      game.panBy(
        -(e.clientX - down.lastX) / pixelsPerScreenPixel,
        -(e.clientY - down.lastY) / pixelsPerScreenPixel,
      );
    }
    down.lastX = e.clientX;
    down.lastY = e.clientY;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (down && !down.dragging) game.click(...toScreen(e));
    down = null;
  });
  canvas.addEventListener('pointercancel', () => (down = null));

  const typing = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement &&
    e.target.type !== 'range' &&
    e.target.type !== 'checkbox';

  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (PAN_KEYS.has(e.key)) {
      game.keyDown(e.key);
      e.preventDefault();
    } else if (e.key === ' ') {
      game.setPaused(!game.view.paused);
      e.preventDefault();
    } else if (e.key === '.') game.stepOnce();
    else if (e.key === '[') game.changeSpeed(-1);
    else if (e.key === ']') game.changeSpeed(1);
    else if (e.key === 'Escape') game.deselect();
    else if (e.key >= '1' && e.key <= '6') void game.setIsland(Number(e.key) - 1);
    else if (e.key === 'g') game.toggleGlyph();
    else if (e.key === 'o') game.cycleOverlay(1);
  });
  window.addEventListener('keyup', (e) => game.keyUp(e.key));
  window.addEventListener('blur', () => PAN_KEYS.forEach((k) => game.keyUp(k)));
  window.addEventListener('resize', () => game.fit());
}

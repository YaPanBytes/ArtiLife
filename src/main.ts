import './ui/style.css';
import { Game } from './game';
import { attachInput } from './ui/input';

const params = new URLSearchParams(window.location.search);
const number = (name: string): number | undefined => {
  const raw = params.get(name);
  return raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
};

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

// The HUD text uses a pixel font, so wait for it before the first frame.
document.fonts
  .load('8px "Press Start 2P"')
  .catch(() => undefined)
  .then(() => {
    const game = new Game(canvas, panel, {
      seed: number('seed'),
      warmup: number('warmup'),
      paused: params.get('paused') === '1',
      select: number('select'),
    });
    attachInput(canvas, game);
    // Handy for poking at the simulation from the browser console.
    (window as unknown as { artilife: Game }).artilife = game;
    game.start();
  });

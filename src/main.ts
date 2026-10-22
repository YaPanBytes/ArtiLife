import './ui/style.css';
import { Game } from './game';
import { decodeShare } from './share';
import { resolveConfig, type SimConfig } from './sim/config';
import { attachInput } from './ui/input';

const params = new URLSearchParams(window.location.search);
const number = (name: string): number | undefined => {
  const raw = params.get(name);
  return raw !== null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
};

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;

// Rules and seed: from a share link if there is one, else the defaults (and ?seed=).
let settings: SimConfig;
let problem = '';
try {
  const code = params.get('s');
  settings = code ? decodeShare(code) : resolveConfig();
} catch (error) {
  problem = `BAD LINK: ${(error as Error).message}`;
  settings = resolveConfig();
}
const seed = number('seed');
if (seed !== undefined) settings.seed = Math.floor(seed);

async function main(): Promise<void> {
  // The HUD text uses a pixel font, so wait for it before the first frame.
  await document.fonts.load('8px "Press Start 2P"').catch(() => undefined);
  const game = await Game.create(canvas, panel, {
    settings,
    warmup: number('warmup'),
    paused: params.get('paused') === '1',
    select: number('select'),
    worker: params.get('worker') !== '0',
  });
  attachInput(canvas, game);
  // Handy for poking at the game from the browser console.
  (window as unknown as { artilife: Game }).artilife = game;
  if (problem) game.notify(problem);
  game.start();
}

void main();

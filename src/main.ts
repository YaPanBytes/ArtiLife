// Placeholder entry point: draws the generated world to the 256x224 buffer to
// check the scaffold end to end. The real renderer replaces this in step 4.
import { resolveConfig } from './sim/config';
import { Rng } from './sim/rng';
import { Terrain, World } from './sim/world';

const config = resolveConfig();
const world = new World(config, new Rng(config.seed));

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const image = ctx.createImageData(canvas.width, canvas.height);

function draw(): void {
  const px = image.data;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const tx = Math.floor((x * world.width) / canvas.width);
      const ty = Math.floor((y * world.height) / canvas.height);
      const i = ty * world.width + tx;
      let r = 0,
        g = 0,
        b = 0;
      if (world.terrain[i] === Terrain.Water) [r, g, b] = [40, 60, 200];
      else if (world.terrain[i] === Terrain.Rock) [r, g, b] = [120, 80, 40];
      else {
        const f = world.food[i] / config.food.maxPerTile;
        [r, g, b] = [200 - 150 * f, 170 + 30 * f, 120 - 60 * f];
      }
      const o = (y * canvas.width + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

let tick = 0;
function frame(): void {
  world.stepFood(tick++);
  draw();
  requestAnimationFrame(frame);
}
frame();

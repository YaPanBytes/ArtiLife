// Placeholder entry point: draws the world and creatures to the 256x224 buffer to
// check the simulation end to end. The real renderer replaces this in step 4.
import { Simulation } from './sim/simulation';
import { Terrain } from './sim/world';

const sim = new Simulation();
const { world, config } = sim;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const image = ctx.createImageData(canvas.width, canvas.height);
const sx = canvas.width / world.width;
const sy = canvas.height / world.height;

function drawWorld(): void {
  const px = image.data;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = Math.floor(y / sy) * world.width + Math.floor(x / sx);
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

function drawCreatures(): void {
  for (const c of sim.creatures) {
    ctx.fillStyle = `hsl(${Math.round(c.traits.hue * 360)} 80% 45%)`;
    const size = Math.max(2, Math.round(c.traits.size * 2));
    ctx.fillRect(Math.round(c.x * sx - size / 2), Math.round(c.y * sy - size / 2), size, size);
  }
}

const TICKS_PER_FRAME = 3;

function drawLabel(): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 92, 10);
  ctx.fillStyle = '#fff';
  ctx.font = '8px monospace';
  ctx.fillText(`pop ${sim.creatures.length}  tick ${sim.tick}`, 2, 8);
}

function frame(): void {
  for (let i = 0; i < TICKS_PER_FRAME; i++) sim.step();
  drawWorld();
  drawCreatures();
  drawLabel();
  requestAnimationFrame(frame);
}
frame();

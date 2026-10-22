import type { Camera } from './camera';

/** How the world is drawn. */
export type RenderMode = 'tile' | 'glyph';

/** What creatures (or the ground) are coloured by, instead of their own hue. */
export type Overlay = 'none' | 'energy' | 'age' | 'diet' | 'species' | 'food';

export const OVERLAYS: readonly Overlay[] = ['none', 'energy', 'age', 'diet', 'species', 'food'];

/** What the player is looking at and how the game is running. Shared by input, UI and renderer. */
export interface ViewState {
  camera: Camera;
  /** The creature being followed, or null for the free camera. */
  selectedId: number | null;
  paused: boolean;
  mode: RenderMode;
  overlay: Overlay;
}

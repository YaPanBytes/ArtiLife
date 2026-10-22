import type { Camera } from './camera';

/** What the player is looking at and how the game is running. Shared by input, UI and renderer. */
export interface ViewState {
  camera: Camera;
  /** The creature being followed, or null for the free camera. */
  selectedId: number | null;
  paused: boolean;
}

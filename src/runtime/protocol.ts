import type { SimConfig } from '../sim/config';
import type { DisasterKind } from '../sim/disasters';
import type { Analysis, CreatureDetail, SceneFrame, WorldInfo } from './types';

/** Messages from the page to the simulation worker. */
export type Command =
  | { type: 'newWorld'; id: number; settings: SimConfig; warmup: number }
  | { type: 'paused'; value: boolean }
  | { type: 'speed'; value: number }
  | { type: 'step' }
  | { type: 'config'; path: string; value: number | boolean | string }
  | { type: 'select'; id: number | null }
  | { type: 'trigger'; kind: DisasterKind }
  | { type: 'save'; id: number }
  | { type: 'load'; id: number; text: string }
  /** The page has dealt with this many frames: it drew the newest and discarded any older ones. */
  | { type: 'ack'; count: number };

/** What one frame of the simulation looks like to the page. */
export interface FrameData {
  scene: SceneFrame;
  detail: CreatureDetail | null;
  /** Only sent when it has changed since the last frame. */
  analysis: Analysis | null;
  paused: boolean;
  speed: number;
}

/** Messages from the simulation worker to the page. */
export type Reply =
  | { type: 'world'; id: number; world: WorldInfo; settings: SimConfig }
  | { type: 'frame'; frame: FrameData }
  | { type: 'saved'; id: number; text: string }
  | { type: 'failed'; id: number; message: string };

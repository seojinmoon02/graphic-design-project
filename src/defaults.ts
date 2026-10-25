import type { ExperimentState, PatternSettings, WorkspaceState } from './types';

export const DEFAULT_PATTERN: PatternSettings = {
  kind: 'wave', repeat: 4, rotation: 0, brightness: 100,
  saturation: 100, opacity: 100, background: '#eae8df',
};
export const DEFAULT_CAMERA = {
  position: [9, 7.5, 10] as [number, number, number],
  target: [0, 2.15, 0] as [number, number, number], zoom: 1,
};
export const CAMERA_PRESETS = {
  default: DEFAULT_CAMERA,
  front: { position: [0, 3.2, 12] as [number, number, number], target: [0, 2.5, 0] as [number, number, number], zoom: 1 },
  left: { position: [10, 3.2, 0] as [number, number, number], target: [0, 2.5, 0] as [number, number, number], zoom: 1 },
  wide: { ...DEFAULT_CAMERA, zoom: 0.8 },
};
export const createExperiment = (): ExperimentState => ({
  left: { ...DEFAULT_PATTERN }, back: { ...DEFAULT_PATTERN }, linked: true, target: 'both',
  object: { kind: 'vase', scale: 1, rotation: 0, color: '#3159c7', roughness: 0.38, gloss: 0.3 },
  light: 1, shadows: true, floor: '#e3e2dc', pedestal: '#f6f5f1',
  camera: structuredClone(DEFAULT_CAMERA), cameraLocked: false, note: '',
});
export const createWorkspace = (): WorkspaceState => ({
  version: 1, current: createExperiment(), a: null, b: null, compare: false, patternOnly: true,
});

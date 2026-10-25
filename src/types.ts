export type PatternKind = 'wave' | 'stripe' | 'check' | 'dot' | 'grid' | 'none' | 'upload';
export type ObjectKind = 'vase' | 'sphere' | 'cube' | 'torus' | 'sculpture' | 'upload';
export type WallTarget = 'both' | 'left' | 'back';
export type CameraPreset = 'default' | 'front' | 'left' | 'wide';
export interface PatternSettings {
  kind: PatternKind;
  assetId?: string;
  fileName?: string;
  repeat: number;
  rotation: number;
  brightness: number;
  saturation: number;
  opacity: number;
  background: string;
  originalBackground?: string;
}
export interface ObjectSettings {
  kind: ObjectKind;
  assetId?: string;
  fileName?: string;
  scale: number;
  rotation: number;
  color: string;
  roughness: number;
  gloss: number;
}
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}
export interface ExperimentState {
  left: PatternSettings;
  back: PatternSettings;
  linked: boolean;
  target: WallTarget;
  object: ObjectSettings;
  light: number;
  shadows: boolean;
  floor: string;
  pedestal: string;
  camera: CameraState;
  cameraLocked: boolean;
  note: string;
}
export interface WorkspaceState {
  version: 1;
  current: ExperimentState;
  a: ExperimentState | null;
  b: ExperimentState | null;
  compare: boolean;
  patternOnly: boolean;
}
export interface StoredAsset {
  id: string;
  name: string;
  type: 'pattern' | 'model';
  blob: Blob;
}
export type AssetResolver = (id: string) => Promise<Blob | undefined>;
export interface ViewportHandle {
  exportPNG: () => Promise<Blob>;
}
export interface ViewportProps {
  state: ExperimentState;
  comparison?: ExperimentState;
  resolveAsset: AssetResolver;
  onCameraChange: (camera: CameraState) => void;
  onError: (message: string) => void;
  onLoading?: (loading: boolean) => void;
}

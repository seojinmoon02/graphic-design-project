import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { AssetResolver, CameraState, ExperimentState } from '../types';
import { createObject, disposeObject, updateObject } from './objects';
import { createPatternTexture } from './patterns';

type EngineCallbacks = {
  onCameraChange: (camera: CameraState) => void;
  onError: (message: string) => void;
  onLoading: (loading: boolean) => void;
};

class Room {
  scene = new THREE.Scene();
  private left: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private back: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private pedestal: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private ambient: THREE.AmbientLight;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private object?: THREE.Group;
  private objectKey = '';
  private leftKey = '';
  private backKey = '';
  private objectVersion = 0;
  private leftVersion = 0;
  private backVersion = 0;
  private disposed = false;
  private current?: ExperimentState;

  constructor(
    environment: THREE.Texture,
    private changed: () => void,
    private onError: (message: string) => void,
    private pending: (delta: number) => void,
  ) {
    this.scene.background = new THREE.Color('#f4f5f0');
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.35;
    const wallMaterial = () => new THREE.MeshStandardMaterial({ color: '#eae8df', roughness: 1 });
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), wallMaterial());
    this.back.name = 'room-back-wall';
    this.back.position.set(0, 2.5, -2.5);
    this.left = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), wallMaterial());
    this.left.name = 'room-left-wall';
    this.left.position.set(-2.5, 2.5, 0);
    this.left.rotation.y = Math.PI / 2;
    // Unfold the two walls into one strip: left -1..0, back 0..1.
    // This matches the corner phase without mirroring asymmetric uploaded artwork.
    const uv = this.left.geometry.attributes.uv;
    for (let index = 0; index < uv.count; index++) uv.setX(index, uv.getX(index) - 1);
    uv.needsUpdate = true;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ color: '#e3e2dc', roughness: 0.95 }));
    this.floor.name = 'room-floor';
    this.floor.rotation.x = -Math.PI / 2;
    this.pedestal = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 1), new THREE.MeshStandardMaterial({ color: '#f6f5f1', roughness: 0.83 }));
    this.pedestal.name = 'room-pedestal';
    this.pedestal.position.y = 1.25;
    [this.back, this.left, this.floor, this.pedestal].forEach((mesh) => { mesh.receiveShadow = true; });
    this.pedestal.castShadow = true;
    this.scene.add(this.back, this.left, this.floor, this.pedestal);
    // Thin, neutral room outlines make the exact proportions legible without decorative walls.
    const outlineMaterial = new THREE.LineBasicMaterial({ color: '#b4b4aa', transparent: true, opacity: 0.5 });
    const outlinePoints = [
      [-2.5, 5, 2.5], [-2.5, 5, -2.5], [2.5, 5, -2.5],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), outlineMaterial));
    this.ambient = new THREE.AmbientLight('#ffffff', 1.9);
    this.key = new THREE.DirectionalLight('#ffffff', 3.3);
    this.key.position.set(2, 9, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -5;
    this.key.shadow.camera.right = 5;
    this.key.shadow.camera.top = 7;
    this.key.shadow.camera.bottom = -5;
    this.key.shadow.camera.near = 0.1;
    this.key.shadow.camera.far = 25;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.015;
    this.key.shadow.radius = 4;
    this.fill = new THREE.DirectionalLight('#ffffff', 1.1);
    this.fill.position.set(-1, 5, 3);
    this.scene.add(this.ambient, this.key, this.fill);
  }

  update(state: ExperimentState, resolveAsset: AssetResolver) {
    this.current = state;
    this.floor.material.color.set(state.floor);
    this.pedestal.material.color.set(state.pedestal);
    this.ambient.intensity = 1.9 * state.light;
    this.key.intensity = 3.3 * state.light;
    this.fill.intensity = 1.1 * state.light;
    this.key.castShadow = state.shadows;
    const updateWall = async (side: 'left' | 'back') => {
      const settings = state[side];
      const key = JSON.stringify(settings);
      if (key === (side === 'left' ? this.leftKey : this.backKey)) return;
      if (side === 'left') this.leftKey = key;
      else this.backKey = key;
      const version = side === 'left' ? ++this.leftVersion : ++this.backVersion;
      const isUpload = settings.kind === 'upload';
      if (isUpload) this.pending(1);
      try {
        const texture = await createPatternTexture(settings, resolveAsset);
        if (this.disposed || version !== (side === 'left' ? this.leftVersion : this.backVersion)) { texture?.dispose(); return; }
        const material = this[side].material;
        material.map?.dispose();
        material.map = texture;
        material.color.set(texture ? '#ffffff' : settings.background);
        material.needsUpdate = true;
        this.changed();
      } catch (error) {
        if (!this.disposed) this.onError(error instanceof Error ? error.message : '패턴을 불러오지 못했습니다.');
      } finally { if (isUpload) this.pending(-1); }
    };
    void updateWall('left');
    void updateWall('back');
    const objectKey = `${state.object.kind}:${state.object.assetId ?? ''}`;
    if (objectKey !== this.objectKey) {
      this.objectKey = objectKey;
      const version = ++this.objectVersion;
      const isUpload = state.object.kind === 'upload';
      if (isUpload) this.pending(1);
      void createObject(state.object, resolveAsset).then((object) => {
        if (this.disposed || version !== this.objectVersion) { disposeObject(object); return; }
        if (this.object) disposeObject(this.object);
        this.object = object;
        updateObject(object, this.current!.object);
        this.scene.add(object);
        this.changed();
      }).catch((error) => {
        if (!this.disposed) this.onError(error instanceof Error ? error.message : '오브젝트를 불러오지 못했습니다.');
      }).finally(() => { if (isUpload) this.pending(-1); });
    } else if (this.object) updateObject(this.object, state.object);
    this.changed();
  }

  dispose() {
    this.disposed = true;
    ++this.objectVersion; ++this.leftVersion; ++this.backVersion;
    disposeObject(this.scene);
    // Line geometries are not meshes and need explicit disposal.
    this.scene.traverse((object) => {
      if (object instanceof THREE.Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.key.shadow.map?.dispose();
  }
}

export class SceneEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  readonly controls: OrbitControls;
  private rooms: Room[] = [];
  private environmentTarget: THREE.WebGLRenderTarget;
  private observer: ResizeObserver;
  private width = 1;
  private height = 1;
  private comparison = false;
  private applyingCamera = false;
  private frame = 0;
  private disposed = false;
  private pendingCount = 0;

  constructor(private container: HTMLElement, private callbacks: EngineCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '패턴과 오브젝트를 실험하는 3D 공간');
    canvas.setAttribute('role', 'img');
    canvas.dataset.roomSize = '5 × 5 × 5';
    canvas.dataset.pedestalSize = '1 × 1 × 2.5';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(environment, 0.04);
    environment.dispose();
    pmrem.dispose();
    this.rooms.push(this.createRoom());
    this.camera.position.set(9, 7.5, 10);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 2.15, 0);
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minAzimuthAngle = 0;
    this.controls.maxAzimuthAngle = Math.PI / 2;
    this.controls.minZoom = 0.5;
    this.controls.maxZoom = 2.4;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 25;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.update();
    this.controls.addEventListener('change', this.cameraChanged);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.resize();
  }

  private createRoom() {
    return new Room(this.environmentTarget.texture, this.requestRender, this.callbacks.onError, (delta) => {
      this.pendingCount = Math.max(0, this.pendingCount + delta);
      if (!this.disposed) this.callbacks.onLoading(this.pendingCount > 0);
    });
  }

  private cameraChanged = () => {
    if (this.applyingCamera || this.disposed) return;
    this.callbacks.onCameraChange({
      position: this.camera.position.toArray() as CameraState['position'],
      target: this.controls.target.toArray() as CameraState['target'],
      zoom: this.camera.zoom,
    });
    this.requestRender();
  };

  update(state: ExperimentState, comparison: ExperimentState | undefined, resolveAsset: AssetResolver) {
    this.comparison = !!comparison;
    this.controls.enabled = !state.cameraLocked;
    const position = new THREE.Vector3(...state.camera.position);
    const target = new THREE.Vector3(...state.camera.target);
    if (this.camera.position.distanceToSquared(position) > 1e-10 || this.controls.target.distanceToSquared(target) > 1e-10 || Math.abs(this.camera.zoom - state.camera.zoom) > 1e-8) {
      this.applyingCamera = true;
      this.camera.position.copy(position);
      this.camera.zoom = state.camera.zoom;
      this.controls.target.copy(target);
      this.controls.update();
      this.applyingCamera = false;
    }
    this.rooms[0].update(state, resolveAsset);
    if (comparison) {
      if (!this.rooms[1]) this.rooms.push(this.createRoom());
      this.rooms[1].update(comparison, resolveAsset);
    } else if (this.rooms[1]) {
      this.rooms.pop()!.dispose();
    }
    this.requestRender();
  }

  private resize = () => {
    const { width, height } = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.renderer.setSize(this.width, this.height, false);
    this.requestRender();
  };

  private setProjection(width: number, height: number) {
    const aspect = width / height;
    const halfHeight = Math.max(4.15, 4.3 / aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private render = () => {
    this.frame = 0;
    if (this.disposed) return;
    const count = this.comparison ? 2 : 1;
    this.renderer.setScissorTest(true);
    for (let index = 0; index < count; index++) {
      const left = Math.round(this.width * index / count);
      const right = Math.round(this.width * (index + 1) / count);
      const width = right - left;
      this.renderer.setViewport(left, 0, width, this.height);
      this.renderer.setScissor(left, 0, width, this.height);
      this.setProjection(width, this.height);
      this.renderer.render(this.rooms[index].scene, this.camera);
    }
    this.renderer.setScissorTest(false);
  };

  private requestRender = () => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.render);
  };

  async exportPNG(): Promise<Blob> {
    if (this.pendingCount > 0) throw new Error('파일을 불러오는 중입니다. 잠시 후 다시 저장해 주세요.');
    this.render();
    return new Promise((resolve, reject) => {
      this.renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error('이미지를 저장하지 못했습니다. 다시 시도해 주세요.')), 'image/png');
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.removeEventListener('change', this.cameraChanged);
    this.controls.dispose();
    this.rooms.forEach((room) => room.dispose());
    this.environmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

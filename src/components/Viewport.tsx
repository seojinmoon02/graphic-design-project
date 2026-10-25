import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { SceneEngine } from '../scene/engine';
import type { ViewportHandle, ViewportProps } from '../types';

const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<SceneEngine | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    exportPNG: async () => {
      if (!engine.current) throw new Error('3D 화면이 준비되지 않았습니다.');
      return engine.current.exportPNG();
    },
  }), []);

  useEffect(() => {
    if (!container.current) return;
    try {
      engine.current = new SceneEngine(container.current, {
        onCameraChange: (camera) => latest.current.onCameraChange(camera),
        onError: (message) => latest.current.onError(message),
        onLoading: (loading) => latest.current.onLoading?.(loading),
      });
      engine.current.update(latest.current.state, latest.current.comparison, latest.current.resolveAsset);
    } catch (error) {
      console.error('3D 화면 초기화 실패', error);
      setFailed(true);
      latest.current.onError('3D 화면을 시작할 수 없습니다. WebGL을 지원하는 최신 브라우저에서 다시 열어 주세요.');
    }
    return () => { engine.current?.dispose(); engine.current = null; };
  }, []);

  useEffect(() => {
    engine.current?.update(props.state, props.comparison, props.resolveAsset);
  }, [props.state, props.comparison, props.resolveAsset]);

  return <div className="three-viewport" ref={container} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
    {failed && <div className="webgl-fallback" role="alert">
      <strong>3D 화면을 불러올 수 없어요</strong>
      <p>WebGL을 지원하는 최신 브라우저에서 열고 하드웨어 가속을 확인해 주세요.</p>
    </div>}
  </div>;
});

export default Viewport;

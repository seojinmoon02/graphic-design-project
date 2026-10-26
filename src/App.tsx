import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Expand, Focus, Layers2, LockKeyhole, Maximize2, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, Plus, RotateCcw, ScanLine, UnlockKeyhole, X } from 'lucide-react';
import { CAMERA_PRESETS, createWorkspace } from './defaults';
import type { CameraPreset, CameraState, ExperimentState, StoredAsset, ViewportHandle, WorkspaceState } from './types';
import { PatternPanel, ObjectPanel } from './components/Controls';
import Viewport from './components/Viewport';
import { assetIds, clearWorkspace, listSavedPatterns, loadWorkspace, pruneAssets, rememberWorkspace, removeSavedPattern, resolveAsset, saveAsset, saveWorkspace } from './lib/storage';
import { validateModel, validatePattern } from './lib/uploads';
import { createObject, disposeObject } from './scene/objects';

type Toast = { message: string; error?: boolean };

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(createWorkspace);
  const [savedPatterns, setSavedPatterns] = useState<StoredAsset[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState('불러오는 중');
  const [busy, setBusy] = useState<'pattern' | 'model' | null>(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [focus, setFocus] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const viewport = useRef<ViewportHandle>(null);
  const saveGeneration = useRef(0);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const sceneError = useCallback((message: string) => notify(message, true), [notify]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([loadWorkspace(), listSavedPatterns()]).then(([saved, patterns]) => {
      if (!active) return;
      if (saved.status === 'fulfilled') {
        if (saved.value) setWorkspace(saved.value);
      } else {
        notify('저장된 작업을 불러오지 못했습니다. 브라우저의 저장 공간 설정을 확인해 주세요.', true);
      }
      if (patterns.status === 'fulfilled') setSavedPatterns(patterns.value);
      else notify('내 패턴 목록을 불러오지 못했습니다. 브라우저의 저장 공간 설정을 확인해 주세요.', true);
      setHydrated(true);
    });
    return () => { active = false; };
  }, [notify]);

  useLayoutEffect(() => {
    if (hydrated) rememberWorkspace(workspace);
  }, [workspace, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus('저장 중');
    const generation = ++saveGeneration.current;
    const timer = setTimeout(() => {
      saveWorkspace(workspace).then(() => {
        if (saveGeneration.current === generation) setSaveStatus('자동 저장됨');
      }).catch(() => {
        setSaveStatus('저장 실패');
        notify('저장 공간이 부족하거나 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.', true);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [workspace, hydrated, notify]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFocus(false); setLeftOpen(false); setRightOpen(false); setResetOpen(false); setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = useCallback((patch: Partial<ExperimentState>) => {
    setWorkspace(previous => ({ ...previous, current: { ...previous.current, ...patch } }));
  }, []);

  const cameraChange = useCallback((camera: CameraState) => {
    setWorkspace(previous => ({ ...previous, current: { ...previous.current, camera } }));
  }, []);

  const upload = useCallback(async (file: File, type: 'pattern' | 'model') => {
    setBusy(type);
    try {
      if (type === 'pattern') await validatePattern(file);
      else {
        await validateModel(file);
        const object = await createObject({ ...createWorkspace().current.object, kind: 'upload', assetId: 'validation' }, async () => file);
        disposeObject(object);
      }
      const id = crypto.randomUUID();
      const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
      const mime = type === 'model' ? 'model/gltf-binary' : imageTypes[file.name.split('.').pop()?.toLowerCase() ?? ''];
      const asset: StoredAsset = { id, name: file.name, type, blob: new Blob([file], { type: mime || file.type }), createdAt: Date.now(), ...(type === 'pattern' ? { inLibrary: true } : {}) };
      await saveAsset(asset);
      if (type === 'pattern') setSavedPatterns(previous => [asset, ...previous]);
      setWorkspace(previous => {
        const current = previous.current;
        if (type === 'model') return { ...previous, current: { ...current, object: { ...current.object, kind: 'upload', assetId: id, fileName: file.name, scale: 1, rotation: 0 } } };
        const nextPattern = { kind: 'upload' as const, assetId: id, fileName: file.name, repeat: 4, rotation: 0, brightness: 100, saturation: 100, opacity: 100 };
        const both = current.linked || current.target === 'both';
        return { ...previous, current: { ...current,
          left: both || current.target === 'left' ? { ...current.left, ...nextPattern, originalBackground: current.left.background } : current.left,
          back: both || current.target === 'back' ? { ...current.back, ...nextPattern, originalBackground: current.back.background } : current.back,
        } };
      });
      notify(`${type === 'pattern' ? '패턴' : '모델'}을 불러왔습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '파일을 불러오지 못했습니다.', true);
    } finally { setBusy(null); }
  }, [notify]);

  const selectSavedPattern = useCallback((asset: StoredAsset) => {
    setWorkspace(previous => {
      const current = previous.current;
      const source = { kind: 'upload' as const, assetId: asset.id, fileName: asset.name };
      const both = current.linked || current.target === 'both';
      return { ...previous, current: { ...current,
        left: both || current.target === 'left' ? { ...current.left, ...source, originalBackground: current.left.background } : current.left,
        back: both || current.target === 'back' ? { ...current.back, ...source, originalBackground: current.back.background } : current.back,
      } };
    });
  }, []);

  const deleteSavedPattern = useCallback(async (asset: StoredAsset) => {
    try {
      await removeSavedPattern(asset.id);
      setSavedPatterns(previous => previous.filter(pattern => pattern.id !== asset.id));
      await pruneAssets(assetIds(workspaceRef.current)).catch(() => { /* library removal succeeded; cleanup can retry later */ });
      notify('내 패턴 목록에서 삭제했습니다. 적용 중인 장면과 A/B 기록은 유지됩니다.');
    } catch (error) {
      notify(error instanceof Error ? error.message : '내 패턴을 삭제하지 못했습니다.', true);
    }
  }, [notify]);

  const saveSnapshot = (slot: 'a' | 'b') => {
    setWorkspace(previous => ({ ...previous, [slot]: structuredClone(previous.current) }));
    notify(`${slot.toUpperCase()}에 현재 실험을 저장했습니다.`);
  };

  const toggleCompare = () => {
    setWorkspace(previous => {
      if (previous.compare) return { ...previous, compare: false };
      const a = previous.a ?? structuredClone(previous.current);
      const b = previous.b ?? structuredClone(previous.current);
      return { ...previous, a, b, compare: true, current: { ...previous.current, camera: structuredClone(a.camera) } };
    });
    setLeftOpen(false); setRightOpen(false);
  };

  const reset = async () => {
    try {
      await clearWorkspace({ preservePatternLibrary: true });
      const next = createWorkspace();
      setWorkspace(next);
      await saveWorkspace(next);
      await pruneAssets([]);
      setResetOpen(false);
      notify('새로운 실험을 시작합니다.');
    } catch { notify('초기화에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.', true); }
  };

  const exportImage = async () => {
    if (!viewport.current) return;
    setExporting(true);
    try {
      const blob = await viewport.current.exportPNG();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pattern-room${workspace.compare ? '-compare' : ''}-${Date.now()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('장면을 PNG 이미지로 저장했습니다.');
    } catch (error) { notify(error instanceof Error ? error.message : '이미지를 저장하지 못했습니다.', true); }
    finally { setExporting(false); }
  };

  // Keep assets used by the current work and both snapshots. Debounce cleanup until changes settle.
  useEffect(() => {
    if (!hydrated || busy) return;
    const timer = setTimeout(() => {
      pruneAssets(assetIds(workspaceRef.current)).catch(() => { /* saving remains independent */ });
    }, 10000);
    return () => clearTimeout(timer);
  }, [workspace, hydrated, busy]);

  const current = workspace.current;
  const renderedState = workspace.compare && workspace.a ? { ...workspace.a, camera: current.camera, cameraLocked: current.cameraLocked } : current;
  const comparison = workspace.compare && workspace.a && workspace.b
    ? workspace.patternOnly ? { ...workspace.a, left: workspace.b.left, back: workspace.b.back } : workspace.b
    : undefined;
  const preset = (value: CameraPreset) => update({ camera: structuredClone(CAMERA_PRESETS[value]) });
  const changeZoom = (amount: number) => update({ camera: { ...current.camera, zoom: Math.min(2.3, Math.max(0.5, current.camera.zoom + amount)) } });

  return (
    <div className={`app ${focus ? 'is-focused' : ''} ${workspace.compare ? 'is-comparing' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="PATTERN ROOM 홈">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>PATTERN ROOM<span className="brand-dot">®</span></span>
        </a>
        <span className="header-divider" />
        <span className="project-title">나의 디자인 실험실 <ChevronDown size={12} /></span>
        <div className="header-actions">
          <span className="autosave" aria-live="polite"><span className={saveStatus === '저장 실패' ? 'status-dot error' : 'status-dot'} />{saveStatus}</span>
          <button className="button ghost reset-button" onClick={() => setResetOpen(true)}><RotateCcw size={15} /><span>초기화</span></button>
          <button className={`button outline compare-button ${workspace.compare ? 'active' : ''}`} onClick={toggleCompare} aria-pressed={workspace.compare}><ArrowLeftRight size={15} /><span>{workspace.compare ? '편집으로 돌아가기' : 'A/B 비교'}</span></button>
          <button className="button primary export-button" onClick={exportImage} disabled={exporting || !hydrated || sceneLoading}><ArrowDownToLine size={15} /><span>{exporting ? '저장 중…' : '이미지 저장'}</span></button>
        </div>
      </header>

      <div className="workspace-bar">
        <div className="workspace-heading"><span className="workspace-indicator" />작업 공간<span className="workspace-slash">/</span><span className="experiment-name">실험 01</span><span className="tag">개인 작업</span></div>
        <button className="text-button" onClick={() => setHelpOpen(true)}><CircleHelp size={14} /><span>사용 가이드</span><ArrowUpRight size={12} /></button>
      </div>

      <main className="workbench">
        {(leftOpen || rightOpen) && <button className="panel-backdrop" aria-label="패널 닫기" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
        <aside className={`sidebar left-sidebar ${leftOpen ? 'mobile-open' : ''}`} aria-label="패턴 설정">
          <div className="panel-heading"><div><span className="eyebrow">BACKGROUND</span><h2>패턴 스튜디오</h2></div><button className="icon-button close-mobile" onClick={() => setLeftOpen(false)} aria-label="패턴 패널 닫기"><X size={17} /></button><Layers2 size={18} className="heading-icon" /></div>
          {workspace.compare && <div className="compare-callout"><p>저장된 두 실험을 비교하고 있어요.</p><button onClick={toggleCompare}>편집으로 돌아가기 <ArrowUpRight size={12} /></button></div>}
          <div className={`panel-scroll ${workspace.compare ? 'compare-inactive' : ''}`} inert={workspace.compare}><PatternPanel state={current} onChange={update} onUpload={file => upload(file, 'pattern')} busy={busy === 'pattern'} savedPatterns={savedPatterns} onSelectSavedPattern={selectSavedPattern} onRemoveSavedPattern={deleteSavedPattern} /></div>
          <div className="panel-footnote"><span className="tiny-dot" />패턴을 바꾸고, 새로운 관계를 발견하세요.</div>
        </aside>

        <section className="stage" aria-label="실시간 3D 작업 공간">
          <div className="stage-heading"><div><span className="eyebrow">A SPACE FOR YOUR IDEAS</span><h1>{workspace.compare ? '두 가지 장면, 새로운 발견.' : '패턴과 오브젝트, 그 사이.'}</h1><p>{workspace.compare ? '같은 시선으로, 서로 다른 인상을 살펴보세요.' : '배경을 바꾸고 물건의 새로운 표정을 만나보세요.'}</p></div><button className={`icon-button focus-button ${focus ? 'selected' : ''}`} title={focus ? '집중 보기 종료 (Esc)' : '집중 보기'} aria-label={focus ? '집중 보기 종료' : '집중 보기'} onClick={() => setFocus(!focus)}>{focus ? <PanelLeftOpen size={18} /> : <Expand size={18} />}</button></div>

          <div className="scene-meta"><span className="live-label"><span />실시간 3D</span><span>직교 뷰<span className="meta-dot">·</span>5 × 5 × 5</span></div>
          {workspace.compare && <div className="comparison-options"><span className="comparison-caption">비교 방식</span><div className="segmented"><button className={workspace.patternOnly ? 'selected' : ''} onClick={() => setWorkspace(p => ({ ...p, patternOnly: true }))}>패턴만 비교</button><button className={!workspace.patternOnly ? 'selected' : ''} onClick={() => setWorkspace(p => ({ ...p, patternOnly: false }))}>전체 상태 비교</button></div></div>}

          <div className="viewport-wrap">
            {hydrated ? <Viewport ref={viewport} state={renderedState} comparison={comparison} resolveAsset={resolveAsset} onCameraChange={cameraChange} onError={sceneError} onLoading={setSceneLoading} /> : <div className="scene-loading"><span className="spinner" />작업 공간을 준비하고 있어요</div>}
            {sceneLoading && <div className="loading-badge" role="status"><span className="spinner" />장면을 불러오는 중</div>}
            {workspace.compare && <div className="compare-labels"><span><b>A</b> 저장된 실험</span><span><b>B</b> 저장된 실험</span></div>}
          </div>

          <div className="camera-tools">
            <div className="camera-presets"><button onClick={() => preset('default')} title="기본 시점"><ScanLine size={14} /><span>기본 시점</span></button><span className="tool-divider" /><button onClick={() => preset('front')}>정면</button><button onClick={() => preset('left')}>왼쪽 벽</button><button onClick={() => preset('wide')}><Maximize2 size={13} /><span>전체 보기</span></button></div>
            <div className="camera-utilities"><button onClick={() => changeZoom(-0.1)} aria-label="축소"><Minus size={14} /></button><span className="zoom-level">{Math.round(current.camera.zoom * 100)}%</span><button onClick={() => changeZoom(0.1)} aria-label="확대"><Plus size={14} /></button><span className="tool-divider" /><button onClick={() => preset('default')} title="시점 초기화" aria-label="시점 초기화"><RotateCcw size={14} /></button><button className={current.cameraLocked ? 'selected' : ''} onClick={() => update({ cameraLocked: !current.cameraLocked })} title="시점 잠금" aria-label="시점 잠금" aria-pressed={current.cameraLocked}>{current.cameraLocked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}</button></div>
          </div>

          <div className="stage-bottom"><span className="interaction-hint"><Focus size={13} />드래그로 회전<span>·</span>스크롤로 확대</span><span className="stage-edition">PATTERN ROOM — STUDY NO. 001</span><div className="mobile-panel-toggles"><button onClick={() => { setLeftOpen(!leftOpen); setRightOpen(false); }}><PanelLeftClose size={15} />패턴</button><button onClick={() => { setRightOpen(!rightOpen); setLeftOpen(false); }}><PanelRightClose size={15} />오브젝트</button></div></div>

          <div className="experiment-dock"><div className="dock-title"><span className="dock-icon"><ArrowLeftRight size={17} /></span><div><strong>인상을 기록하고, 비교해 보세요.</strong><span>A와 B에 각각 저장하면 두 장면을 나란히 볼 수 있어요.</span></div></div><div className="snapshot-actions"><button aria-label="A 저장" disabled={workspace.compare} className={workspace.a ? 'has-snapshot' : ''} onClick={() => saveSnapshot('a')}><span className="slot-letter" aria-hidden="true">A</span><span>A 저장</span>{workspace.a ? <Check size={12} /> : <Plus size={12} />}</button><button aria-label="B 저장" disabled={workspace.compare} className={workspace.b ? 'has-snapshot' : ''} onClick={() => saveSnapshot('b')}><span className="slot-letter" aria-hidden="true">B</span><span>B 저장</span>{workspace.b ? <Check size={12} /> : <Plus size={12} />}</button></div></div>

          {!workspace.compare && <div className="note-area"><label htmlFor="experiment-note">관찰 노트<span>나에게 이 조합은 어떤 느낌인가요?</span></label><textarea id="experiment-note" placeholder="색의 조화, 패턴의 밀도, 오브젝트의 인상… 자유롭게 남겨보세요." value={current.note} maxLength={500} onChange={event => update({ note: event.target.value })} rows={1} /><span className="note-count">{current.note.length}/500</span></div>}
          {workspace.compare && <div className="snapshot-notes">{(['a', 'b'] as const).map(slot => <label key={slot}><b>{slot.toUpperCase()}의 관찰 노트</b><textarea aria-label={`${slot.toUpperCase()}의 관찰 노트`} value={workspace[slot]?.note ?? ''} placeholder="이 실험에 대한 생각을 남겨보세요." maxLength={500} onChange={event => setWorkspace(previous => ({ ...previous, [slot]: { ...previous[slot]!, note: event.target.value } }))} /></label>)}</div>}
        </section>

        <aside className={`sidebar right-sidebar ${rightOpen ? 'mobile-open' : ''}`} aria-label="오브젝트 및 공간 설정">
          <div className="panel-heading"><div><span className="eyebrow">OBJECT & SPACE</span><h2>오브젝트와 공간</h2></div><button className="icon-button close-mobile" onClick={() => setRightOpen(false)} aria-label="오브젝트 패널 닫기"><X size={17} /></button><span className="heading-cube"><svg width="19" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10" /></svg></span></div>
          {workspace.compare && <div className="compare-callout"><p>같은 조건에서 인상의 차이를 살펴보세요.</p><button onClick={toggleCompare}>편집으로 돌아가기 <ArrowUpRight size={12} /></button></div>}
          <div className={`panel-scroll ${workspace.compare ? 'compare-inactive' : ''}`} inert={workspace.compare}><ObjectPanel state={current} onChange={update} onUpload={file => upload(file, 'model')} busy={busy === 'model'} /></div>
          <div className="panel-footnote"><span className="tiny-dot" />당신의 모든 실험은 이 브라우저에 저장돼요.</div>
        </aside>
      </main>

      <footer className="app-footer"><span>작은 변화가 만드는, 새로운 시선.</span><span>DESIGNED TO EXPERIMENT<span className="footer-plus">+</span></span></footer>
      {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={16} /> : <Check size={16} />}<span>{toast.message}</span><button aria-label="알림 닫기" onClick={() => setToast(null)}><X size={14} /></button></div>}

      {resetOpen && <div className="modal-backdrop" onClick={() => setResetOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title" onClick={event => event.stopPropagation()}><span className="modal-symbol"><RotateCcw size={24} /></span><h2 id="reset-title">새로운 실험을 시작할까요?</h2><p>현재 작업과 A/B 기록, 업로드한 모델이 초기화됩니다.<br />내 패턴에 보관한 이미지는 그대로 남습니다.</p><div className="modal-actions"><button className="button outline" onClick={() => setResetOpen(false)}>이어서 작업하기</button><button className="button primary" onClick={reset}>전체 초기화</button></div></div></div>}
      {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><div className="modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" aria-label="가이드 닫기" onClick={() => setHelpOpen(false)}><X size={18} /></button><span className="eyebrow">HOW TO EXPERIMENT</span><h2 id="help-title">정답 없이, 자유롭게.</h2><p>작은 변화가 물건의 인상을 어떻게 바꾸는지 관찰해 보세요.</p><ol className="guide-steps"><li><span>01</span><div><b>배경을 골라보세요</b><p>기본 패턴을 선택하거나 직접 만든 이미지를 올려보세요. 벽마다 다른 패턴을 적용할 수도 있어요.</p></div></li><li><span>02</span><div><b>물건과 만나게 하세요</b><p>오브젝트와 색, 패턴의 크기를 바꾸며 조화를 찾아보세요. GLB 모델도 사용할 수 있어요.</p></div></li><li><span>03</span><div><b>다른 순간을 나란히 놓으세요</b><p>현재 상태를 A에 저장한 뒤 다른 조합을 B에 저장하세요. A/B 비교에서 함께 살펴볼 수 있어요.</p></div></li><li><span>04</span><div><b>나의 발견을 남기세요</b><p>관찰 노트를 적고 장면을 PNG로 저장하세요. 작업과 업로드 파일은 이 브라우저에 자동 저장됩니다.</p></div></li></ol><button className="button primary guide-start" onClick={() => setHelpOpen(false)}>실험 시작하기<ArrowUpRight size={15} /></button></div></div>}
    </div>
  );
}

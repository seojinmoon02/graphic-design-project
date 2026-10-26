import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { ChevronDown, Check, Link2, RotateCcw, Upload, LoaderCircle, ImagePlus, Box, Sun, Palette } from 'lucide-react';
import { DEFAULT_PATTERN, createExperiment } from '../defaults';
import type { ExperimentState, ObjectKind, PatternKind, PatternSettings, StoredAsset } from '../types';
import PatternLibrary from './PatternLibrary';

interface PanelProps {
  state: ExperimentState;
  onChange: (patch: Partial<ExperimentState>) => void;
  onUpload: (file: File) => Promise<void>;
  busy: boolean;
}

interface PatternPanelProps extends PanelProps {
  savedPatterns: StoredAsset[];
  onSelectSavedPattern: (asset: StoredAsset) => void;
  onRemoveSavedPattern: (asset: StoredAsset) => Promise<void>;
}

function Section({ number, title, children, className = '', initiallyOpen = true }: {
  number: string; title: string; children: ReactNode; className?: string; initiallyOpen?: boolean;
}) {
  return <details className={`control-section ${className}`} open={initiallyOpen}>
    <summary><span className="section-number">{number}</span><span className="section-title">{title}</span><ChevronDown className="chevron" size={14} /></summary>
    <div className="section-content">{children}</div>
  </details>;
}

export function RangeControl({ label, value, min, max, step = 1, unit = '', onChange, displayDigits = 0 }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; displayDigits?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(Number(value.toFixed(displayDigits))));
  useEffect(() => setDraft(String(Number(value.toFixed(displayDigits)))), [value, displayDigits]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = () => {
    const n = Number(draft);
    const next = draft.trim() && Number.isFinite(n) ? clamp(n) : value;
    onChange(next);
    setDraft(String(Number(next.toFixed(displayDigits))));
  };
  return <div className="range-control">
    <div className="range-header"><label htmlFor={id}>{label}</label><div className="number-field">
      <input aria-label={`${label} 값`} type="number" min={min} max={max} step={step} value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {unit && <span>{unit}</span>}
    </div></div>
    <input id={id} aria-label={`${label} 슬라이더`} type="range" min={min} max={max} step={step} value={value}
      style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))} />
  </div>;
}

export function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const id = useId();
  return <label className="color-control" htmlFor={id}>
    <span className="color-name">{label}</span><span className="color-picker-wrap"><input id={id} type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} /><span className="color-hex">{value.toUpperCase()}</span></span>
  </label>;
}

function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (checked: boolean) => void; icon?: ReactNode }) {
  return <div className="switch-row"><span>{icon}{label}</span><button type="button" className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)}><span /></button></div>;
}

function UploadZone({ type, onUpload, busy, fileName }: { type: 'pattern' | 'model'; onUpload: PanelProps['onUpload']; busy: boolean; fileName?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isModel = type === 'model';
  const select = (file?: File) => { if (file && !busy) void onUpload(file); };
  const drop = (e: DragEvent) => { e.preventDefault(); setDragging(false); select(e.dataTransfer.files[0]); };
  return <>
    <button type="button" className={`upload-zone ${isModel ? 'compact' : ''} ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
      disabled={busy} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}
      aria-label={isModel ? 'GLB 모델 업로드' : '패턴 이미지 업로드'}>
      <span className="upload-icon">{busy ? <LoaderCircle size={21} className="spin" /> : isModel ? <Box size={18} strokeWidth={1.4} /> : <Upload size={21} strokeWidth={1.4} />}</span>
      <span className="upload-title">{busy ? '파일을 불러오는 중…' : isModel ? '나만의 3D 모델 업로드' : '나만의 패턴 올리기'}</span>
      <span className="upload-hint">{isModel ? 'GLB · 클릭하거나 끌어다 놓기' : '클릭하거나 파일을 끌어다 놓으세요'}</span>
      {!isModel && <span className="upload-formats">PNG, JPG, WEBP, SVG</span>}
    </button>
    <input ref={input} type="file" className="visually-hidden" aria-label={isModel ? 'GLB 모델 파일' : '패턴 이미지 파일'} accept={isModel ? '.glb,model/gltf-binary' : '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml'}
      onChange={(e) => { select(e.target.files?.[0]); e.target.value = ''; }} />
    {fileName && <p className="file-name" title={fileName}><Check size={12} />{fileName}</p>}
  </>;
}

const PATTERNS: { kind: PatternKind; label: string }[] = [
  { kind: 'wave', label: '웨이브' }, { kind: 'stripe', label: '스트라이프' }, { kind: 'check', label: '체크' },
  { kind: 'dot', label: '도트' }, { kind: 'grid', label: '격자' }, { kind: 'none', label: '단색' },
];

export function PatternPanel({ state, onChange, onUpload, busy, savedPatterns, onSelectSavedPattern, onRemoveSavedPattern }: PatternPanelProps) {
  const pattern = state.target === 'left' ? state.left : state.back;
  const change = (patch: Partial<PatternSettings>) => {
    if (state.linked || state.target === 'both') onChange({ left: { ...state.left, ...patch }, back: { ...state.back, ...patch } });
    else if (state.target === 'left') onChange({ left: { ...state.left, ...patch } });
    else onChange({ back: { ...state.back, ...patch } });
  };
  return <>
    <Section number="01" title="패턴 선택">
      <UploadZone type="pattern" onUpload={onUpload} busy={busy} fileName={pattern.kind === 'upload' ? pattern.fileName : undefined} />
      <div className="field-label pattern-list-label"><span>기본 패턴</span><span className="muted">6가지 컬렉션</span></div>
      <div className="pattern-grid">{PATTERNS.map(({ kind, label }) => <button key={kind} type="button" aria-label={`${label} 패턴`} aria-pressed={pattern.kind === kind}
        className={`pattern-option ${pattern.kind === kind ? 'selected' : ''}`} onClick={() => change({ kind, assetId: undefined, fileName: undefined, originalBackground: undefined })}>
        <span className={`pattern-swatch pattern-${kind}`}>{pattern.kind === kind && <span className="pattern-selected"><Check size={10} strokeWidth={3} /></span>}</span>
        <span className="pattern-label">{label}</span>
      </button>)}</div>
      <PatternLibrary patterns={savedPatterns} selectedAssetId={pattern.kind === 'upload' ? pattern.assetId : undefined}
        onSelect={onSelectSavedPattern} onRemove={onRemoveSavedPattern} />
    </Section>
    <Section number="02" title="적용할 벽">
      <div className="segmented" aria-label="패턴 적용 대상">{([{ key: 'both', label: '두 벽' }, { key: 'left', label: '왼쪽 벽' }, { key: 'back', label: '뒤쪽 벽' }] as const).map(({ key, label }) =>
        <button type="button" key={key} className={state.target === key ? 'active' : ''} aria-pressed={state.target === key} onClick={() => onChange(key === 'both' ? { target: key, linked: true, left: { ...pattern }, back: { ...pattern } } : { target: key, linked: false })}>{label}</button>)}</div>
      <Toggle label="두 벽 설정 연결" icon={<Link2 size={13} />} checked={state.linked} onChange={(linked) => onChange(linked ? { linked, target: 'both', left: { ...pattern }, back: { ...pattern } } : { linked, target: state.target === 'both' ? 'back' : state.target })} />
    </Section>
    <Section number="03" title="패턴 조절">
      <RangeControl label="패턴 크기" value={400 / pattern.repeat} min={25} max={800} unit="%" onChange={(n) => change({ repeat: 400 / n })} />
      <RangeControl label="가로 반복 수" value={pattern.repeat} min={0.5} max={16} step={0.1} displayDigits={1} unit="회" onChange={(repeat) => change({ repeat })} />
      <RangeControl label="패턴 회전" value={pattern.rotation} min={0} max={360} unit="°" onChange={(rotation) => change({ rotation })} />
      <div className="rotation-presets">{[0, 90, 180, 270].map((rotation) => <button type="button" key={rotation} className={pattern.rotation === rotation ? 'active' : ''} aria-label={`패턴 ${rotation}도 회전`} onClick={() => change({ rotation })}>{rotation}°</button>)}</div>
      <RangeControl label="불투명도" value={pattern.opacity} min={0} max={100} unit="%" onChange={(opacity) => change({ opacity })} />
      <button className="reset-link" type="button" onClick={() => change({ ...DEFAULT_PATTERN, kind: pattern.kind, assetId: pattern.assetId, fileName: pattern.fileName, background: pattern.originalBackground ?? DEFAULT_PATTERN.background })}><RotateCcw size={12} />원본 설정으로 복원</button>
    </Section>
    <Section number="04" title="패턴 색상" initiallyOpen={false}>
      <RangeControl label="명도" value={pattern.brightness} min={0} max={200} unit="%" onChange={(brightness) => change({ brightness })} />
      <RangeControl label="채도" value={pattern.saturation} min={0} max={200} unit="%" onChange={(saturation) => change({ saturation })} />
      <ColorControl label="벽 기본색" value={pattern.background} onChange={(background) => change({ background })} />
      <p className="control-note"><Palette size={12} />투명 패턴 아래로 기본색이 비칩니다.</p>
    </Section>
  </>;
}

function ObjectIcon({ kind, color = 'currentColor' }: { kind: ObjectKind; color?: string }) {
  if (kind === 'vase') return <svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="vase-grad"><stop stopColor={color} offset="0" /><stop stopColor={color} stopOpacity=".65" offset=".5" /><stop stopColor={color} offset="1" /></linearGradient></defs><path d="M18 9h12l-1.8 9c-1 3 7.8 7 7.8 14 0 6-4.5 8-12 8s-12-2-12-8c0-7 8.8-11 7.8-14Z" fill="url(#vase-grad)" /><ellipse cx="24" cy="9" rx="6" ry="2.4" fill={color} /><ellipse cx="24" cy="9" rx="4.3" ry="1.3" fill="#172858" /></svg>;
  if (kind === 'sphere') return <svg viewBox="0 0 48 48" aria-hidden="true"><defs><radialGradient id="sphere-grad" cx="34%" cy="28%"><stop stopColor="#eeefec" /><stop offset=".8" stopColor="#acaea9" /><stop offset="1" stopColor="#777b75" /></radialGradient></defs><circle cx="24" cy="25" r="15" fill="url(#sphere-grad)" /></svg>;
  if (kind === 'cube') return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 8 15 8-15 9-15-9Z" fill="#e2e3de" /><path d="m9 16 15 9v17L9 33Z" fill="#b3b6ad" /><path d="m39 16-15 9v17l15-9Z" fill="#878b82" /></svg>;
  if (kind === 'torus') return <svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="25" rx="16" ry="12" fill="none" stroke="#a4a79e" strokeWidth="7" transform="rotate(-27 24 25)" /><path d="M10 29c-3-11 14-20 24-13" fill="none" stroke="#dfe1d9" strokeWidth="4" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 39c-8-5-7-13-1-16 8-3 0-11 7-14 5-2 8 3 7 8-1 8 12 5 11 15-1 8-16 13-24 7Z" fill="#b1b5aa" /><path d="M16 26c-4 7 2 11 6 10M23 13c-3 6 3 7 2 13" stroke="#dfe2d8" strokeWidth="3" strokeLinecap="round" fill="none" /></svg>;
}

const OBJECTS: { kind: ObjectKind; label: string }[] = [{ kind: 'vase', label: '화병' }, { kind: 'sphere', label: '구' }, { kind: 'cube', label: '큐브' }, { kind: 'torus', label: '링' }, { kind: 'sculpture', label: '조각' }];

export function ObjectPanel({ state, onChange, onUpload, busy }: PanelProps) {
  const object = state.object;
  const change = (patch: Partial<ExperimentState['object']>) => onChange({ object: { ...object, ...patch } });
  return <>
    <Section number="01" title="오브젝트 선택">
      <div className="object-grid">{OBJECTS.map(({ kind, label }) => <button type="button" key={kind} aria-label={`${label} 오브젝트`} aria-pressed={object.kind === kind} className={`object-option ${object.kind === kind ? 'selected' : ''}`}
        onClick={() => change({ kind, assetId: undefined, fileName: undefined, scale: 1, rotation: 0 })}><ObjectIcon kind={kind} color={object.color} /><span>{label}</span></button>)}</div>
      <UploadZone type="model" onUpload={onUpload} busy={busy} fileName={object.kind === 'upload' ? object.fileName : undefined} />
      <p className="control-note">오브젝트는 좌대 중앙에 자동 정렬됩니다.</p>
    </Section>
    <Section number="02" title="크기와 형태">
      <RangeControl label="오브젝트 크기" value={object.scale * 100} min={20} max={200} unit="%" onChange={(n) => change({ scale: n / 100 })} />
      <RangeControl label="오브젝트 회전" value={object.rotation} min={0} max={360} unit="°" onChange={(rotation) => change({ rotation })} />
      <button className="reset-link" type="button" onClick={() => change({ scale: 1, rotation: 0, color: createExperiment().object.color, roughness: .38, gloss: .3 })}><RotateCcw size={12} />초기 상태로 복원</button>
    </Section>
    <Section number="03" title="오브젝트 재질">
      {object.kind === 'upload' ? <p className="control-note">업로드한 모델의 원래 재질과 색상을 유지합니다.</p> : <>
        <ColorControl label="오브젝트 색상" value={object.color} onChange={(color) => change({ color })} />
        <div className="material-colors">{['#3159c7', '#e76f3b', '#e5ce6a', '#779982', '#d2b4cc', '#e9e7e0', '#373b37'].map((color) => <button key={color} type="button" style={{ background: color }} className={object.color === color ? 'selected' : ''} aria-label={`오브젝트 색상 ${color}`} aria-pressed={object.color === color} onClick={() => change({ color })}>{object.color === color && <Check size={11} />}</button>)}</div>
        <RangeControl label="거칠기" value={object.roughness * 100} min={0} max={100} unit="%" onChange={(n) => change({ roughness: n / 100 })} />
        <RangeControl label="광택" value={object.gloss * 100} min={0} max={100} unit="%" onChange={(n) => change({ gloss: n / 100 })} />
      </>}
    </Section>
    <Section number="04" title="빛과 공간">
      <RangeControl label="조명 밝기" value={state.light * 100} min={20} max={200} unit="%" onChange={(n) => onChange({ light: n / 100 })} />
      <Toggle label="부드러운 그림자" icon={<Sun size={13} />} checked={state.shadows} onChange={(shadows) => onChange({ shadows })} />
      <ColorControl label="바닥 색상" value={state.floor} onChange={(floor) => onChange({ floor })} />
      <ColorControl label="좌대 색상" value={state.pedestal} onChange={(pedestal) => onChange({ pedestal })} />
    </Section>
    <div className="sidebar-tip"><ImagePlus size={16} /><p>조금씩 바꾸어 보세요.<br /><span>작은 차이가 새로운 조화를 만듭니다.</span></p></div>
  </>;
}

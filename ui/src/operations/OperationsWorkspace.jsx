import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { assetName } from '../labels.js'
import { percent, operationMoments, timeLabel } from './presentation.js'
import { domainOf, headingAt, sceneRows } from './theater.js'

const TheaterScene=lazy(()=>import('./TheaterScene.jsx'))
const DOMAIN={sea:'해상',air:'항공',space:'우주',ground:'지상'}
class TheaterBoundary extends Component {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<div className="theater-failure">3D 장면을 불러오지 못했습니다. 지도와 임무 분석은 계속 이용할 수 있습니다.</div>:this.props.children}
}

export default function OperationsWorkspace({active,children,graph,step,steps,idx,selected,onSelect,onSeek,playing,cyRef,onExit}) {
  const [layout,setLayout]=useState('dual'),[graphOpen,setGraphOpen]=useState(false),[events,setEvents]=useState(false)
  const [mode,setMode]=useState('close'),[settingsOpen,setSettingsOpen]=useState(false),[reset,setReset]=useState(0)
  const [settings,setSettings]=useState({tracks:true,links:true,labels:true,wire:false,night:false,wave:.55,haze:.15})
  const moments=useMemo(()=>operationMoments(graph,steps),[graph,steps])
  const rows=useMemo(()=>sceneRows(graph,step),[graph,step])
  const asset=graph?.assets?.find(a=>a.id===selected),row=rows.find(r=>r.id===selected)
  const canGlobe=!!graph?.geo?.georef
  const effectiveMode=mode==='globe'&&!canGlobe?'formation':mode
  const setOption=(key,value)=>setSettings(s=>({...s,[key]:value}))
  useEffect(()=>{
    if(!active || !graphOpen)return
    const id=requestAnimationFrame(()=>{cyRef.current?.resize();cyRef.current?.fit(undefined,24)})
    return ()=>cancelAnimationFrame(id)
  },[active,graphOpen,layout,graph,cyRef])
  return <div className="canvas-wrap" data-studio={active?'1':undefined} data-layout={layout} data-graph={graphOpen?'1':'0'}>
    {children}
    {active && <>
      <div className="theater-workspace-tools" aria-label="통합 장면 배치">
        <span>MC-CyCOP <small>MISSION OVERLAY</small></span>
        <button type="button" onClick={onExit}>기본 화면</button>
        <button type="button" aria-pressed={graphOpen} onClick={()=>{setGraphOpen(v=>!v);setEvents(false)}}>임무 연결</button>
        <button type="button" aria-pressed={events} onClick={()=>{setEvents(v=>!v);setGraphOpen(false)}}>사건 목록</button>
        <div className="theater-layout-options">{[['dual','듀얼'],['scene','장면 확대'],['map','지도 확대']].map(([key,label])=><button type="button" key={key} aria-pressed={layout===key} onClick={()=>setLayout(key)}>{label}</button>)}</div>
      </div>
      {graphOpen && <button type="button" className="theater-graph-close" aria-label="임무 연결 닫기" onClick={()=>setGraphOpen(false)}>×</button>}
      {events && <aside className="theater-events" aria-label="훈련 사건 목록">
        <header><b>훈련 진행</b><button type="button" aria-label="사건 목록 닫기" onClick={()=>setEvents(false)}>×</button></header>
        {moments.map(m=><button type="button" key={m.index} aria-current={idx===m.index?'step':undefined} onClick={()=>onSeek(m.index)}><time>{m.time}</time><strong>{m.label}</strong><small>{m.note}</small></button>)}
      </aside>}
      <section className="theater-scene" aria-label="통합 작전 3D 환경">
        <header className="theater-scene-bar">
          <div><span className="theater-domain">{asset?DOMAIN[domainOf(asset)]:'합동'}</span><b>{asset?assetName(graph,asset.id).ko:'플랫폼 관측'}</b><small>{timeLabel(step,idx)}</small></div>
          <div className="theater-cameras" role="group" aria-label="3D 카메라">
            {[['close','근접'],['formation','전체'],['globe','지구']].map(([key,label])=><button type="button" key={key} disabled={key==='globe'&&!canGlobe} aria-pressed={effectiveMode===key} onClick={()=>setMode(key)}>{label}</button>)}
            <button type="button" onClick={()=>setReset(v=>v+1)} title="3D 시점 초기화" aria-label="3D 시점 초기화">↺</button>
          </div>
        </header>
        <TheaterBoundary key={`${graph?.scenario_id}-${effectiveMode}`}><Suspense fallback={<div className="theater-failure">3D 환경 준비 중</div>}>
          <TheaterScene graph={graph} step={step} selected={selected} onSelect={onSelect} mode={effectiveMode} settings={settings} playing={playing&&layout!=='map'} resetToken={reset}/>
        </Suspense></TheaterBoundary>
        {asset&&!row&&<div className="theater-failure" role="status">현재 시점에 선택 자산의 위치가 없습니다.</div>}
        <div className="theater-hud" aria-label="장면 계기">
          <span className="theater-live"><i data-playing={playing||undefined}/>{playing?'REPLAY RUN':'REPLAY HOLD'}</span>
          <dl><div><dt>자산</dt><dd>{asset?.id || '선택 없음'}</dd></div>
            <div><dt>저작 고도</dt><dd>{row?`${Math.round(row.position.z || 0).toLocaleString()} m`:'미측정'}</dd></div>
            <div><dt>항적 방향</dt><dd>{asset&&headingAt(asset,Number(step?.t ?? 0))!==null?`${headingAt(asset,Number(step?.t ?? 0)).toFixed(1)}°`:'—'}</dd></div>
            <div><dt>자산 저하</dt><dd>{percent(asset?step?.asset?.[asset.id]:null)}</dd></div></dl>
        </div>
        <button type="button" className="theater-environment-toggle" aria-expanded={settingsOpen} onClick={()=>setSettingsOpen(v=>!v)}>환경·표시</button>
        {settingsOpen && <div className="theater-environment" aria-label="표시 환경 설정">
          <b>장면 표현</b><small>아래 설정은 임무 상태를 바꾸지 않습니다.</small>
          <label>파면 <input aria-label="파면 표현" type="range" min="0" max="1.5" step="0.05" value={settings.wave} onChange={e=>setOption('wave',Number(e.target.value))}/></label>
          <label>연무 <input aria-label="연무 표현" type="range" min="0" max="1" step="0.05" value={settings.haze} onChange={e=>setOption('haze',Number(e.target.value))}/></label>
          <label><input type="checkbox" checked={settings.night} onChange={e=>setOption('night',e.target.checked)}/>야간</label>
          <label><input type="checkbox" checked={settings.wire} onChange={e=>setOption('wire',e.target.checked)}/>와이어 모형</label>
        </div>}
        <div className="theater-scene-layers" aria-label="3D 레이어">
          {[['tracks','항적'],['links','데이터링크'],['labels','라벨']].map(([key,label])=><button type="button" key={key} aria-pressed={settings[key]} onClick={()=>setOption(key,!settings[key])}>{label}</button>)}
          <span>{effectiveMode==='globe'?'가상 우주 항적 · 지리 격자':'모형 확대 · 고도 압축'}</span>
        </div>
        <div className="theater-watermark">가상 훈련 시나리오 · 실제 부대 배치 아님</div>
      </section>
      <div className="theater-asset-strip" aria-label="플랫폼 바로 선택">
        {(graph?.assets || []).filter(a=>a.visual_model).map(a=><button type="button" key={a.id} aria-pressed={selected===a.id} onClick={()=>onSelect(a.id)}><small>{DOMAIN[domainOf(a)]}</small>{assetName(graph,a.id).ko}</button>)}
      </div>
      {(graphOpen||layout==='map')&&<div className="theater-global-watermark">가상 훈련 시나리오 · 실제 부대 배치 아님</div>}
    </>}
  </div>
}

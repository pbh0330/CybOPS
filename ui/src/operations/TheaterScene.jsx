import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildModel } from './models.js'
import { disposeScene, globeSurface, skyDome, waterSurface } from './environment.js'
import { globePoint, sceneRows, theaterPoint, visibleConnections } from './theater.js'
import { CAUSE_COLOR } from '../tokens.mjs'
import { assetName } from '../labels.js'
import { toLonLat } from '../georef.js'
import { modelKind } from './presentation.js'

export default function TheaterScene({ graph, step, selected, onSelect, mode, settings, playing, resetToken }) {
  const mount=useRef(null), labels=useRef(null), api=useRef(null)
  const live=useRef({step,settings,playing,onSelect}); live.current={step,settings,playing,onSelect}
  const [failure,setFailure]=useState(false)
  useEffect(()=>{
    const box=mount.current, labelBox=labels.current
    if(!box || !graph) return
    let renderer
    setFailure(false)
    try { renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'}) }
    catch { setFailure(true);return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5))
    renderer.outputColorSpace=T.SRGBColorSpace
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12
    renderer.domElement.setAttribute('role','img')
    renderer.domElement.setAttribute('aria-label','합동 작전 3D 장면. 드래그 회전, 휠 확대')
    box.appendChild(renderer.domElement)
    const initialRows=sceneRows(graph,live.current.step)
    const initialFocus=initialRows.find(r=>r.id===selected) || initialRows.find(r=>r.asset.visual_model) || initialRows[0]
    const orbitalClose=mode==='close' && initialFocus?.domain==='space' && !!initialFocus.lonlat
    const scene=new T.Scene(), globe=mode==='globe'||orbitalClose
    scene.background=new T.Color(globe ? '#030811' : '#91aabb')
    const camera=new T.PerspectiveCamera(42,1,.05,1500)
    const controls=new OrbitControls(camera,renderer.domElement)
    controls.enableDamping=false;controls.minDistance=globe&&!orbitalClose?13:4;controls.maxDistance=globe&&!orbitalClose?70:240
    controls.maxPolarAngle=globe?Math.PI:Math.PI/2.03
    const ambient=new T.HemisphereLight(0xd9edff,0x1e3546,2.3);scene.add(ambient)
    const sun=new T.DirectionalLight(0xffefdb,3.6);sun.position.set(-70,100,-60);scene.add(sun)
    const water=globe?null:waterSurface(),sky=globe?null:skyDome()
    if(water){
      scene.add(water);scene.add(sky)
      if(mode==='close'&&initialFocus?.domain==='ground'){
        water.visible=false
        const floor=new T.Mesh(new T.PlaneGeometry(500,500),new T.MeshStandardMaterial({color:0x243039,roughness:.9}))
        floor.rotation.x=-Math.PI/2;scene.add(floor)
        const grid=new T.GridHelper(200,100,0x6e858e,0x3c4c55);grid.position.y=.01;scene.add(grid)
      }
    }
    const orbitalRotation=new T.Quaternion()
    if(orbitalClose){orbitalRotation.setFromUnitVectors(new T.Vector3(...globePoint(initialFocus.lonlat,0)).normalize(),new T.Vector3(0,1,0))}
    if(globe){
      const earth=globeSurface()
      if(orbitalClose){earth.scale.setScalar(6);earth.position.y=-72;earth.quaternion.copy(orbitalRotation)}
      scene.add(earth)
      const points=[]
      for(let i=0;i<650;i++){const a=i*2.399963,b=Math.acos(1-2*(i+.5)/650);points.push(250*Math.sin(b)*Math.cos(a),250*Math.cos(b),250*Math.sin(b)*Math.sin(a))}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3))
      scene.add(new T.Points(geo,new T.PointsMaterial({color:0xa7b9d2,size:.38,sizeAttenuation:true})))
    }
    const modelGroup=new T.Group(),pathGroup=new T.Group();scene.add(modelGroup,pathGroup)
    const models=new Map(), buttons=new Map()
    let rows=sceneRows(graph,live.current.step)
    const focusId=rows.find(r=>r.id===selected)?.id || rows.find(r=>r.asset.visual_model)?.id || rows[0]?.id
    let center={x:0,y:0},focusPoint=new T.Vector3(),first=true,frame=0,lastDraw=0,clock=0,disposed=false,lostContext=false
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)')
    const globePos=(r)=>{
      const p=new T.Vector3(...globePoint(r.lonlat || [128,38],r.position.z,orbitalClose?72:12))
      return orbitalClose?p.applyQuaternion(orbitalRotation).add(new T.Vector3(0,-72,0)):p
    }
    const projectPoint=p=>new T.Vector3(...theaterPoint(p,center))
    for(const a of graph.assets || []) {
      // Missing locations stay absent until a valid interval is reached.
      const model=buildModel(modelKind(a),{stand:false})
      const holder=new T.Group();holder.add(model);model.rotation.y=0
      const ring=new T.Mesh(new T.RingGeometry(1.15,1.18,64),new T.MeshBasicMaterial({color:0xc4dae5,side:T.DoubleSide,transparent:true,opacity:.7}))
      ring.rotation.x=-Math.PI/2;ring.position.y=.03;holder.add(ring)
      holder.userData={model,ring};modelGroup.add(holder);models.set(a.id,holder)
      const button=document.createElement('button');button.type='button';button.className='theater-label'
      button.textContent=assetName(graph,a.id).ko;button.setAttribute('aria-label',`${assetName(graph,a.id).ko} 3D에서 선택`)
      button.addEventListener('click',()=>live.current.onSelect(a.id));labelBox.appendChild(button);buttons.set(a.id,button)
    }
    // A fading illustrated wake, keyed to the selected surface platform only.
    const wakeShape=new T.Shape();wakeShape.moveTo(-.7,2);wakeShape.lineTo(-9,45);wakeShape.lineTo(9,45);wakeShape.lineTo(.7,2);wakeShape.closePath()
    const wake=new T.Mesh(new T.ShapeGeometry(wakeShape),new T.ShaderMaterial({
      uniforms:{uTime:{value:0}},transparent:true,depthWrite:false,side:T.DoubleSide,
      vertexShader:`varying vec2 vP; void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec2 vP; uniform float uTime;void main(){float d=vP.y/45.;float edge=abs(vP.x)/max(.5,vP.y*.2);float foam=pow(abs(sin(vP.x*6.+vP.y*5.-uTime*3.)),7.);float a=(1.-d)*(.05+foam*.15)*smoothstep(1.,.55,edge);gl_FragColor=vec4(.84,.94,1.,a);}`,
    }));wake.rotation.x=Math.PI/2;wake.visible=false;scene.add(wake)
    // Its shape uses +z aft after this coordinate transform.
    const addLine=(points,color,opacity=.5,dashed=false)=>{
      if(points.length<2)return
      const mat=dashed?new T.LineDashedMaterial({color,transparent:true,opacity,dashSize:.7,gapSize:.4}):new T.LineBasicMaterial({color,transparent:true,opacity})
      const line=new T.Line(new T.BufferGeometry().setFromPoints(points),mat);if(dashed)line.computeLineDistances();pathGroup.add(line)
    }
    const refresh=()=>{
      const state=live.current
      rows=sceneRows(graph,state.step)
      const focus=rows.find(r=>r.id===focusId)
      center=mode==='formation' ? {x:(graph.geo?.frame?.extent?.x?.[1] || 24000)/2,y:(graph.geo?.frame?.extent?.y?.[1] || 18000)/2} : (focus?.position || {x:0,y:0})
      for(const [id,holder] of models){
        const r=rows.find(x=>x.id===id);holder.visible=!!r && (mode!=='close' || !focus || (r.domain===focus.domain && (r.domain!=='ground'||r.id===focusId)))
        if(!r){buttons.get(id).hidden=true;continue}
        holder.position.copy(globe?globePos(r):projectPoint(r.position))
        const scale=globe?(r.domain==='space'?(orbitalClose?1:.45):.025):mode==='formation'?1.15:r.id===focusId?1:.6
        holder.scale.setScalar(scale)
        holder.rotation.set(0,-(r.heading || 0)*Math.PI/180,0)
        if(globe) holder.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),holder.position.clone().sub(new T.Vector3(0,orbitalClose?-72:0,0)).normalize())
        holder.userData.ring.visible=id===selected || !!r.cause
        holder.userData.ring.material.color.set(CAUSE_COLOR[r.cause] || '#c4dae5')
        const btn=buttons.get(id);btn.classList.toggle('is-selected',id===selected);btn.style.setProperty('--asset-cause',CAUSE_COLOR[r.cause] || '#859ba7')
      }
      focusPoint=focus?(globe?globePos(focus):projectPoint(focus.position)):new T.Vector3()
      if(first){
        if(orbitalClose){camera.position.copy(focusPoint).add(new T.Vector3(9,5,-11));controls.target.copy(focusPoint).add(new T.Vector3(0,1,0))}
        else if(globe){camera.position.copy(focusPoint.length()?focusPoint.clone().normalize().multiplyScalar(40):new T.Vector3(27,20,25));controls.target.set(0,0,0)}
        else if(mode==='formation'){camera.position.set(62,65,80);controls.target.set(0,1,0)}
        else {camera.position.copy(focusPoint).add(new T.Vector3(9,5.5,-11));controls.target.copy(focusPoint).add(new T.Vector3(0,1,0))}
        controls.update();controls.saveState();first=false
      }
      disposeScene(pathGroup);pathGroup.clear()
      if(state.settings.tracks)for(const r of rows){
        if(!models.get(r.id).visible)continue
        const pts=[]
        for(const seg of r.asset.geo?.segments || []) for(const p of [seg.at,seg.to_at].filter(Boolean)){
          pts.push(globe && graph.geo?.georef ? globePos({lonlat:toLonLat(graph.geo.georef,p.x,p.y),position:p}) : projectPoint(p).add(new T.Vector3(0,.04,0)))
        }
        addLine(pts,r.id===selected?0xdfd3a3:0x93b8c9,r.id===selected?.75:.25)
      }
      if(state.settings.links)for(const link of visibleConnections(graph,rows,state.step)){
        if(mode==='close'&&link.a!==focusId&&link.b!==focusId)continue
        const a=models.get(link.a).position.clone(),b=models.get(link.b).position.clone(),mid=a.clone().lerp(b,.5)
        if(globe&&!orbitalClose)mid.normalize().multiplyScalar(Math.max(a.length(),b.length())+.3);else mid.y+=Math.min(5,a.distanceTo(b)*.12)
        addLine(new T.QuadraticBezierCurve3(a,mid,b).getPoints(30),CAUSE_COLOR[link.cause] || '#a9bdc8',link.cause ? .8 : .28,!!link.cause)
      }
      wake.visible=!globe && mode==='close' && focus?.domain==='sea' && focus.heading!==null
      if(wake.visible){wake.position.set(focusPoint.x,.04,focusPoint.z);wake.rotation.set(Math.PI/2,0,(focus.heading || 0)*Math.PI/180)}
      if(water){water.material.uniforms.uWave.value=state.settings.wave;water.material.uniforms.uNight.value=state.settings.night?1:0;sky.material.uniforms.uNight.value=state.settings.night?1:0;sky.material.uniforms.uHaze.value=state.settings.haze}
      ambient.intensity=state.settings.night?.55:2.3;sun.intensity=state.settings.night?.45:3.6
      scene.fog=globe?null:new T.FogExp2(state.settings.night?0x081222:0x9aabb4,state.settings.haze*.012)
      for(const holder of models.values())holder.userData.model.traverse(o=>{if(o.isMesh)o.material.wireframe=state.settings.wire})
      draw()
    }
    const updateLabels=()=>{
      camera.updateMatrixWorld()
      for(const r of rows){
        const holder=models.get(r.id),btn=buttons.get(r.id)
        const p=holder.position.clone().add(new T.Vector3(0,globe&&!orbitalClose?1.4:2.7,0)).project(camera)
        const backside=(globe&&!orbitalClose&&holder.position.dot(camera.position)<100) || (orbitalClose&&r.domain!=='space')
        btn.hidden=!live.current.settings.labels || !holder.visible || p.z>1 || Math.abs(p.x)>.98 || Math.abs(p.y)>.97 || backside
        if(!btn.hidden)btn.style.transform=`translate(-50%,-50%) translate(${(p.x*.5+.5)*box.clientWidth}px,${(-p.y*.5+.5)*box.clientHeight}px)`
      }
    }
    function draw(){if(disposed || lostContext || !box.clientWidth)return;renderer.render(scene,camera);updateLabels()}
    const resize=()=>{if(!box.clientWidth || !box.clientHeight)return;renderer.setSize(box.clientWidth,box.clientHeight);camera.aspect=box.clientWidth/box.clientHeight;camera.updateProjectionMatrix();draw()}
    const tick=(now)=>{
      frame=0;if(disposed)return
      if(live.current.playing && !document.hidden && !reduced.matches){
        if(now-lastDraw>32){clock+=Math.min(.1,(now-lastDraw)/1000);lastDraw=now;if(water)water.material.uniforms.uTime.value=clock;wake.material.uniforms.uTime.value=clock;draw()}
        frame=requestAnimationFrame(tick)
      }
    }
    const animate=()=>{cancelAnimationFrame(frame);lastDraw=performance.now();if(live.current.playing && !document.hidden && !reduced.matches)frame=requestAnimationFrame(tick);else draw()}
    const lost=e=>{e.preventDefault();lostContext=true;setFailure(true);cancelAnimationFrame(frame)}
    const restored=()=>{lostContext=false;setFailure(false);draw();animate()}
    renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('webglcontextrestored',restored)
    document.addEventListener('visibilitychange',animate);reduced.addEventListener('change',animate)
    controls.addEventListener('change',draw)
    const observer=new ResizeObserver(resize);observer.observe(box)
    api.current={refresh,animate,reset:()=>{controls.reset();draw()}}
    resize();refresh();animate()
    return ()=>{
      disposed=true;api.current=null;cancelAnimationFrame(frame);observer.disconnect();controls.dispose()
      document.removeEventListener('visibilitychange',animate);reduced.removeEventListener('change',animate)
      renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('webglcontextrestored',restored)
      // Models own extra shared materials that may not occur on a mesh.
      for(const holder of models.values()){holder.userData.model.userData.dispose();holder.remove(holder.userData.model)}
      disposeScene(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();labelBox.replaceChildren()
    }
  },[graph,mode,selected])
  useEffect(()=>{api.current?.refresh()},[step,settings])
  useEffect(()=>{api.current?.animate()},[playing])
  useEffect(()=>{api.current?.reset()},[resetToken])
  return <><div className="theater-webgl" ref={mount}/><div className="theater-labels" ref={labels}/>{failure && <div className="theater-failure" role="status">3D 장면을 표시할 수 없습니다. 지도·임무 그래프·상태 패널을 이용하세요.</div>}</>
}

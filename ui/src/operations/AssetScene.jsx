import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildModel } from './models.js'
import { CAUSE_COLOR } from '../tokens.mjs'

export default function AssetScene({ kind, cause }) {
  const mount = useRef(null)
  const api = useRef(null)
  const [failure, setFailure] = useState(false)
  const [wire, setWire] = useState(false)
  useEffect(() => {
    if (!kind || !mount.current) return
    const box = mount.current
    let renderer
    setFailure(false)
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }) }
    catch { setFailure(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.domElement.setAttribute('aria-label', '가상 자산 3D 모형. 드래그로 회전, 휠로 확대')
    renderer.domElement.setAttribute('role', 'img')
    box.appendChild(renderer.domElement)
    const scene = new T.Scene()
    scene.add(new T.HemisphereLight(0xffffff, 0x303946, 2.4))
    const sun = new T.DirectionalLight(0xffffff, 3.1)
    sun.position.set(-4, 8, -5); scene.add(sun)
    const model = buildModel(kind); scene.add(model)
    const grid = new T.GridHelper(14, 28, 0x515b65, 0x29323c)
    grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid)
    const ring = new T.Mesh(new T.RingGeometry(3.2, 3.23, 80), new T.MeshBasicMaterial({ color: 0x87929c, side: T.DoubleSide }))
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; scene.add(ring)
    const camera = new T.PerspectiveCamera(36, 1, 0.1, 100)
    camera.position.set(6.4, 4.6, -7.4)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.2, 0); controls.minDistance = 4; controls.maxDistance = 18
    controls.maxPolarAngle = Math.PI / 2.02; controls.enablePan = false
    controls.update(); controls.saveState()
    // Render on interaction/resize/state changes, not an idle animation loop.
    const render = () => renderer.render(scene, camera)
    const resize = () => {
      const w = box.clientWidth, h = box.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render()
    }
    const lost = (e) => { e.preventDefault(); setFailure(true) }
    const restored = () => { setFailure(false); render() }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    renderer.domElement.addEventListener('webglcontextrestored', restored)
    controls.addEventListener('change', render)
    const observer = new ResizeObserver(resize); observer.observe(box); resize()
    api.current = { model, ring, controls, render }
    return () => {
      api.current = null; observer.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      renderer.domElement.removeEventListener('webglcontextrestored', restored)
      model.userData.dispose(); grid.geometry.dispose(); grid.material.dispose()
      ring.geometry.dispose(); ring.material.dispose(); renderer.dispose(); renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [kind])
  useEffect(() => {
    const a = api.current
    if (!a) return
    a.model.traverse((o) => { if (o.isMesh) o.material.wireframe = wire })
    a.ring.material.color.set(CAUSE_COLOR[cause] || '#87929c'); a.render()
  }, [wire, cause, kind])
  return <div className="ops-scene">
    <div className="ops-scene-canvas" ref={mount} />
    {!kind && <p className="ops-scene-empty">그래프나 지도에서 자산을 선택하세요</p>}
    {failure && <p className="ops-scene-empty" role="status">3D 표시를 사용할 수 없습니다. 아래 자산 정보는 계속 이용할 수 있습니다.</p>}
    {kind && <div className="ops-scene-tools">
      <button type="button" aria-pressed={wire} onClick={() => setWire((v) => !v)}>와이어 모형</button>
      <button type="button" onClick={() => api.current?.controls.reset()}>시점 초기화</button>
    </div>}
    <span className="ops-scene-caption">가상 모형 · 실제 장비 형상 아님</span>
  </div>
}

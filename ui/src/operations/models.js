// Original, deliberately generic training silhouettes. No real airframe,
// dimension, sensor range, weapon envelope or equipment specification is encoded.
import * as T from 'three'

export function buildModel(kind, { stand = true } = {}) {
  const root = new T.Group()
  const shell = new T.MeshStandardMaterial({ color: '#aeb6be', metalness: 0.45, roughness: 0.48 })
  const dark = new T.MeshStandardMaterial({ color: '#252c33', metalness: 0.3, roughness: 0.65 })
  const glass = new T.MeshStandardMaterial({ color: '#5e6b76', metalness: 0.7, roughness: 0.2 })
  const light = new T.MeshStandardMaterial({ color: '#e1e5e8', metalness: 0.2, roughness: 0.5 })
  const mesh = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const m = new T.Mesh(geometry, material)
    m.position.set(...position); m.rotation.set(...rotation)
    root.add(m)
    return m
  }
  const box = (size, pos, mat = shell) => mesh(new T.BoxGeometry(...size), mat, pos)
  const tube = (r, length, pos, mat = shell, rot = [0, 0, 0]) => mesh(new T.CylinderGeometry(r, r, length, 16), mat, pos, rot)
  const panel = (points, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    const s = new T.Shape()
    points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y))
    s.closePath()
    const m = mesh(new T.ExtrudeGeometry(s, { depth: 0.055, bevelEnabled: false }), shell, pos, rot)
    return m
  }

  if (kind === 'fighter' || kind === 'aew') {
    const aew = kind === 'aew'
    const body = mesh(new T.SphereGeometry(1, 24, 14), shell, [0, 1.65, 0])
    body.scale.set(aew ? 0.35 : 0.28, aew ? 0.35 : 0.22, 2.5)
    mesh(new T.ConeGeometry(0.23, 1.15, 24), light, [0, 1.65, -2.55], [-Math.PI / 2, 0, 0])
    const canopy = mesh(new T.SphereGeometry(1, 20, 12), glass, [0, 1.89, -1.1])
    canopy.scale.set(0.21, 0.22, 0.62)
    for (const side of [-1, 1]) {
      panel([[0, -1.05], [side * (aew ? 2.9 : 2.35), 0.65], [side * 2.05, 1.12], [0, 0.85]], [0, 1.65, 0], [Math.PI / 2, 0, 0])
      panel([[0, -0.4], [side * 1.1, 0.48], [side * 0.9, 0.85], [0, 0.6]], [0, 1.65, 1.62], [Math.PI / 2, 0, 0])
      tube(0.17, 0.9, [side * (aew ? 1.1 : 0.27), 1.48, aew ? 0.15 : 1.8], dark, [Math.PI / 2, 0, 0])
      if (!aew) panel([[0, 0], [0.28, 0.85], [0.9, 0.32], [0.88, 0]], [side * 0.32, 1.75, 1.25], [0, -Math.PI / 2, side * -0.15])
    }
    if (aew) {
      box([0.12, 0.6, 0.7], [0, 2.15, 0.5], dark)
      const radar = mesh(new T.SphereGeometry(1, 32, 12), light, [0, 2.56, 0.5])
      radar.scale.set(1.15, 0.15, 1.15)
      panel([[0, 0], [0.12, 0.9], [0.8, 0.4], [0.8, 0]], [0, 1.8, 1.55], [0, -Math.PI / 2, 0])
    }
    // Display stand, not an altitude scale.
    if (stand) tube(0.035, 1.35, [0, 0.68, 0], dark)
  } else if (kind === 'ship' || kind === 'usv') {
    const small = kind === 'usv'
    const hull = (offset, width) => {
      const s = new T.Shape()
      const outline = [[0,-4], [width * .65,-3.25], [width,-1.5], [width,2.9], [width * .7,3.4], [-width * .7,3.4], [-width,2.9], [-width,-1.5], [-width * .65,-3.25]]
      outline.forEach(([x,z],i) => i ? s.lineTo(x,z) : s.moveTo(x,z)); s.closePath()
      mesh(new T.ExtrudeGeometry(s,{depth:.55,bevelEnabled:true,bevelSize:.09,bevelThickness:.12,bevelSegments:2}),shell,[offset,.3,0],[Math.PI/2,0,0])
    }
    if (small) { hull(-.52,.3); hull(.52,.3); box([1.6,.14,4.7],[0,.35,.1]) }
    else hull(0,.88)
    box([small ? 1.05 : 1.45,.5,2.8],[0,.55,.2])
    box([small ? .8 : 1.22,.55,1.1],[0,1.05,-.7])
    box([small ? .85 : 1.3,.12,1.2],[0,1.39,-.7],light)
    box([small ? .65 : 1.05,.22,.025],[0,1.1,-1.265],glass)
    for(const x of [-.32,0,.32])box([.025,.23,.03],[x,1.1,-1.285],shell)
    for (const side of [-1,1]) {
      box([.02,.22,.88],[side * (small ? .41 : .62),1.1,-.7],glass)
      for (const z of [-2.8,-1.9,-1,0,1,2,2.8]) tube(.014,.28,[side * (small ? .76 : .84),.5,z],light)
      box([.018,.018,5.6],[side * (small ? .76 : .84),.65,0],light)
      for (const z of [.5,1.2,1.9]) box([.08,.12,.18],[side * .7,.83,z],dark)
    }
    box([small ? .75 : 1.15,.2,1.6],[0,.82,1.2])
    tube(.045,1.65,[0,1.8,.25],light)
    box([1,.07,.15],[0,2.35,.25],shell)
    box([.48,.28,.08],[0,2.65,.25],dark)
    mesh(new T.SphereGeometry(.2,16,10),light,[0,1.55,.95])
    if(!small){
      const pad=mesh(new T.RingGeometry(.38,.4,40),light,[0,.935,1.7],[-Math.PI/2,0,0])
      for(const x of [-.12,.12])box([.035,.012,.28],[x,.94,1.7],light)
      box([.24,.012,.035],[0,.94,1.7],light)
      pad.material=light
    }
    if (small) root.scale.setScalar(.8)
  } else if (kind === 'spacecraft') {
    const foil = new T.MeshStandardMaterial({color:'#c1a86e',metalness:.72,roughness:.38})
    const solar = new T.MeshStandardMaterial({color:'#244d77',metalness:.5,roughness:.32,side:T.DoubleSide})
    box([1.1,1.2,1.2],[0,1.4,0],foil)
    tube(.05,4.6,[0,1.4,0],light,[0,0,Math.PI/2])
    for (const side of [-1,1]) {
      box([1.6,.06,2.4],[side * 1.55,1.4,0],solar)
      for (let i=0;i<5;i++) box([.012,.075,2.38],[side * (.82+i*.36),1.4,0],light)
      for (let i=0;i<7;i++) box([1.58,.075,.012],[side * 1.55,1.4,-1.16+i*.38],light)
    }
    tube(.15,.6,[0,2.2,0],light)
    const dish = mesh(new T.SphereGeometry(.62,24,12,0,Math.PI*2,0,.8),light,[0,2.4,0],[.5,0,0])
    dish.material = light.clone(); dish.material.side = T.DoubleSide
    box([.4,.35,.3],[0,1.4,-.75],dark)
  } else if (kind === 'vehicle') {
    box([1.5, 0.36, 3.1], [0, 0.63, 0], dark)
    box([1.55, 1.05, 1.9], [0, 1.28, 0.48])
    box([1.5, 0.8, 0.95], [0, 1.12, -1.02])
    box([1.32, 0.42, 0.035], [0, 1.32, -1.51], glass)
    for (const side of [-1, 1]) {
      for (const z of [-1.05, 0.95]) tube(0.4, 0.25, [side * 0.8, 0.43, z], dark, [0, 0, Math.PI / 2])
      box([0.04, 0.36, 0.62], [side * 0.76, 1.34, -0.99], glass)
    }
    tube(0.028, 1.45, [0.55, 2.25, 0.9], light)
    box([1.25, 0.1, 0.1], [0, 1.85, 0.7], dark)
  } else if (kind === 'relay' || kind === 'satellite') {
    box([1.2, 0.18, 1.2], [0, 0.1, 0], dark)
    tube(0.07, 2.6, [0, 1.4, 0])
    if (kind === 'satellite') {
      const dish = mesh(new T.SphereGeometry(1.05, 32, 18, 0, Math.PI * 2, 0, 0.65), light, [0, 2.2, 0], [0.7, 0, 0])
      dish.material = light.clone(); dish.material.side = T.DoubleSide
      tube(0.03, 1.0, [0, 2.8, 0.45], dark, [0.7, 0, 0])
    } else {
      for (const y of [1.3, 1.85, 2.4]) box([1.6, 0.055, 0.055], [0, y, 0])
      for (const x of [-0.7, 0.7]) tube(0.03, 1.35, [x, 1.9, 0], light)
      box([0.42, 0.65, 0.33], [0.45, 0.5, 0.05], dark)
    }
  } else if (kind === 'rack') {
    box([1.3, 2.65, 1.15], [0, 1.4, 0], dark)
    for (let i = 0; i < 8; i++) {
      box([1.18, 0.22, 0.08], [0, 0.36 + i * 0.3, -0.6])
      box([0.65, 0.065, 0.02], [0.12, 0.36 + i * 0.3, -0.65], dark)
      box([0.07, 0.07, 0.03], [-0.43, 0.36 + i * 0.3, -0.66], light)
    }
    for (const x of [-0.66, 0.66]) box([0.06, 2.8, 1.2], [x, 1.4, 0])
  } else if (kind === 'network') {
    box([2.2, 0.45, 1.3], [0, 0.5, 0])
    for (let i = 0; i < 8; i++) box([0.17, 0.15, 0.03], [-0.84 + i * 0.24, 0.5, -0.67], dark)
    for (const x of [-0.85, 0.85]) tube(0.025, 1.5, [x, 1.4, 0.4], dark)
  } else {
    box([1.9, 1.28, 0.16], [0, 1.3, 0])
    box([1.72, 1.08, 0.025], [0, 1.3, -0.095], glass)
    tube(0.08, 0.6, [0, 0.6, 0])
    box([1.4, 0.09, 0.75], [0, 0.28, 0])
    box([1.5, 0.08, 0.55], [0, 0.15, -0.8], dark)
  }
  root.rotation.y = -0.3
  // Materials can be shared by meshes. Release each resource exactly once.
  root.userData.dispose = () => {
    const geometries = new Set(), materials = new Set([shell, dark, glass, light])
    root.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material) })
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose())
  }
  return root
}

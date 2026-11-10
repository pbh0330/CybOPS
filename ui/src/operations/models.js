// Original, deliberately generic training silhouettes. No real airframe,
// dimension, sensor range, weapon envelope or equipment specification is encoded.
import * as T from 'three'

export function buildModel(kind) {
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
    tube(0.035, 1.35, [0, 0.68, 0], dark)
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

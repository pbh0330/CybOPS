// Device icons.
//
// Source: Tabler Icons (https://tabler.io/icons), MIT licence, vendored here as
// path data so the bundle stays offline and self-contained (ADR-0018).
// Copyright (c) 2020-2025 Pawel Kuna. Licence text: ui/THIRD-PARTY.md.
//
// WHY THESE EXIST ALONGSIDE THE 2525 SYMBOLS. The 2525D cyberspace set draws
// every device as the same rounded box with a three-letter abbreviation inside
// (HST, RTR, ...). That is standard-correct and unreadable: at a glance nobody
// can tell a relay from a database. So the device icon answers "what kind of
// machine is this", and the 2525 symbol stays on the node as a small badge
// where it still carries identity and the status marks the standard defines
// (ADR-0013).

export const ICON_PATHS = {
  'building-broadcast-tower': '<path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M16.616 13.924a5 5 0 1 0 -9.23 0" /> <path d="M20.307 15.469a9 9 0 1 0 -16.615 0" /> <path d="M9 21l3 -9l3 9" /> <path d="M10 19h4" />',
  'database': '<path d="M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" /> <path d="M4 6v6a8 3 0 0 0 16 0v-6" /> <path d="M4 12v6a8 3 0 0 0 16 0v-6" />',
  'device-desktop': '<path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10" /> <path d="M7 20h10" /> <path d="M9 16v4" /> <path d="M15 16v4" />',
  'device-laptop': '<path d="M3 19l18 0" /> <path d="M5 7a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8" />',
  'device-tablet': '<path d="M5 4a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16" /> <path d="M11 17a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />',
  'mail': '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10" /> <path d="M3 7l9 6l9 -6" />',
  'network': '<path d="M6 9a6 6 0 1 0 12 0a6 6 0 0 0 -12 0" /> <path d="M12 3c1.333 .333 2 2.333 2 6s-.667 5.667 -2 6" /> <path d="M12 3c-1.333 .333 -2 2.333 -2 6s.667 5.667 2 6" /> <path d="M6 9h12" /> <path d="M3 20h7" /> <path d="M14 20h7" /> <path d="M10 20a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M12 15v3" />',
  'router': '<path d="M3 15a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -4" /> <path d="M17 17l0 .01" /> <path d="M13 17l0 .01" /> <path d="M15 13l0 -2" /> <path d="M11.75 8.75a4 4 0 0 1 6.5 0" /> <path d="M8.5 6.5a8 8 0 0 1 13 0" />',
  'satellite': '<path d="M3.707 6.293l2.586 -2.586a1 1 0 0 1 1.414 0l5.586 5.586a1 1 0 0 1 0 1.414l-2.586 2.586a1 1 0 0 1 -1.414 0l-5.586 -5.586a1 1 0 0 1 0 -1.414" /> <path d="M6 10l-3 3l3 3l3 -3" /> <path d="M10 6l3 -3l3 3l-3 3" /> <path d="M12 12l1.5 1.5" /> <path d="M14.5 17a2.5 2.5 0 0 0 2.5 -2.5" /> <path d="M15 21a6 6 0 0 0 6 -6" />',
  'server-2': '<path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2" /> <path d="M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2" /> <path d="M7 8l0 .01" /> <path d="M7 16l0 .01" /> <path d="M11 8h6" /> <path d="M11 16h6" />',
  'shield-lock': '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" /> <path d="M11 11a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M12 12l0 2.5" />',
  'stack-2': '<path d="M12 4l-8 4l8 4l8 -4l-8 -4" /> <path d="M4 12l8 4l8 -4" /> <path d="M4 16l8 4l8 -4" />',
  'topology-star-3': '<path d="M10 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M18 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M10 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M6 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M18 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M14 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M22 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0" /> <path d="M6 12h4" /> <path d="M14 12h4" /> <path d="M15 7l-2 3" /> <path d="M9 7l2 3" /> <path d="M11 14l-2 3" /> <path d="M13 14l2 3" />',
  'world-www': '<path d="M19.5 7a9 9 0 0 0 -7.5 -4a8.991 8.991 0 0 0 -7.484 4" /> <path d="M11.5 3a16.989 16.989 0 0 0 -1.826 4" /> <path d="M12.5 3a16.989 16.989 0 0 1 1.828 4" /> <path d="M19.5 17a9 9 0 0 1 -7.5 4a8.991 8.991 0 0 1 -7.484 -4" /> <path d="M11.5 21a16.989 16.989 0 0 1 -1.826 -4" /> <path d="M12.5 21a16.989 16.989 0 0 0 1.828 -4" /> <path d="M2 10l1 4l1.5 -4l1.5 4l1 -4" /> <path d="M17 10l1 4l1.5 -4l1.5 4l1 -4" /> <path d="M9.5 10l1 4l1.5 -4l1.5 4l1 -4" />',
}

// Service icons. Services were all the same green diamond, which made the
// middle layer of the graph unreadable: C2 messaging, voice and fire control
// are not interchangeable, and the picture should not imply they are.
export const SERVICE_ICON_PATHS = {
  'message-2': '<path d="M8 9h8" /> <path d="M8 13h6" /> <path d="M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3" />',
  'headset': '<path d="M4 14v-3a8 8 0 1 1 16 0v3" /> <path d="M18 19c0 1.657 -2.686 3 -6 3" /> <path d="M4 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3" /> <path d="M15 14a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2v-3" />',
  'crosshair': '<path d="M4 8v-2a2 2 0 0 1 2 -2h2" /> <path d="M4 16v2a2 2 0 0 0 2 2h2" /> <path d="M16 4h2a2 2 0 0 1 2 2v2" /> <path d="M16 20h2a2 2 0 0 0 2 -2v-2" /> <path d="M9 12l6 0" /> <path d="M12 9l0 6" />',
  'map-pin': '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0" />',
  'eye': '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /> <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />',
  'key': '<path d="M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0" /> <path d="M15 9h.01" />',
  'folder': '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />',
  'clipboard-list': '<path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" /> <path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2" /> <path d="M9 12l.01 0" /> <path d="M13 12l2 0" /> <path d="M9 16l.01 0" /> <path d="M13 16l2 0" />',
}

// Service.kind -> icon. `kind` is an ontology field (docs/03-mission-ontology.md),
// not a UI invention: the same distinction decides which services are
// interchangeable when someone edits a scenario.
export const SERVICE_ICON_BY_KIND = {
  messaging: 'message-2',
  voice: 'headset',
  'fire-control': 'crosshair',
  'position-reporting': 'map-pin',
  intel: 'eye',
  directory: 'key',
  file: 'folder',
  database: 'database',
  web: 'world-www',
  mail: 'mail',
  logistics: 'clipboard-list',
}

export function serviceIconDataUri(kind, opts = {}) {
  const name = SERVICE_ICON_BY_KIND[kind]
  if (!name) return null
  const path = SERVICE_ICON_PATHS[name] || ICON_PATHS[name]
  if (!path) return null
  const size = opts.size || 34
  const color = opts.color || '#e6f0fb'
  const width = opts.strokeWidth || 1.8
  const key = `svc|${name}|${size}|${color}|${width}`
  if (cache.has(key)) return cache.get(key)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">` +
    path + '</svg>'
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  cache.set(key, uri)
  return uri
}

export function serviceIconSvgMarkup(kind, opts = {}) {
  const name = SERVICE_ICON_BY_KIND[kind]
  const path = name ? (SERVICE_ICON_PATHS[name] || ICON_PATHS[name]) : null
  if (!path) return ''
  const size = opts.size || 22
  return `<svg class="dev-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${path}</svg>`
}

// Asset.type -> icon. Types come from the scenarios; anything unmapped falls
// back to no icon so a new type is visibly unstyled rather than silently wrong.
export const ICON_BY_TYPE = {
  'c2-server': 'server-2',
  'fire-control-server': 'topology-star-3',
  'database': 'database',
  'file-server': 'server-2',
  'mail-server': 'mail',
  'web-server': 'world-www',
  'domain-controller': 'server-2',
  'hypervisor': 'stack-2',
  'gateway': 'router',
  'switch': 'network',
  'firewall': 'shield-lock',
  'workstation': 'device-desktop',
  'terminal': 'device-desktop',
  'c2-terminal': 'device-laptop',
  'observer-terminal': 'device-tablet',
  'radio-relay': 'building-broadcast-tower',
  'satcom-terminal': 'satellite',
}

const cache = new Map()

export function deviceIconDataUri(type, opts = {}) {
  const name = ICON_BY_TYPE[type]
  if (!name || !ICON_PATHS[name]) return null
  const size = opts.size || 40
  const color = opts.color || '#e6f0fb'
  const width = opts.strokeWidth || 1.7
  const key = `${name}|${size}|${color}|${width}`
  if (cache.has(key)) return cache.get(key)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">` +
    ICON_PATHS[name] +
    '</svg>'
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  cache.set(key, uri)
  return uri
}

export function iconNameFor(type) { return ICON_BY_TYPE[type] || null }

// For the legend and the palette, where the icon is shown as inline markup
// rather than as a node background.
export function iconSvgMarkup(type, opts = {}) {
  const name = ICON_BY_TYPE[type]
  if (!name || !ICON_PATHS[name]) return ''
  const size = opts.size || 24
  return `<svg class="dev-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="${opts.strokeWidth || 1.7}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
}

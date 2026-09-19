// MC-CyCOP situation display - viewer only.
//
// Every number on this screen was produced by the deterministic engine and
// exported by scripts/Export-ReplayData.ps1. Nothing here recomputes mission
// degradation, and nothing here is produced by a language model (ADR-0003).
// If a value looks wrong, the fix belongs in the engine, not in this file.

import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './style.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

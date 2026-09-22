// Attack presets for the start card. Code, not data: three shapes that read
// the graph for their targets and say when they do not apply.
export const PRESETS = [
  { id: 'insider', label: '내부자', desc: '중계하지 않는 단말 하나가 0.5 로 침해된 채 시작',
    pick: (g) => { const a = (g.assets || []).find((x) => x.transit === false); return a ? [{ id: a.id, level: 0.5 }] : null } },
  { id: 'satlink', label: '위성링크 침해', desc: '위성 단말 하나가 0.8 (자격증명까지)',
    pick: (g) => { const a = (g.assets || []).find((x) => x.type === 'satcom-terminal'); return a ? [{ id: a.id, level: 0.8 }] : null } },
  { id: 'multi', label: '다중 거점', desc: '단말 둘이 0.5',
    pick: (g) => { const t = (g.assets || []).filter((x) => x.transit === false).slice(0, 2); return t.length === 2 ? t.map((a) => ({ id: a.id, level: 0.5 })) : null } },
]

import * as T from 'three'

// Original illustrative water: artistic waves and highlights, not a sea-state model.
export function waterSurface() {
  const material = new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWave: { value: .55 }, uNight: { value: 0 } },
    vertexShader: `uniform float uTime; uniform float uWave; varying vec3 vWorld; varying vec3 vN;
      void main(){ vec3 p=position; float a=p.x*.37+p.z*.24+uTime*.8;
        float b=p.x*.91-p.z*.65+uTime*1.15; float c=p.x*2.7+p.z*1.9+uTime*1.7;
        p.y += uWave*(sin(a)*.22+sin(b)*.085+sin(c)*.018);
        float dx=uWave*(cos(a)*.0814+cos(b)*.07735+cos(c)*.0486);
        float dz=uWave*(cos(a)*.0528-cos(b)*.05525+cos(c)*.0342);
        vN=normalize(vec3(-dx,1.,-dz)); vWorld=(modelMatrix*vec4(p,1.)).xyz;
        gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.); }`,
    fragmentShader: `uniform float uTime; uniform float uNight; uniform float uWave; varying vec3 vWorld; varying vec3 vN;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      float wave(vec2 p){p+=vec2(noise(p*.22),noise(p*.26+42.))*1.3;return sin(dot(p,vec2(.7,.33))+uTime)*.2+sin(dot(p,vec2(1.6,-.85))+uTime*1.3)*.06+sin(dot(p,vec2(7.1,4.3))+uTime*2.)*.008;}
      void main(){ vec2 p=vWorld.xz; float h=wave(p); vec3 n=normalize(vec3(-(wave(p+vec2(.02,0.))-h)*uWave/.02,1.,-(wave(p+vec2(0.,.02))-h)*uWave/.02)); vec3 eye=normalize(cameraPosition-vWorld);
        float fres=pow(1.-max(dot(eye,n),0.),3.);
        vec3 deep=mix(vec3(.018,.075,.125),vec3(.008,.017,.035),uNight);
        vec3 sky=mix(vec3(.43,.61,.72),vec3(.055,.09,.15),uNight);
        vec3 light=normalize(vec3(-.3,.65,-.7)); float shine=pow(max(dot(reflect(-light,n),eye),0.),80.);
        vec3 col=mix(deep,sky,fres*.65)+shine*vec3(.66,.79,.86)*.22;
        float haze=1.-exp(-length(cameraPosition-vWorld)*.0025);
        gl_FragColor=vec4(mix(col,sky*.55,haze),1.); }`,
    side: T.DoubleSide,
  })
  const geo = new T.PlaneGeometry(650, 650, 190, 190); geo.rotateX(-Math.PI/2)
  return new T.Mesh(geo, material)
}

export function skyDome() {
  return new T.Mesh(new T.SphereGeometry(480,32,20),new T.ShaderMaterial({
    uniforms:{uNight:{value:0},uHaze:{value:.2}}, side:T.BackSide, depthWrite:false,
    vertexShader:`varying vec3 vP; void main(){vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vP; uniform float uNight; uniform float uHaze;
      void main(){float h=clamp(normalize(vP).y,0.,1.); vec3 horizon=mix(vec3(.65,.75,.79),vec3(.055,.08,.13),uNight);
        vec3 top=mix(vec3(.13,.32,.51),vec3(.002,.008,.025),uNight);
        vec3 c=mix(horizon,top,pow(h,.45)); c=mix(c,horizon,uHaze*.3);
        gl_FragColor=vec4(c,1.);}`,
  }))
}

export function globeSurface() {
  const earth = new T.Group()
  earth.add(new T.Mesh(new T.SphereGeometry(12,96,64),new T.MeshPhongMaterial({color:0x163650,shininess:22,specular:0x5b8caa})))
  // Geographic graticule, no invented coastlines or sensor coverage.
  const mat = new T.LineBasicMaterial({color:0x6a8c9e,transparent:true,opacity:.25})
  for(let lat=-60;lat<=60;lat+=15) {
    const a=lat*Math.PI/180, pts=[]
    for(let i=0;i<=128;i++){ const l=i/128*Math.PI*2;pts.push(new T.Vector3(12.02*Math.cos(a)*Math.cos(l),12.02*Math.sin(a),12.02*Math.cos(a)*Math.sin(l))) }
    earth.add(new T.Line(new T.BufferGeometry().setFromPoints(pts),mat))
  }
  for(let lon=0;lon<180;lon+=15) {
    const a=lon*Math.PI/180,pts=[]
    for(let i=0;i<=128;i++){const l=i/128*Math.PI*2;pts.push(new T.Vector3(12.02*Math.cos(l)*Math.cos(a),12.02*Math.sin(l),12.02*Math.cos(l)*Math.sin(a)))}
    earth.add(new T.Line(new T.BufferGeometry().setFromPoints(pts),mat))
  }
  earth.add(new T.Mesh(new T.SphereGeometry(12.16,64,48),new T.ShaderMaterial({
    transparent:true,depthWrite:false,side:T.FrontSide,blending:T.AdditiveBlending,
    vertexShader:`varying vec3 vN; varying vec3 vV; void main(){vec4 p=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader:`varying vec3 vN; varying vec3 vV; void main(){float a=pow(1.-max(dot(normalize(vN),normalize(vV)),0.),3.);gl_FragColor=vec4(.25,.5,.85,a*.75);}`,
  })))
  return earth
}

export function disposeScene(root) {
  const geometries=new Set(),materials=new Set(),textures=new Set()
  root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of (Array.isArray(o.material)?o.material:[o.material]).filter(Boolean)){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value)}})
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())
}

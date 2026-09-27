// 3D exercise figures built with Three.js. Poses come from BLOOM_DAILY.anim keyframes and are
// solved with fixed bone lengths by rigidPose() in the app, then mapped into 3D: side-view poses
// face +x with near limbs toward the camera (+z); front-view poses face the camera.
window.Bloom3D = (function () {
  const T = window.THREE;
  if (!T) return null;
  let renderer = null, glOk = null;

  function supported() {
    if (glOk !== null) return glOk;
    try { const c = document.createElement('canvas'); glOk = !!(c.getContext('webgl2') || c.getContext('webgl')); }
    catch (e) { glOk = false; }
    return glOk;
  }
  function getRenderer() {
    if (!renderer) {
      renderer = new T.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.NoToneMapping;
    }
    return renderer;
  }

  const std = (color, roughness, extra) => new T.MeshStandardMaterial(Object.assign({ color, roughness, metalness:0 }, extra || {}));
  // Flat, illustrated look: three-step cel shading instead of glossy lighting.
  const ramp = new T.DataTexture(new Uint8Array([140, 195, 235]), 3, 1, T.RedFormat);
  ramp.minFilter = ramp.magFilter = T.NearestFilter; ramp.needsUpdate = true;
  const toon = color => new T.MeshToonMaterial({ color, gradientMap:ramp });
  const M = {
    skin:toon(0xF6C3A0), top:toon(0xF57EBB), pants:toon(0x6A2C8C), hair:toon(0x7A4126), eye:new T.MeshBasicMaterial({ color:0x3A2230 }),
    cheek:toon(0xF59A9E), shoe:toon(0xF6C3A0), prop:std(0xEBD6E1, 0.85), wood:std(0xC89F7A, 0.65), mat:std(0xF3B3CF, 0.9),
    ball:std(0xF59CC0, 0.35), water:std(0x77C4DE, 0.15, { transparent:true, opacity:0.32, depthWrite:false }),
    band:std(0x14B8A6, 0.5), iron:std(0x3A3340, 0.35, { metalness:0.35 }), swaddle:std(0xFFE2B8, 0.75), babySkin:std(0xE9B596, 0.6),
    ring:new T.MeshBasicMaterial({ color:0x14B8A6, transparent:true, opacity:0.6 })
  };
  const V = (p, z) => new T.Vector3(p[0] - 100, 126 - p[1], z || 0);
  const shadow = m => { m.castShadow = true; return m; };
  const cap = (r, len, mat) => shadow(new T.Mesh(new T.CapsuleGeometry(r, Math.max(0.1, len), 6, 16), mat));
  const sph = (r, mat) => shadow(new T.Mesh(new T.SphereGeometry(r, 28, 18), mat));
  // Smooth body section: a lathe along +Y (0..1) from radius profile [[r, y], ...]
  const lathe = (profile, mat) => {
    const m2 = mat.clone(); m2.side = T.DoubleSide;
    return shadow(new T.Mesh(new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 28), m2));
  };
  const box = (w, h, d, mat) => { const m = shadow(new T.Mesh(new T.BoxGeometry(w, h, d), mat)); m.receiveShadow = true; return m; };
  const basis = new T.Matrix4();

  // Places a capsule (built along +Y with length geoLen) between a and b; lateral fixes its twist.
  function span(mesh, a, b, geoLen, lateral, sx, sz) {
    const d = new T.Vector3().subVectors(b, a), len = d.length() || 0.001;
    d.divideScalar(len);
    mesh.position.copy(a).addScaledVector(d, len / 2);
    const x = lateral ? lateral.clone() : (Math.abs(d.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0));
    x.addScaledVector(d, -x.dot(d));
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0).addScaledVector(d, -d.x);
    x.normalize();
    const z = new T.Vector3().crossVectors(x, d).normalize();
    basis.makeBasis(x, d, z);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.scale.set(sx || 1, geoLen ? Math.max(0.4, len / geoLen) : 1, sz || 1);
  }

  function addProps(scene, prop) {
    const add = (m, x, y, z) => { m.position.set(x, y, z); scene.add(m); return m; };
    if (prop === 'mat') add(box(150, 1.2, 42, M.mat), 0, 0.6, 0).castShadow = false;
    if (prop === 'chair') {
      add(box(28, 3, 28, M.wood), -22, 25, 0); add(box(3, 36, 28, M.wood), -35.5, 44, 0);
      [[-34, 12], [-34, -12], [-10, 12], [-10, -12]].forEach(([x, z]) => add(box(2.6, 24, 2.6, M.wood), x, 12, z));
    }
    if (prop === 'wall') add(box(4, 130, 84, M.prop), 56, 65, -38); // behind the figure so the camera sees the move
    if (prop === 'wallback') add(box(4, 130, 120, M.prop), -16, 65, 0);
    if (prop === 'door') add(box(5, 124, 5, M.wood), -10, 62, 12);
    if (prop === 'counter') { add(box(44, 56, 52, M.prop), 50, 28, 0); add(box(48, 3, 56, M.wood), 50, 57.5, 0); }
    if (prop === 'step') add(box(52, 18, 44, M.prop), 30, 9, 0);
    if (prop === 'ball') add(sph(18, M.ball), -16, 18, 0);
    if (prop === 'water') { const w = add(box(300, 52, 140, M.water), 0, 26, 0); w.castShadow = false; }
    if (prop === 'bike') {
      const tube = (a, b, r) => { const m = cap(r, a.distanceTo(b), M.iron); span(m, a, b, a.distanceTo(b)); scene.add(m); };
      tube(new T.Vector3(-14, 50, 0), new T.Vector3(-2, 18, 0), 1.6);
      tube(new T.Vector3(-2, 18, 0), new T.Vector3(24, 46, 0), 1.6);
      tube(new T.Vector3(24, 46, 0), new T.Vector3(28, 68, 0), 1.4);
      tube(new T.Vector3(28, 68, -8), new T.Vector3(28, 68, 8), 1.2);
      add(box(18, 3, 9, M.iron), -16, 51, 0);
      add(box(72, 3, 24, M.iron), 0, 1.5, 0);
      tube(new T.Vector3(-2, 18, 0), new T.Vector3(-2, 1.5, 0), 1.6);
      const disc = new T.Mesh(new T.CylinderGeometry(9, 9, 1.5, 28), M.prop); disc.rotation.x = Math.PI / 2; disc.position.set(0, 18, 0); scene.add(disc);
    }
  }

  function buildBody(scene, pregnant, prop) {
    const b = {}, add = (k, m) => { b[k] = m; scene.add(m); };
    add('hips', lathe([[0, -0.32], [4.5, -0.28], [7.2, -0.12], [7.9, 0.12], [7.6, 0.55], [6.9, 1]], M.pants));
    add('belly', lathe([[6.9, 0], [6.6, 0.5], [6.2, 1]], M.top));
    add('chest', lathe([[6.2, 0], [6.9, 0.3], [7.5, 0.55], [7.4, 0.78], [6.3, 0.94], [3.2, 1.04], [0, 1.08]], M.top));
    add('neck', cap(2.2, 5, M.skin));
    add('head', sph(8.2, M.skin));
    add('hair', sph(8.7, M.hair));
    add('bun', cap(2.7, 9, M.hair));
    add('eye1', sph(0.95, M.eye)); add('eye2', sph(0.95, M.eye));
    add('cheek1', sph(1.3, M.cheek)); add('cheek2', sph(1.3, M.cheek));
    [1, 2].forEach(i => {
      add('sh' + i, sph(3.1, M.skin));
      add('upper' + i, cap(2.6, 14, M.skin));
      add('elbow' + i, sph(2.1, M.skin));
      add('fore' + i, cap(2.0, 15, M.skin));
      add('hand' + i, sph(2.3, M.skin));
      add('thigh' + i, cap(4.3, 19, M.pants));
      add('knee' + i, sph(3.3, M.pants));
      add('shin' + i, cap(3.0, 20, M.pants));
      add('foot' + i, cap(2.1, 5.5, M.skin));
    });
    if (pregnant) add('bump', sph(9.2, M.top));
    const ring = new T.Mesh(new T.TorusGeometry(1, 0.06, 8, 48), M.ring); ring.visible = false; add('ring', ring);
    if (prop === 'weight' || prop === 'weights') { add('wt1', cap(1.8, 9, M.iron)); if (prop === 'weights') add('wt2', cap(1.8, 9, M.iron)); }
    if (prop === 'band') add('band', cap(0.7, 10, M.band));
    if (prop === 'baby') { add('babyBody', cap(5.5, 8, M.swaddle)); add('babyHead', sph(4.4, M.babySkin)); }
    return b;
  }

  function create(canvas, def, pregnant) {
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0xf3d9e6, 1.15));
    const sun = new T.DirectionalLight(0xffffff, 1.45);
    sun.position.set(70, 170, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left:-140, right:140, top:150, bottom:-70, near:20, far:500 });
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 5;
    scene.add(sun);
    const fill = new T.DirectionalLight(0xffe4ef, 0.7); fill.position.set(-140, 70, -30); scene.add(fill);
    const floor = new T.Mesh(new T.PlaneGeometry(700, 700), new T.ShadowMaterial({ opacity:0.12 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    addProps(scene, def.prop);
    const body = buildBody(scene, pregnant, def.prop);
    const vb = (def.vb || '0 0 200 134').split(' ').map(Number);
    // Orthographic three-quarter view, like an isometric illustration
    const aspect = canvas.width / canvas.height;
    let hw = vb[2] * 0.42, hh = vb[3] * 0.42;
    if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cam = new T.OrthographicCamera(-hw, hw, hh, -hh, 1, 3000);
    const target = new T.Vector3(vb[0] + vb[2] / 2 - 100, 126 - (vb[1] + vb[3] / 2), 0);
    const dir = new T.Vector3(0.55, 0.42, 1).normalize();
    cam.position.copy(target).addScaledVector(dir, 600);
    cam.lookAt(target);
    return { canvas, ctx:canvas.getContext('2d'), scene, cam, body, prop:def.prop, pregnant };
  }

  function pose(fig, raw) {
    const q = rigidPose(raw), b = fig.body, front = q.view === 'front';
    const zS = front ? 0 : 9, zA = front ? 0 : 8.5, zH = front ? 0 : 6;
    const P = V(q.p), S = V(q.s), H = V(q.h);
    const v2x = q.s[0] - q.p[0], v2y = q.s[1] - q.p[1], l2 = Math.hypot(v2x, v2y) || 1, n2 = [-v2y / l2, v2x / l2];
    const fwd = front ? new T.Vector3(0, 0, 1) : new T.Vector3(n2[0], -n2[1], 0);
    const up = new T.Vector3().subVectors(S, P).normalize();
    const lat = front ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
    const mid = V([(q.p[0] + q.s[0]) / 2 + n2[0] * q.c, (q.p[1] + q.s[1]) / 2 + n2[1] * q.c]);
    const hipTop = P.clone().lerp(mid, 0.55);
    span(b.hips, P, hipTop, 1, lat, 1.22, 0.9);
    span(b.belly, hipTop, mid, 1, lat, 1.12, 0.88);
    span(b.chest, mid, S, 1, lat, 1.2, 0.86);
    const neckTop = S.clone().lerp(H, 0.55);
    span(b.neck, S.clone().addScaledVector(up, -1), neckTop, 5 + 4.4);
    b.head.position.copy(H);
    const headUp = new T.Vector3().subVectors(H, S).normalize();
    b.hair.position.copy(H).addScaledVector(fwd, -1.4).addScaledVector(headUp, 1.1);
    const tieAt = H.clone().addScaledVector(fwd, -8).addScaledVector(headUp, 2.5);
    const tailEnd = tieAt.clone().addScaledVector(fwd, -3).addScaledVector(headUp, -9);
    if (tailEnd.y < 2) tailEnd.y = 2;
    span(b.bun, tieAt, tailEnd, 9 + 5.4);
    const faceLat = front ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1);
    [1, 2].forEach(i => {
      const sgn = i === 1 ? 1 : -1;
      b['eye' + i].position.copy(H).addScaledVector(fwd, 7.4).addScaledVector(faceLat, 2.8 * sgn).addScaledVector(headUp, 1);
      b['cheek' + i].position.copy(H).addScaledVector(fwd, 7).addScaledVector(faceLat, 4 * sgn).addScaledVector(headUp, -1.8);
    });
    [1, 2].forEach(i => {
      const sg = i === 1 ? 1 : -1;
      const A = V(q['a' + i], sg * zS), E = V(q['e' + i], sg * zA), W = V(q['w' + i], sg * zA);
      const R = V(q['r' + i], sg * zH), K = V(q['k' + i], sg * zH), F = V(q['f' + i], sg * zH), Tt = V(q['t' + i], sg * zH);
      b['sh' + i].position.copy(A);
      span(b['upper' + i], A, E, 14 + 4.8);
      b['elbow' + i].position.copy(E);
      span(b['fore' + i], E, W, 15 + 4);
      b['hand' + i].position.copy(W);
      span(b['thigh' + i], R, K, 19 + 8.6);
      b['knee' + i].position.copy(K);
      span(b['shin' + i], K, F, 20 + 6);
      const lift = new T.Vector3(0, 2, 0);
      span(b['foot' + i], F.clone().add(lift), Tt.clone().add(lift), 5.5 + 4.2);
      if (b['wt' + i]) span(b['wt' + i], W.clone().add(new T.Vector3(0, 0, -5)), W.clone().add(new T.Vector3(0, 0, 5)), 9 + 3.6);
      if (i === 1 && b.band) span(b.band, W, Tt, 10 + 1.4);
      if (i === 1 && b.babyBody) { b.babyBody.position.copy(W).add(new T.Vector3(1, 5, -zA)); b.babyBody.rotation.set(0, 0, Math.PI / 2); b.babyHead.position.copy(W).add(new T.Vector3(10, 7, -zA)); }
    });
    let belly;
    if (front) belly = P.clone().addScaledVector(up, l2 * 0.36).add(new T.Vector3(0, 0, 7));
    else {
      const dirB = q.bn ? new T.Vector3(q.bn[0], -q.bn[1], 0).normalize() : fwd;
      belly = P.clone().addScaledVector(up, l2 * 0.42).addScaledVector(dirB, 6.5 + Math.max(q.c, 0) * 0.45);
    }
    if (b.bump) b.bump.position.copy(belly);
    b.ring.visible = q.ring > 0.5;
    if (b.ring.visible) {
      const r = q.ring * 0.75 + (fig.pregnant ? 7 : 4);
      b.ring.position.copy(belly).addScaledVector(fwd, 2);
      b.ring.scale.set(r, r, r);
      b.ring.quaternion.copy(fig.cam.quaternion);
    }
  }

  function render(fig) {
    const r = getRenderer(), w = fig.canvas.width, h = fig.canvas.height;
    const cur = r.getSize(new T.Vector2());
    if (cur.x !== w || cur.y !== h) r.setSize(w, h, false);
    r.render(fig.scene, fig.cam);
    fig.ctx.clearRect(0, 0, w, h);
    fig.ctx.drawImage(r.domElement, 0, 0);
  }

  function dispose(fig) {
    fig.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  return { supported, create, pose, render, dispose };
})();

// 3D exercise figures: a rigged avatar (content/models/mom.glb, from pixiv's VRM sample,
// VRM Public License 1.0: commercial use, modification and redistribution allowed) posed from
// BLOOM_DAILY.anim keyframes. Poses are solved with fixed bone lengths by rigidPose() in the app,
// mapped into 3D (side-view poses face +x, front-view poses face the camera), then retargeted onto
// the avatar's skeleton by aiming each bone at its next joint. Styled as a flat two-tone illustration
// (sports crop top, leggings, flat shoes) seen from the side, like a fitness diagram.
window.Bloom3D = (function () {
  const T = window.THREE;
  if (!T || !window.GLTFLoader || !window.SkeletonClone) return null;
  let renderer = null, glOk = null, avatar = null, loading = false;
  const waiters = [];

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
    }
    return renderer;
  }

  // Two flat tones per colour, like a vector illustration.
  const ramp = new T.DataTexture(new Uint8Array([200, 255]), 2, 1, T.RedFormat);
  ramp.minFilter = ramp.magFilter = T.NearestFilter; ramp.needsUpdate = true;
  const toon = color => new T.MeshToonMaterial({ color, gradientMap:ramp });
  const OUTFIT = { top:0x2E6C74, leggings:0x5FA8A2, shoes:0x2A2A33, hair:0xA87462, skin:0xF6CDB4 };
  const M = {
    prop:toon(0xF1E4EA), wood:toon(0xD2AD8A), mat:toon(0xF3B3CF), ball:toon(0xE94F7D), band:toon(0xE94F7D),
    iron:toon(0x3A3340), swaddle:toon(0xFFE2B8), babySkin:toon(0xF2C4A6),
    water:new T.MeshStandardMaterial({ color:0x77C4DE, roughness:0.15, transparent:true, opacity:0.32, depthWrite:false }),
    ring:new T.MeshBasicMaterial({ color:0xE94F7D, transparent:true, opacity:0.6 })
  };
  // Recolours or trims a skinned material by bind-pose height (metres, before skinning):
  // leggings on the legs, and a crop top that ends under the bust so the bump shows.
  function byHeight(mat, opt) {
    const color = new T.Color(opt.color || 0xffffff);
    mat.onBeforeCompile = sh => {
      sh.uniforms.uBand = { value:new T.Vector2(opt.lo || -1, opt.hi || -1) };
      sh.uniforms.uBandColor = { value:color };
      sh.uniforms.uCut = { value:new T.Vector2(opt.cut || -1, opt.cutX || 99) };
      sh.uniforms.uFlat = { value:new T.Vector2(opt.flatLo || -1, opt.flatHi || -1) };
      sh.uniforms.uFlatColor = { value:new T.Color(opt.flatColor || 0xffffff) };
      sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
      sh.fragmentShader = 'varying vec3 vBind;\nuniform vec2 uBand;\nuniform vec3 uBandColor;\nuniform vec2 uCut;\nuniform vec2 uFlat;\nuniform vec3 uFlatColor;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nif (vBind.y < uCut.x || (abs(vBind.x) > uCut.y && vBind.y > 1.17)) discard;\nfloat bandTop = uBand.y + 0.075 * (1.0 - smoothstep(-0.03, 0.05, vBind.z));\nif (vBind.y > uBand.x && vBind.y < bandTop) diffuseColor.rgb = uBandColor;\nelse if (vBind.y > uFlat.x && vBind.y < uFlat.y && abs(vBind.x) < 0.2) diffuseColor.rgb = uFlatColor;');
    };
    mat.customProgramCacheKey = () => 'bh' + (opt.cut ? 'c' : '') + (opt.hi ? 'b' : '');
  }
  const V = (p, z) => new T.Vector3(p[0] - 100, 126 - p[1], z || 0);
  const shadow = m => { m.castShadow = true; return m; };
  const cap = (r, len, mat) => shadow(new T.Mesh(new T.CapsuleGeometry(r, Math.max(0.1, len), 6, 16), mat));
  const sph = (r, mat) => shadow(new T.Mesh(new T.SphereGeometry(r, 28, 18), mat));
  const box = (w, h, d, mat) => { const m = shadow(new T.Mesh(new T.BoxGeometry(w, h, d), mat)); m.receiveShadow = true; return m; };
  const basis = new T.Matrix4();

  function span(mesh, a, b, geoLen) {
    const d = new T.Vector3().subVectors(b, a), len = d.length() || 0.001;
    d.divideScalar(len);
    mesh.position.copy(a).addScaledVector(d, len / 2);
    const x = Math.abs(d.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0);
    x.addScaledVector(d, -x.dot(d)).normalize();
    basis.makeBasis(x, d, new T.Vector3().crossVectors(x, d).normalize());
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.scale.set(1, geoLen ? Math.max(0.3, len / geoLen) : 1, 1);
  }

  // ── Avatar ─────────────────────────────────────────────────────
  const B = n => 'J_Bip_' + n;
  function loadAvatar(done) {
    if (avatar) { done(avatar); return; }
    waiters.push(done);
    if (loading) return;
    loading = true;
    new GLTFLoader().load('content/models/mom.glb?v=2', g => {
      avatar = prepareAvatar(g.scene);
      waiters.splice(0).forEach(f => f(avatar));
    }, undefined, () => { loading = false; waiters.splice(0).forEach(f => f(null)); });
  }

  function prepareAvatar(scene) {
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const src = o.material, name = src.name || '';
      const opts = { map:src.map, transparent:src.transparent, alphaTest:src.alphaTest, side:src.side, depthWrite:src.depthWrite };
      const mat = /_FACE|_EYE/.test(name) ? new T.MeshBasicMaterial(opts) : new T.MeshToonMaterial(Object.assign(opts, { gradientMap:ramp }));
      if (/Tops/.test(name)) { mat.map = null; mat.color = new T.Color(OUTFIT.top); byHeight(mat, { cut:1.118, cutX:0.112 }); } // sleeveless sports crop top
      if (/Bottoms/.test(name)) o.visible = false;                                                          // leggings replace the shorts
      if (/_SKIN/.test(name)) mat.color = new T.Color(OUTFIT.skin);
      if (/Body_00_SKIN/.test(name)) byHeight(mat, { lo:0.095, hi:0.915, color:OUTFIT.leggings, flatLo:0.9, flatHi:1.2, flatColor:OUTFIT.skin }); // plain skin where the texture has underwear               // full-length leggings
      if (/Shoes/.test(name)) { mat.map = null; mat.color = new T.Color(OUTFIT.shoes); }                          // flat shoes
      if (/HAIR/.test(name)) mat.color = new T.Color(OUTFIT.hair);
      mat.name = name;
      o.material = mat;
    });
    // Shorten the long hair to shoulder length so it never hides the arms or trails across the floor.
    scene.traverse(o => {
      if (!o.isMesh || !/HAIR/.test(o.material.name)) return;
      const pos = o.geometry.attributes.position, top = 1.3;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < top) pos.setY(i, top - (top - y) * 0.42); }
      pos.needsUpdate = true;
      o.geometry.computeBoundingSphere();
    });
    scene.updateMatrixWorld(true);
    const wp = n => scene.getObjectByName(n).getWorldPosition(new T.Vector3());
    const hips = wp(B('C_Hips')), chest = wp(B('C_Chest')), upLeg = wp(B('L_UpperLeg')), lowLeg = wp(B('L_LowerLeg')), foot = wp(B('L_Foot'));
    // The diagrams' foot point is the sole, so hip-to-sole (leg plus ankle height) maps to 48 units.
    const legLen = upLeg.distanceTo(lowLeg) + lowLeg.distanceTo(foot) + Math.max(0, foot.y);
    return { scene, scale:48 / legLen, ankle:Math.max(0, foot.y) * 48 / legLen, belly:{ y0:hips.y, y1:chest.y, z:hips.z } };
  }

  // Shapes a pregnancy bump into the skin and T-shirt in bind pose, so it moves with the body.
  function shapeBump(root, week, belly) {
    const grow = Math.max(0, Math.min(1, (week - 12) / 28));
    const A = 0.04 + 0.12 * grow;
    const cy = belly.y0 + (belly.y1 - belly.y0) * 0.45, sy = (belly.y1 - belly.y0) * 0.62, sx = 0.105;
    root.traverse(o => {
      if (!o.isSkinnedMesh || !/Body_00_SKIN|Tops/.test(o.material.name)) return;
      const top = /Tops/.test(o.material.name);
      o.geometry = o.geometry.clone();
      o.userData.ownGeometry = true;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const f = Math.max(0, Math.min(1, (z - belly.z + 0.01) / 0.07));
        if (f <= 0) continue;
        const u = (y - cy) / sy, w = x / sx, g = Math.exp(-(u * u + w * w));
        pos.setZ(i, z + (A * (top ? 1.1 : 1) + (top ? 0.004 : 0)) * g * f * f * (3 - 2 * f));
      }
      pos.needsUpdate = true;
      o.geometry.computeVertexNormals();
    });
  }

  function makeRig(pregnant, week) {
    const root = SkeletonClone(avatar.scene);
    if (pregnant) shapeBump(root, week || 28, avatar.belly);
    root.scale.setScalar(avatar.scale);
    root.updateMatrixWorld(true);
    const rig = { root, rest:new Map(), aims:[], spec:{}, bones:[] };
    const get = n => root.getObjectByName(n);
    root.traverse(o => { if (o.isBone) { rig.rest.set(o, o.quaternion.clone()); rig.bones.push(o); } });
    rig.hips = get(B('C_Hips'));
    rig.hipsRestWorld = rig.hips.getWorldQuaternion(new T.Quaternion());
    // Rest direction from each bone to the joint it aims at, in its parent's rest frame
    const aimSpec = (boneName, childName) => {
      const bone = get(boneName), child = get(childName);
      if (!bone || !child) return null;
      const d = child.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3()));
      d.applyQuaternion(bone.parent.getWorldQuaternion(new T.Quaternion()).invert()).normalize();
      return { bone, child, restDir:d, restQ:rig.rest.get(bone) };
    };
    [['C_Spine','C_Chest'],['C_Chest','C_UpperChest'],['C_UpperChest','C_Neck'],['C_Neck','C_Head']].forEach(([a, b]) => rig.spec[a] = aimSpec(B(a), B(b)));
    ['L','R'].forEach(sd => {
      [['UpperLeg','LowerLeg'],['LowerLeg','Foot'],['Foot','ToeBase'],['UpperArm','LowerArm'],['LowerArm','Hand']]
        .forEach(([a, b]) => rig.spec[sd + a] = aimSpec(B(sd + '_' + a), B(sd + '_' + b)));
      rig.aims.push(aimSpec('J_Aim_' + sd + '_UpperLeg', B(sd + '_LowerLeg')),
                    aimSpec('J_Aim_' + sd + '_Shoulder', B(sd + '_LowerArm')),
                    aimSpec('J_Aim_' + sd + '_TopsUpperArm', B(sd + '_LowerArm')));
    });
    rig.aims = rig.aims.filter(Boolean);
    return rig;
  }

  const qTmp = new T.Quaternion(), vTmp = new T.Vector3();
  function aimTo(spec, dirWorld) {
    if (!spec || dirWorld.lengthSq() < 1e-8) return;
    const pq = spec.bone.parent.getWorldQuaternion(qTmp).invert();
    const target = dirWorld.clone().applyQuaternion(pq).normalize();
    spec.bone.quaternion.copy(new T.Quaternion().setFromUnitVectors(spec.restDir, target).multiply(spec.restQ));
    spec.bone.updateMatrixWorld(true);
  }

  function poseRig(rig, q, P3, S3, H3, mid3, up, fwd, front) {
    rig.bones.forEach(b => b.quaternion.copy(rig.rest.get(b)));
    const left = new T.Vector3().crossVectors(up, fwd).normalize();
    const f2 = new T.Vector3().crossVectors(left, up).normalize();
    const want = new T.Quaternion().setFromRotationMatrix(basis.makeBasis(left, up, f2)).multiply(rig.hipsRestWorld);
    rig.hips.quaternion.copy(rig.hips.parent.getWorldQuaternion(qTmp).invert().multiply(want));
    rig.root.updateMatrixWorld(true);
    rig.root.position.add(P3.clone().sub(rig.hips.getWorldPosition(vTmp)));
    rig.root.updateMatrixWorld(true);
    aimTo(rig.spec.C_Spine, mid3.clone().sub(P3));
    aimTo(rig.spec.C_Chest, S3.clone().sub(mid3));
    aimTo(rig.spec.C_UpperChest, S3.clone().sub(mid3));
    aimTo(rig.spec.C_Neck, H3.clone().sub(S3));
    // Limb 1 is the near side: the character's right in side views, her left in front views.
    // Side-lying moves bend the hips and knees along the floor, which a flat diagram can't show,
    // so those legs are built in 3D: hips bent forward by `fold` degrees, knees at about 100°,
    // and the diagram's knee height kept (that is the clamshell opening).
    const folds = q.fold == null ? [0, 0] : [].concat(q.fold, q.fold);
    const feetDir = Math.sign(P3.x - S3.x) || 1;
    const flat = (deg, y) => { const r = deg * Math.PI / 180, hz = Math.sqrt(Math.max(0, 1 - y * y)); return new T.Vector3(feetDir * Math.cos(r) * hz, y, Math.sin(r) * hz); };
    [1, 2].forEach(i => {
      const sd = front ? (i === 1 ? 'L' : 'R') : (i === 1 ? 'R' : 'L'), g = k => V(q[k + i]);
      const fold = folds[i - 1];
      if (fold) {
        const lift = Math.max(-0.2, Math.min(0.85, (V(q['kh' + i] || q['k' + i]).y - g('r').y) / 24));
        aimTo(rig.spec[sd + 'UpperLeg'], flat(fold, lift));
        aimTo(rig.spec[sd + 'LowerLeg'], flat(fold - 100, i === 1 && folds[1] ? -Math.min(0.95, lift + 0.4) : -lift)); // the top foot rests on the lower one
        aimTo(rig.spec[sd + 'Foot'], flat(fold - 20, 0));
      } else if (q.sz) { // shins pointing straight behind her (knees bent, feet back)
        aimTo(rig.spec[sd + 'UpperLeg'], g('k').sub(g('r')));
        aimTo(rig.spec[sd + 'LowerLeg'], new T.Vector3(0, 0, q.sz));
        aimTo(rig.spec[sd + 'Foot'], g('k').sub(g('r')).normalize().multiplyScalar(-0.3).add(new T.Vector3(0, 0, q.sz)));
      } else {
        const lift = new T.Vector3(0, avatar.ankle, 0); // diagram feet are soles; the avatar's foot joint is the ankle
        aimTo(rig.spec[sd + 'UpperLeg'], g('k').sub(g('r')));
        aimTo(rig.spec[sd + 'LowerLeg'], g('f').add(lift).sub(g('k')));
        aimTo(rig.spec[sd + 'Foot'], g('t').sub(g('f')));
      }
      aimTo(rig.spec[sd + 'UpperArm'], g('e').sub(g('a')));
      aimTo(rig.spec[sd + 'LowerArm'], g('w').sub(g('e')));
    });
    rig.aims.forEach(a => aimTo(a, a.child.getWorldPosition(new T.Vector3()).sub(a.bone.getWorldPosition(new T.Vector3()))));
  }

  // ── Scene ──────────────────────────────────────────────────────
  const BACKDROP = { mat:1, water:1, wall:1, wallback:1, door:1 };
  function addProps(scene, prop) {
    const add = (m, x, y, z) => { m.position.set(x, y, z); if (!BACKDROP[prop]) m.userData.fit = true; scene.add(m); return m; };
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
      const tube = (a, b, r) => { const m = cap(r, a.distanceTo(b), M.iron); span(m, a, b, a.distanceTo(b)); m.userData.fit = true; scene.add(m); };
      tube(new T.Vector3(-14, 50, 0), new T.Vector3(-2, 18, 0), 1.6);
      tube(new T.Vector3(-2, 18, 0), new T.Vector3(24, 46, 0), 1.6);
      tube(new T.Vector3(24, 46, 0), new T.Vector3(28, 68, 0), 1.4);
      tube(new T.Vector3(28, 68, -8), new T.Vector3(28, 68, 8), 1.2);
      add(box(18, 3, 9, M.iron), -16, 51, 0);
      add(box(72, 3, 24, M.iron), 0, 1.5, 0);
      tube(new T.Vector3(-2, 18, 0), new T.Vector3(-2, 1.5, 0), 1.6);
    }
  }

  function create(canvas, def, pregnant, week) {
    if (!avatar) return null;
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0xffffff, 1.1));
    const sun = new T.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-60, 160, 170); // from the front and above, so the far side falls into the second tone
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left:-140, right:140, top:150, bottom:-70, near:20, far:500 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(700, 700), new T.ShadowMaterial({ opacity:0.08 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    addProps(scene, def.prop);
    const rig = makeRig(pregnant, week);
    scene.add(rig.root);
    const extra = {};
    extra.ring = new T.Mesh(new T.TorusGeometry(1, 0.06, 8, 48), M.ring); extra.ring.visible = false; scene.add(extra.ring);
    if (def.prop === 'weight' || def.prop === 'weights') { extra.wt1 = cap(1.8, 9, M.iron); scene.add(extra.wt1); if (def.prop === 'weights') { extra.wt2 = cap(1.8, 9, M.iron); scene.add(extra.wt2); } }
    if (def.prop === 'band') { extra.band = cap(0.7, 10, M.band); scene.add(extra.band); }
    if (def.prop === 'baby') { extra.babyBody = cap(5.5, 8, M.swaddle); extra.babyHead = sph(4.4, M.babySkin); scene.add(extra.babyBody, extra.babyHead); }

    // The same near-side view for every move (like a flat illustration), framed around the whole movement.
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    cam.position.copy((def.high ? new T.Vector3(0.45, 0.6, 1) : new T.Vector3(0.16, 0.1, 1)).normalize().multiplyScalar(700)); // side-lying moves are seen from a little higher
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const fig = { canvas, ctx:canvas.getContext('2d'), scene, cam, rig, extra, pregnant };
    const lo = new T.Vector2(Infinity, Infinity), hi = new T.Vector2(-Infinity, -Infinity), pt = new T.Vector3(), bb = new T.Box3();
    const grow = (p, pad) => {
      pt.copy(p).applyMatrix4(cam.matrixWorldInverse);
      lo.x = Math.min(lo.x, pt.x - pad); lo.y = Math.min(lo.y, pt.y - pad); hi.x = Math.max(hi.x, pt.x + pad); hi.y = Math.max(hi.y, pt.y + pad);
    };
    const fitAll = () => {
      scene.updateMatrixWorld(true);
      rig.bones.forEach(b => grow(b.getWorldPosition(new T.Vector3()), /Head|Hair/.test(b.name) ? 10 : /Foot|Toe/.test(b.name) ? 8 : 6));
      scene.traverse(o => {
        if (!o.isMesh || !o.userData.fit) return;
        bb.setFromObject(o);
        for (let i = 0; i < 8; i++) grow(new T.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z), 0);
      });
    };
    const frames = def.frames.map(resolvePose);
    for (let ms = 0; ms < frames.length * 1300; ms += 100) { pose(fig, poseAt({ frames }, ms)); fitAll(); }
    let w = (hi.x - lo.x) * 1.1, h = (hi.y - lo.y) * 1.12;
    const aspect = Math.max(1.2, Math.min(2.2, w / h));
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const cx = (lo.x + hi.x) / 2, cy = (lo.y + hi.y) / 2;
    Object.assign(cam, { left:cx - w / 2, right:cx + w / 2, top:cy + h / 2, bottom:cy - h / 2 });
    cam.updateProjectionMatrix();
    canvas.height = Math.round(canvas.width / aspect);
    canvas.style.aspectRatio = aspect.toFixed(3);
    return fig;
  }

  function pose(fig, raw) {
    const q = rigidPose(raw), front = q.view === 'front', x = fig.extra;
    const P = V(q.p), S = V(q.s), H = V(q.h);
    const v2x = q.s[0] - q.p[0], v2y = q.s[1] - q.p[1], l2 = Math.hypot(v2x, v2y) || 1, n2 = [-v2y / l2, v2x / l2];
    const fwd = front ? new T.Vector3(0, 0, 1) : new T.Vector3(n2[0], -n2[1], 0);
    const up = new T.Vector3().subVectors(S, P).normalize();
    const mid = V([(q.p[0] + q.s[0]) / 2 + n2[0] * q.c, (q.p[1] + q.s[1]) / 2 + n2[1] * q.c]);
    poseRig(fig.rig, q, P, S, H, mid, up, fwd, front);
    const zA = front ? 0 : 8.5;
    const W1 = V(q.w1, zA), T1 = V(q.t1, front ? 0 : 6);
    if (x.wt1) span(x.wt1, W1.clone().add(new T.Vector3(0, 0, -5)), W1.clone().add(new T.Vector3(0, 0, 5)), 12.6);
    if (x.wt2) { const W2 = V(q.w2, -zA); span(x.wt2, W2.clone().add(new T.Vector3(0, 0, -5)), W2.clone().add(new T.Vector3(0, 0, 5)), 12.6); }
    if (x.band) span(x.band, W1, T1, 11.4);
    if (x.babyBody) { x.babyBody.position.copy(W1).add(new T.Vector3(3, 6, -zA)); x.babyBody.rotation.set(0, 0, Math.PI / 2); x.babyHead.position.copy(W1).add(new T.Vector3(12, 8, -zA)); }
    x.ring.visible = q.ring > 0.5;
    if (x.ring.visible) {
      const dirB = q.bn && !front ? new T.Vector3(q.bn[0], -q.bn[1], 0).normalize() : fwd;
      const belly = P.clone().addScaledVector(up, l2 * 0.38).addScaledVector(dirB, fig.pregnant ? 9 : 6);
      const r = q.ring * 0.4 + (fig.pregnant ? 7 : 5);
      x.ring.position.copy(belly);
      x.ring.scale.set(r, r, r);
      x.ring.quaternion.copy(fig.cam.quaternion);
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
    fig.scene.traverse(o => { if (o.isMesh && o.geometry && (!o.isSkinnedMesh || o.userData.ownGeometry)) o.geometry.dispose(); });
  }

  return { supported, loadAvatar, create, pose, render, dispose };
})();

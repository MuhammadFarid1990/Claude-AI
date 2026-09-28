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
  const OUTFIT = { top:0xEC6AA6, leggings:0x5E2C74, shoes:0x3B2440, hair:0xA87462, skin:0xF6CDB4 };
  const M = {
    prop:toon(0xF1E4EA), wood:toon(0xD2AD8A), mat:toon(0xF3B3CF), ball:toon(0xE94F7D), band:toon(0xE94F7D),
    iron:toon(0x3A3340), swaddle:toon(0xFFE2B8), babySkin:toon(0xF2C4A6),
    water:new T.MeshStandardMaterial({ color:0x77C4DE, roughness:0.15, transparent:true, opacity:0.32, depthWrite:false }),
    ring:new T.MeshBasicMaterial({ color:0xE94F7D, transparent:true, opacity:0.6 })
  };
  // Recolours or trims a skinned material by bind-pose height (metres, before skinning):
  // leggings on the legs, and a crop top that ends under the bust so the bump shows.
  const skinColor = new T.Color(OUTFIT.skin); // the body's average skin tone, measured from its texture in prepareAvatar
  function byHeight(mat, opt) {
    const color = new T.Color(opt.color || 0xffffff);
    mat.onBeforeCompile = sh => {
      sh.uniforms.uBand = { value:new T.Vector2(opt.lo || -1, opt.hi || -1) };
      sh.uniforms.uBandColor = { value:color };
      sh.uniforms.uCut = { value:new T.Vector2(opt.cut || -1, opt.cutX || 99) };
      sh.uniforms.uFlat = { value:new T.Vector2(opt.flatLo || -1, opt.flatHi || -1) };
      sh.uniforms.uFlatColor = { value:new T.Color(opt.flatColor || 0xffffff) };
      sh.uniforms.uSkin = { value:skinColor };
      sh.vertexShader = 'varying vec3 vBind;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
      sh.fragmentShader = 'varying vec3 vBind;\nuniform vec2 uBand;\nuniform vec3 uBandColor;\nuniform vec2 uCut;\nuniform vec2 uFlat;\nuniform vec3 uFlatColor;\nuniform vec3 uSkin;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nif (vBind.y < uCut.x) discard;\nif (abs(vBind.x) > uCut.y && vBind.y > 1.12) diffuseColor.rgb = uSkin; // sleeves show as the upper arm (no skin under the shirt to reveal)\nfloat bandTop = uBand.y + 0.075 * (1.0 - smoothstep(-0.03, 0.05, vBind.z));\nif (vBind.y > uBand.x && vBind.y < bandTop) diffuseColor.rgb = uBandColor;\nelse if (vBind.y > uFlat.x && vBind.y < uFlat.y && abs(vBind.x) < 0.2) diffuseColor.rgb = uFlatColor;');
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
      if (/Tops/.test(name)) { mat.map = null; mat.color = new T.Color(OUTFIT.top); mat.side = T.DoubleSide; byHeight(mat, { cut:1.09, cutX:0.13 }); } // sleeveless crop top; ends exactly where the model's skin begins (measured), inside drawn so the hem never shows a gap
      if (/Bottoms/.test(name)) o.visible = false;                                                          // leggings replace the shorts
      if (/_SKIN/.test(name)) mat.color = new T.Color(OUTFIT.skin);
      if (/Body_00_SKIN/.test(name) && src.map && src.map.image) {
        try {
          const cv = document.createElement('canvas'); cv.width = cv.height = 64;
          const cx = cv.getContext('2d'); cx.drawImage(src.map.image, 0, 0, 64, 64);
          const d = cx.getImageData(0, 0, 64, 64).data; let r = 0, g = 0, b = 0, n = 0;
          for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 200 && d[k] > d[k + 1] && d[k + 1] > d[k + 2] && d[k] > 150) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
          if (n) skinColor.setRGB(r / n / 255, g / n / 255, b / n / 255, T.SRGBColorSpace).multiply(mat.color);
        } catch (e) {}
      }
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
    const cy = belly.y0 + (belly.y1 - belly.y0) * (0.42 - 0.05 * grow), sy = (belly.y1 - belly.y0) * (0.62 + 0.3 * grow), sx = 0.105 + 0.03 * grow; // widens as it grows, so it stays round
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
        const u = (y - cy) / sy, w = x / sx, r2 = u * u + w * w, g = Math.exp(-Math.pow(r2, 1.35)); // flatter top than a bell curve: a round dome
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
    const rig = { root, rest:new Map(), aims:[], spec:{}, bones:[], pregnant };
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
      [['UpperLeg','LowerLeg'],['LowerLeg','Foot'],['Foot','ToeBase'],['UpperArm','LowerArm'],['LowerArm','Hand'],['Hand','Middle1']]
        .forEach(([a, b]) => rig.spec[sd + a] = aimSpec(B(sd + '_' + a), B(sd + '_' + b)));
      rig.aims.push(aimSpec('J_Aim_' + sd + '_UpperLeg', B(sd + '_LowerLeg')),
                    aimSpec('J_Aim_' + sd + '_Shoulder', B(sd + '_LowerArm')),
                    aimSpec('J_Aim_' + sd + '_TopsUpperArm', B(sd + '_LowerArm')));
    });
    rig.aims = rig.aims.filter(Boolean);
    // Which way each limb bone's front faces at rest (the model stands facing +z), in the bone's own frame.
    rig.front = new Map();
    ['L','R'].forEach(sd => ['UpperLeg','LowerLeg','UpperArm','LowerArm'].forEach(n => {
      const b = get(B(sd + '_' + n));
      rig.front.set(b, new T.Vector3(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new T.Quaternion()).invert()));
    }));
    const wpos = n => get(B(n)).getWorldPosition(new T.Vector3());
    rig.len = { thigh:wpos('L_UpperLeg').distanceTo(wpos('L_LowerLeg')), shin:wpos('L_LowerLeg').distanceTo(wpos('L_Foot')),
                upper:wpos('L_UpperArm').distanceTo(wpos('L_LowerArm')), fore:wpos('L_LowerArm').distanceTo(wpos('L_Hand')),
                torso:wpos('C_Hips').distanceTo(wpos('L_UpperArm').add(wpos('R_UpperArm')).multiplyScalar(0.5)), hipDrop:wpos('C_Hips').y - wpos('L_UpperLeg').y };
    { const fa = wpos('L_Foot'), ft = wpos('L_ToeBase'); rig.footTilt = Math.atan2(fa.y - ft.y, Math.hypot(ft.x - fa.x, ft.z - fa.z)); } // toe joint sits below the ankle
    rig.restWorld = new Map(); rig.bones.forEach(b => rig.restWorld.set(b.name, b.getWorldQuaternion(new T.Quaternion())));
    rig.hipsRestY = rig.hips.getWorldPosition(new T.Vector3()).y;
    rig.get = get;
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

  // Aims a thigh like a hip joint: first bend it forward/back about the pelvis's side-to-side axis,
  // then swing it out sideways. Avoids the arbitrary twist a shortest-path rotation gives for deep bends.
  function aimHip(spec, dirWorld, leftWorld) {
    if (!spec || dirWorld.lengthSq() < 1e-8) return;
    const pq = spec.bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
    const t = dirWorld.clone().applyQuaternion(pq).normalize(), ax = leftWorld.clone().applyQuaternion(pq).normalize();
    const r = spec.restDir.clone();
    const rp = r.clone().addScaledVector(ax, -r.dot(ax)), tp = t.clone().addScaledVector(ax, -t.dot(ax));
    let q1 = new T.Quaternion();
    if (rp.lengthSq() > 1e-6 && tp.lengthSq() > 1e-6) {
      rp.normalize(); tp.normalize();
      q1.setFromAxisAngle(ax, Math.atan2(new T.Vector3().crossVectors(rp, tp).dot(ax), rp.dot(tp)));
    }
    const q2 = new T.Quaternion().setFromUnitVectors(r.clone().applyQuaternion(q1).normalize(), t);
    spec.bone.quaternion.copy(q2.multiply(q1).multiply(spec.restQ));
    spec.bone.updateMatrixWorld(true);
  }
  const wp = (o, v) => o.getWorldPosition(v || new T.Vector3());
  const frontOf = (rig, bone) => rig.front.get(bone).clone().applyQuaternion(bone.getWorldQuaternion(new T.Quaternion()));
  // Turns a limb bone about its own axis so its front faces `want` (only the part square to the bone counts).
  function twistTo(rig, spec, want, limit) {
    const bone = spec.bone, axis = wp(spec.child).sub(wp(bone)).normalize();
    const w = want.clone().addScaledVector(axis, -want.dot(axis));
    if (w.lengthSq() < 1e-6) return;
    w.normalize();
    const f = frontOf(rig, bone); f.addScaledVector(axis, -f.dot(axis)).normalize();
    let ang = Math.atan2(new T.Vector3().crossVectors(f, w).dot(axis), f.dot(w));
    if (limit) ang = Math.max(-limit, Math.min(limit, ang));
    const worldQ = bone.getWorldQuaternion(new T.Quaternion());
    const nw = new T.Quaternion().setFromAxisAngle(axis, ang).multiply(worldQ);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(qTmp).invert().multiply(nw));
    bone.updateMatrixWorld(true);
  }
  // Keeps the foot at a natural angle to the shin: pointing forward, never sideways or bent back.
  function setFoot(rig, sd, toeDir) {
    const shin = rig.spec[sd + 'LowerLeg'], a = wp(shin.child).sub(wp(shin.bone)).normalize();
    const f = frontOf(rig, shin.bone); f.addScaledVector(a, -f.dot(a)).normalize();
    const l = new T.Vector3().crossVectors(a, f);
    const d = toeDir.clone().normalize();
    const da = Math.max(-0.7, Math.min(0.9, d.dot(a))), df = Math.max(0.3, d.dot(f)), dl = Math.max(-0.25, Math.min(0.25, d.dot(l)));
    const sole = a.clone().multiplyScalar(da).addScaledVector(f, df).addScaledVector(l, dl).normalize();
    // `sole` is heel-to-toe along the sole; the ankle-to-toe bone points a little below it.
    const down = a.clone().addScaledVector(sole, -a.dot(sole));
    if (down.lengthSq() < 1e-6) down.set(0, -1, 0);
    down.normalize();
    aimTo(rig.spec[sd + 'Foot'], sole.multiplyScalar(Math.cos(rig.footTilt)).addScaledVector(down, Math.sin(rig.footTilt)));
  }
  // Two-bone leg: the hip, a target for the ankle and the direction the knee should point.
  function legTo(rig, sd, F, pole, turn) {
    const th = rig.spec[sd + 'UpperLeg'], R = wp(th.bone);
    const L1 = rig.len.thigh, L2 = rig.len.shin; // already in scene units
    const D = F.clone().sub(R), u = D.clone().normalize();
    const d = Math.max(Math.abs(L1 - L2) + 0.5, Math.min((L1 + L2) * 0.999, D.length()));
    const x = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const K = R.clone().addScaledVector(u, x).addScaledVector(p, h);
    aimHip(th, K.clone().sub(R), rig.leftW);
    twistTo(rig, th, p, turn || Math.PI / 2);  // kneecap faces the way the knee bends (hip turns out further when seated)
    aimTo(rig.spec[sd + 'LowerLeg'], R.addScaledVector(u, d).sub(K));
  }
  // Two-bone arm: reaches for the diagram's hand position with the elbow on the diagram's side,
  // never folding tighter than a real elbow can.
  function armTo(rig, sd, hint, W, fallback) {
    const upS = rig.spec[sd + 'UpperArm'], lo = rig.spec[sd + 'LowerArm'], A = wp(upS.bone);
    const L1 = rig.len.upper, L2 = rig.len.fore, D = W.clone().sub(A), u = D.clone().normalize();
    const d = Math.max((L1 + L2) * 0.5, Math.min((L1 + L2) * 0.999, D.length()));
    const x = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    let p = hint.clone().addScaledVector(u, -hint.dot(u));
    if (p.lengthSq() < 1) p = fallback.clone().addScaledVector(u, -fallback.dot(u));
    p.normalize();
    let E = A.clone().addScaledVector(u, x).addScaledVector(p, h);
    const E2 = A.clone().addScaledVector(u, x).addScaledVector(p, -h);
    if (E.y < 4 && E2.y > E.y) { E = E2; p.negate(); } // an elbow never pushes into the floor
    aimTo(upS, E.clone().sub(A));
    twistTo(rig, upS, p.clone().negate());      // the inside of the elbow faces the way the forearm folds
    aimTo(lo, A.addScaledVector(u, d).sub(wp(lo.bone)));
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
    const pelvisFront = f2.clone();
    rig.leftW = left;
    [2, 1].forEach(i => {
      const sd = front ? (i === 1 ? 'L' : 'R') : (i === 1 ? 'R' : 'L'), g = k => V(q[k + i]);
      const out = sd === 'L' ? left.clone() : left.clone().negate();
      const fold = folds[i - 1], th = rig.spec[sd + 'UpperLeg'];
      if (fold) {
        const lift = Math.max(-0.9, Math.min(0.85, (V(q['kh' + i] || q['k' + i]).y - g('r').y) / 24));
        const tDir = flat(fold, lift), sDir = flat(fold - 100, q.flatShin ? 0 : i === 1 && folds[1] ? -Math.min(0.95, lift + 0.4) : -lift); // the top foot rests on the lower one
        aimHip(th, tDir, left);
        twistTo(rig, th, sDir.clone().negate(), Math.PI / 2);
        aimTo(rig.spec[sd + 'LowerLeg'], sDir);
        setFoot(rig, sd, flat(fold - 20, 0));
      } else if (q.seat && (q.seat !== 'figure4' || i === 1)) {
        // Built in 3D: 'butterfly' soles together with knees out, 'cross' cross-legged,
        // 'figure4' this ankle resting on the other knee (leg 2 is solved first).
        const hipC = P3.clone(), floorY = avatar.ankle * 0.7;
        let F, pole;
        if (q.seat === 'butterfly') {
          F = hipC.clone().addScaledVector(fwd, 17).addScaledVector(out, 2.5); F.y = floorY + 1;
          const kneeUp = Math.max(0, Math.min(1, (g('r').y - V(q['kh' + i] || q['k' + i]).y) / -12 + 0.2));
          pole = out.clone().multiplyScalar(1).addScaledVector(up, 0.15 + kneeUp * 0.6);
        } else if (q.seat === 'cross') {
          F = hipC.clone().addScaledVector(fwd, 13).addScaledVector(out, -9); F.y = floorY + (i === 1 ? 5 : 1);
          pole = out.clone().addScaledVector(up, 0.25).addScaledVector(fwd, 0.4);
        } else {
          F = rig.kneeOther.clone().add(new T.Vector3(0, 3.5, 0));
          pole = out.clone().addScaledVector(up, 0.6).addScaledVector(fwd, 0.4);
        }
        legTo(rig, sd, F, pole, Math.PI * 0.85);
        setFoot(rig, sd, fwd.clone().addScaledVector(out, q.seat === 'figure4' ? -0.4 : -0.3));
      } else if (q.sz) { // shins pointing straight behind her (knees bent, feet back)
        const sDir = new T.Vector3(0, 0, q.sz);
        aimHip(th, g('k').sub(g('r')), left);
        twistTo(rig, th, sDir.clone().negate(), Math.PI / 2);
        aimTo(rig.spec[sd + 'LowerLeg'], sDir);
        setFoot(rig, sd, g('k').sub(g('r')).normalize().multiplyScalar(-0.3).add(sDir));
      } else {
        const F = g('f');
        F.y = up.y > 0.5 ? F.y + avatar.ankle : Math.max(F.y, 4); // standing: the diagram foot is the sole; lying or kneeling: it is the ankle
        // Where the kneecap faces if the hip isn't rotated: the pelvis front, swung with the thigh.
        const tHint = g('k').sub(g('r')).normalize();
        const flex = Math.atan2(tHint.dot(pelvisFront), -tHint.dot(up)); // 0 standing, 90° thigh forward
        const kneeFront = up.clone().multiplyScalar(Math.sin(flex)).addScaledVector(pelvisFront, Math.cos(flex));
        // The diagram's knee is used when it bends the natural way; knees never cave inwards in front views.
        const R = wp(th.bone), u = F.clone().sub(R).normalize();
        const hint = g('k').sub(g('r').add(g('f')).multiplyScalar(0.5));
        if (front && hint.dot(out) < 0) hint.addScaledVector(out, -hint.dot(out));
        hint.addScaledVector(u, -hint.dot(u));
        const kf = kneeFront.clone().addScaledVector(u, -kneeFront.dot(u)).normalize();
        const pole = hint.lengthSq() > 1 && hint.clone().normalize().dot(kf) > -0.3 ? hint.normalize().addScaledVector(kf, 0.5) : kf;
        const k2 = g('k'), a2 = g('r').sub(k2).normalize(), b2 = g('f').sub(k2).normalize();
        if (a2.dot(b2) < -0.96) { const D = F.clone().sub(R); if (D.length() < (rig.len.thigh + rig.len.shin) * 0.9985) F.copy(R).addScaledVector(D.normalize(), (rig.len.thigh + rig.len.shin) * 0.9985); }
        if (q['k' + i][1] >= 123 && (q.tb || up.y > 0.3)) {
          // Kneeling (facing the floor or upright, never lying on the back): the knee rests on the floor, the thigh keeps its length, the shin runs to the foot.
          const K0 = g('k').addScaledVector(out, q.kw || 0), kneeY = 3.5, dyK = kneeY - R.y; // kw: knees apart (room for the bump)
          const hz = K0.clone().sub(R); hz.y = 0;
          let K;
          if (Math.abs(dyK) < rig.len.thigh && hz.lengthSq() > 1e-6) K = R.clone().addScaledVector(hz.normalize(), Math.sqrt(rig.len.thigh ** 2 - dyK * dyK)).add(new T.Vector3(0, dyK, 0));
          else K = R.clone().addScaledVector(K0.clone().sub(R).normalize(), rig.len.thigh);
          aimHip(th, K.clone().sub(R), rig.leftW);
          twistTo(rig, th, K.clone().sub(R.clone().add(F).multiplyScalar(0.5)), Math.PI / 2);
          aimTo(rig.spec[sd + 'LowerLeg'], F.clone().sub(wp(rig.spec[sd + 'LowerLeg'].bone)));
        } else legTo(rig, sd, F, pole);
        const sole = front ? kf.clone().addScaledVector(up, -0.2) : g('t').sub(g('f'));
        if (q['f' + i][1] >= 123 && up.y > 0.6) { sole.y = 0; if (sole.lengthSq() < 1e-4) sole.copy(fwd); } // standing: sole flat on the floor
        setFoot(rig, sd, sole);
      }
      const aHint = g('e').sub(g('a').add(g('w')).multiplyScalar(0.5));
      const handAt = q['w' + i][1] >= 122 ? g('w').add(new T.Vector3(0, 3.5, 0)) : g('w'); // a palm's thickness above the floor
      armTo(rig, sd, aHint, handAt, out.clone().multiplyScalar(0.5).addScaledVector(up, -0.6).addScaledVector(fwd, -0.3));
      if (q['w' + i][1] >= 122) { // hand on the floor: palm flat, fingers forward
        const lo = rig.spec[sd + 'LowerArm'], fa = wp(lo.child).sub(wp(lo.bone)); fa.y = 0;
        aimTo(rig.spec[sd + 'Hand'], fa.lengthSq() > 1e-4 ? fa : fwd.clone().setY(0));
      }
      if (i === 2) rig.kneeOther = wp(rig.spec[sd + 'LowerLeg'].bone);
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
    const clip = def.clip && clips[def.clip];
    const fig = { canvas, ctx:canvas.getContext('2d'), scene, cam, rig, extra, pregnant, frames:clip ? [] : def.frames.map(f => fitFrame(rig, resolvePose(f))), snaps:{} };
    if (clip) {
      fig.clip = clip;
      fig.yawQ = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (def.yaw == null ? 90 : def.yaw) * Math.PI / 180); // she faces +x like the other diagrams
      fig.clipOrigin = { x:clip.p[0], z:clip.p[2] };
    }
    fig.duration = clip ? clip.frames / clip.fps * 1000 : fig.frames.length * SEG;
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
    // Nothing may sink below the floor: find the lowest point of the body over the move and lift it clear.
    fig.lift = 0;
    if (def.prop !== 'water') {
      let minY = fig.clip ? Infinity : 0; const v = new T.Vector3(), skins = []; // clips are also brought down onto the floor
      rig.root.traverse(o => { if (o.isSkinnedMesh && o.visible && /SKIN|Tops|Shoes/.test(o.material.name)) skins.push(o); });
      for (let ms = 0; ms < fig.duration; ms += 130) {
        poseTime(fig, ms); rig.root.updateMatrixWorld(true);
        skins.forEach(m => { const n = m.geometry.attributes.position.count; for (let k = 0; k < n; k += 7) { m.getVertexPosition(k, v); v.applyMatrix4(m.matrixWorld); if (v.y < minY) minY = v.y; } });
      }
      fig.lift = -minY;
    }
    for (let ms = 0; ms < fig.duration; ms += 100) { poseTime(fig, ms); fitAll(); }
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

  // Weights, band and baby follow her actual hands and feet.
  function placeExtras(fig, front) {
    const x = fig.extra, get = fig.rig.get, s1 = front ? 'L' : 'R', s2 = front ? 'R' : 'L';
    const at = n => get(B(n)).getWorldPosition(new T.Vector3());
    const hand = sd => at(sd + '_Hand').lerp(at(sd + '_Middle1'), 0.6);
    const across = new T.Vector3(0, 0, 5);
    if (x.wt1) { const h = hand(s1); span(x.wt1, h.clone().sub(across), h.clone().add(across), 12.6); }
    if (x.wt2) { const h = hand(s2); span(x.wt2, h.clone().sub(across), h.clone().add(across), 12.6); }
    if (x.band) span(x.band, hand(s1), at(s1 + '_ToeBase'), 11.4);
    if (x.babyBody) {
      const m = hand(s1).add(hand(s2)).multiplyScalar(0.5);
      x.babyBody.position.copy(m).add(new T.Vector3(0, 4, 0)); x.babyBody.rotation.set(0, 0, Math.PI / 2);
      x.babyHead.position.copy(m).add(new T.Vector3(9, 6, 0));
    }
  }

  // The diagrams were drawn with longer limbs than the model has. Before playing, each keyframe is
  // fitted to her real proportions: the body slides, lowers or tilts a little so every hand, knee and
  // foot the diagram puts on the floor really reaches it (2D units equal scene units).
  function fitFrame(rig, q) {
    if (q.fold || q.seat) return q;
    const L = rig.len, reachLeg = (L.thigh + L.shin) * 0.985, reachArm = (L.upper + L.fore) * 0.97;
    const ankle = avatar.ankle, C = [], upright = (q.s[1] - q.p[1]) / (Math.hypot(q.s[0] - q.p[0], q.s[1] - q.p[1]) || 1) < -0.5;
    const straight = i => { const k = q['k' + i], a = [q.p[0] - k[0], q.p[1] - k[1]], b = [q['f' + i][0] - k[0], q['f' + i][1] - k[1]]; return (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1) < -0.96; };
    [1, 2].forEach(i => {
      if (q['f' + i][1] >= 123) C.push({ k:'leg', at:[q['f' + i][0], upright ? q['f' + i][1] - ankle : Math.min(q['f' + i][1], 122)], r:reachLeg, exact:upright && straight(i) });
      if (q['k' + i][1] >= 123 && !q.sz && (q.tb || upright)) C.push({ k:'leg', at:[q['k' + i][0], q['k' + i][1] - 3], r:L.thigh });
      if (q['w' + i][1] >= 122) C.push({ k:'arm', at:[q['w' + i][0], q['w' + i][1] - 2], r:reachArm });
    });
    if (!C.length) return q;
    const ux = q.s[0] - q.p[0], uy = q.s[1] - q.p[1], ul = Math.hypot(ux, uy) || 1;
    const hd = [q.h[0] - q.s[0], q.h[1] - q.s[1]], hl = Math.hypot(hd[0], hd[1]) || 1;
    const floorMin = (y0, clear) => Math.max(y0, 126 - clear);
    let best = null;
    for (let th = -20; th <= 20; th += 2.5) {
      const c = Math.cos(th * Math.PI / 180), sn = Math.sin(th * Math.PI / 180);
      const dx0 = (ux * c - uy * sn) / ul, dy0 = (ux * sn + uy * c) / ul;
      for (let dy = -16; dy <= 8; dy += 0.5) for (let dx = -12; dx <= 12; dx += 1) {
        const px = q.p[0] + dx, py = q.p[1] + dy;
        const hip = [px - dx0 * L.hipDrop, py - dy0 * L.hipDrop], sh = [px + dx0 * L.torso, py + dy0 * L.torso];
        const hx = sh[0] + dx0 * hl * 0.6, hy = sh[1] + dy0 * hl * 0.6;
        let cost = 0.05 * (dx * dx + dy * dy) + 0.01 * th * th;
        for (const k of C) { const o = k.k === 'arm' ? sh : hip, dd = Math.hypot(o[0] - k.at[0], o[1] - k.at[1]) - k.r; cost += k.exact ? 4 * Math.abs(dd) : 10 * Math.max(0, dd); }
        cost += 10 * (Math.max(0, py - floorMin(q.p[1], 6)) + Math.max(0, sh[1] - floorMin(q.s[1], 6)) + Math.max(0, hy - floorMin(q.h[1], 7)));
        if (q.tb) cost += 10 * Math.max(0, (py + sh[1]) / 2 - floorMin((q.p[1] + q.s[1]) / 2, rig.pregnant ? 17 : 12)); // belly clears the floor
        if (!best || cost < best.cost) best = { cost, dx, dy, c, sn };
      }
    }
    const { dx, dy, c, sn } = best, o = Object.assign({}, q);
    const rot = pt => { const x = pt[0] - q.p[0], y = pt[1] - q.p[1]; return [q.p[0] + dx + x * c - y * sn, q.p[1] + dy + x * sn + y * c]; };
    const move = pt => [pt[0] + dx, pt[1] + dy];
    o.p = move(q.p); o.s = rot(q.s); o.h = rot(q.h);
    [1, 2].forEach(i => {
      const handDown = q['w' + i][1] >= 122, footDown = q['f' + i][1] >= 123, kneeDown = q['k' + i][1] >= 123 && !q.sz && (q.tb || upright);
      o['e' + i] = rot(q['e' + i]);
      if (!handDown) o['w' + i] = rot(q['w' + i]);
      if (!kneeDown) o['k' + i] = move(q['k' + i]);
      if (!footDown) { o['f' + i] = move(q['f' + i]); o['t' + i] = move(q['t' + i]); }
    });
    return o;
  }

  // ── Motion-capture clips (Mixamo, converted by the bake script) ───────────
  const clips = {};
  function loadClips(names, done) {
    const todo = [...new Set(names)].filter(n => n && !(n in clips)); // a clip that failed is remembered as null (keyframes play instead)
    if (!todo.length) { done(); return; }
    let left = todo.length;
    todo.forEach(n => fetch('content/mocap/' + n + '.json?v=1').then(r => r.json()).then(j => {
      const raw = Uint8Array.from(atob(j.q), c => c.charCodeAt(0));
      const iq = new Int16Array(raw.buffer), nb = j.bones.length;
      j.world = []; // per frame, per bone: source world rotation
      for (let f = 0; f < j.frames; f++) j.world.push(j.bones.map((b, i) => new T.Quaternion(iq[(f * nb + i) * 4] / 32767, iq[(f * nb + i) * 4 + 1] / 32767, iq[(f * nb + i) * 4 + 2] / 32767, iq[(f * nb + i) * 4 + 3] / 32767).normalize()));
      j.restInv = j.rest.map(r => new T.Quaternion(...r).invert());
      const depth = n => ['C_Hips','C_Spine','C_Chest','C_UpperChest'].indexOf(n) + 1 || (/Neck|Shoulder|UpperLeg/.test(n) ? 5 : /Head|UpperArm|LowerLeg/.test(n) ? 6 : /LowerArm|Foot/.test(n) ? 7 : 8);
      j.order = j.bones.map((b, i) => i).sort((a, b) => depth(j.bones[a]) - depth(j.bones[b])); // parents before children
      clips[n] = j;
    }).catch(() => { clips[n] = null; }).finally(() => { if (--left === 0) done(); }));
  }
  // Retargets the clip onto the avatar: each bone takes the source bone's rotation away from
  // its own rest pose, so any rig in T-pose maps cleanly; the hips follow the source, scaled to her height.
  function poseClip(fig, ms) {
    const c = fig.clip, rig = fig.rig, dur = c.frames / c.fps * 1000;
    const tf = ((ms % dur) / 1000) * c.fps, f0 = Math.floor(tf) % c.frames, f1 = (f0 + 1) % c.frames, t = tf - Math.floor(tf);
    rig.bones.forEach(b => b.quaternion.copy(rig.rest.get(b)));
    rig.root.position.set(0, 0, 0); rig.root.quaternion.identity(); rig.root.updateMatrixWorld(true);
    const Y = fig.yawQ, q = new T.Quaternion();
    c.order.forEach(i => {
      const bn = c.bones[i], bone = rig.get(B(bn)); if (!bone) return;
      q.slerpQuaternions(c.world[f0][i], c.world[f1][i], t).multiply(c.restInv[i]);   // source delta from rest
      const tw = Y.clone().multiply(q).multiply(rig.restWorld.get(bone.name)); // her rest pose, moved like the source, then turned to face the camera side
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(tw));
      bone.updateMatrixWorld(true);
    });
    const s = rig.hipsRestY / c.legRef, P = new T.Vector3(
      c.p[f0 * 3] + (c.p[f1 * 3] - c.p[f0 * 3]) * t, c.p[f0 * 3 + 1] + (c.p[f1 * 3 + 1] - c.p[f0 * 3 + 1]) * t, c.p[f0 * 3 + 2] + (c.p[f1 * 3 + 2] - c.p[f0 * 3 + 2]) * t);
    P.sub(new T.Vector3(fig.clipOrigin.x, 0, fig.clipOrigin.z)).multiplyScalar(s).applyQuaternion(Y);
    rig.root.position.add(P.sub(rig.hips.getWorldPosition(new T.Vector3())));
    rig.root.updateMatrixWorld(true);
    rig.aims.forEach(a => aimTo(a, a.child.getWorldPosition(new T.Vector3()).sub(a.bone.getWorldPosition(new T.Vector3()))));
    fig.lastFront = false; placeExtras(fig, false); fig.extra.ring.visible = false;
  }

  // Plays the move at time ms. Between keyframes seen from different angles (e.g. rolling from the
  // back onto the side) the joints turn smoothly from one solved pose to the next instead of blending drawings.
  const SEG = 1300, MOVE = 1000;
  function poseTime(fig, ms) {
    if (fig.clip) poseClip(fig, ms); else poseTimeRaw(fig, ms);
    if (fig.lift) { fig.rig.root.position.y += fig.lift; fig.rig.root.updateMatrixWorld(true); placeExtras(fig, fig.lastFront); if (fig.extra.ring.visible) fig.extra.ring.position.y += fig.lift; }
  }
  function poseTimeRaw(fig, ms) {
    if (!fig.frames.length) return;
    const fr = fig.frames, n = fr.length;
    ms = Math.max(0, ms);
    const step = Math.floor(ms / SEG), local = Math.min(1, (ms % SEG) / MOVE);
    const e = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2;
    const i = step % n, j = (step + 1) % n, a = fr[i], b = fr[j];
    if (a.view === b.view && String(a.fold) === String(b.fold) && a.sz === b.sz && a.seat === b.seat) { pose(fig, lerpPose(a, b, e)); return; }
    const snap = k => {
      if (!fig.snaps[k]) { pose(fig, fr[k]); fig.snaps[k] = { q:fig.rig.bones.map(bn => bn.quaternion.clone()), p:fig.rig.root.position.clone(), front:fr[k].view === 'front' }; }
      return fig.snaps[k];
    };
    const A = snap(i), Bs = snap(j);
    fig.rig.bones.forEach((bn, k) => bn.quaternion.slerpQuaternions(A.q[k], Bs.q[k], e));
    fig.rig.root.position.lerpVectors(A.p, Bs.p, e);
    fig.rig.root.updateMatrixWorld(true);
    fig.lastFront = e < 0.5 ? A.front : Bs.front;
    placeExtras(fig, fig.lastFront);
    fig.extra.ring.visible = false;
  }

  function pose(fig, raw) {
    const q = rigidPose(raw), front = q.view === 'front', x = fig.extra;
    const P = V(q.p), S = V(q.s), H = V(q.h);
    const v2x = q.s[0] - q.p[0], v2y = q.s[1] - q.p[1], l2 = Math.hypot(v2x, v2y) || 1, n2 = [-v2y / l2, v2x / l2];
    const fwd = front ? new T.Vector3(0, 0, 1) : new T.Vector3(n2[0], -n2[1], 0);
    const up = new T.Vector3().subVectors(S, P).normalize();
    const mid = V([(q.p[0] + q.s[0]) / 2 + n2[0] * q.c, (q.p[1] + q.s[1]) / 2 + n2[1] * q.c]);
    poseRig(fig.rig, q, P, S, H, mid, up, fwd, front);
    placeExtras(fig, front); fig.lastFront = front;
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

  return { supported, loadAvatar, loadClips, create, pose, poseTime, render, dispose };
})();

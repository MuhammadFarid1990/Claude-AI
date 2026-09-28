// Converts a motion-capture recording (Mixamo .fbx or CMU .bvh) into a compact motion file
// for Bloom's avatar: each mapped bone's world rotation per frame plus the source rest pose,
// so the app can retarget it onto the VRM avatar at load time (content/figure3d.js, poseClip).
//
// Usage:
//   node tools/bake-mocap.mjs <file.fbx|file.bvh> <move-key> [--start s] [--end s] [--fps 20] [--blend 0.4] [--travel]
//   --start/--end  seconds to keep (a single exercise out of a longer recording)
//   --blend        seconds cross-faded from the end into the start, so the clip loops without a jump
//   --travel       keep the walk forward (default: in place, like a treadmill)
//   --free-turn    keep the performer's turning (default: she keeps facing forward throughout)
// Writes content/mocap/<move-key>.json; then add clip:'<move-key>' to that move in content/anim.js.
import fs from 'fs';
globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }), createElement: () => ({ getContext: () => null, style: {} }) };
const THREE = await import('three');

const args = process.argv.slice(2), opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { const k = args[i].slice(2); opt[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; }
  else pos.push(args[i]);
}
const [inFile, key] = pos;
if (!inFile || !key) { console.log('usage: node tools/bake-mocap.mjs <file> <move-key> [--start s] [--end s] [--fps 20] [--blend 0.4] [--travel]'); process.exit(1); }

const MIXAMO = { Hips:'C_Hips', Spine:'C_Spine', Spine1:'C_Chest', Spine2:'C_UpperChest', Neck:'C_Neck', Head:'C_Head',
  LeftShoulder:'L_Shoulder', LeftArm:'L_UpperArm', LeftForeArm:'L_LowerArm', LeftHand:'L_Hand',
  RightShoulder:'R_Shoulder', RightArm:'R_UpperArm', RightForeArm:'R_LowerArm', RightHand:'R_Hand',
  LeftUpLeg:'L_UpperLeg', LeftLeg:'L_LowerLeg', LeftFoot:'L_Foot', LeftToeBase:'L_ToeBase',
  RightUpLeg:'R_UpperLeg', RightLeg:'R_LowerLeg', RightFoot:'R_Foot', RightToeBase:'R_ToeBase' };
const CMU = Object.assign({}, MIXAMO, { LowerBack:'C_Spine', Spine:'C_Chest', Spine1:'C_UpperChest' });
delete CMU.Spine2;

let root, clip, restAt = null;
if (/\.bvh$/i.test(inFile)) {
  const { BVHLoader } = await import('three/examples/jsm/loaders/BVHLoader.js');
  const r = new BVHLoader().parse(fs.readFileSync(inFile, 'utf8'));
  root = new THREE.Group(); root.add(r.skeleton.bones[0]); clip = r.clip;
  restAt = 0; // the CMU BVH release adds a T-pose as frame one
} else {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const buf = fs.readFileSync(inFile);
  root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  clip = root.animations[0];
}
const bones = {}; root.traverse(o => { const m = o.name.replace(/^mixamorig\d*:?/, ''); if (!bones[m]) bones[m] = o; });
const MAP = bones.LowerBack ? CMU : MIXAMO;
const names = Object.keys(MAP).filter(n => bones[n]);
const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
const at = t => { mixer.setTime(t); root.updateMatrixWorld(true); };

if (restAt !== null) at(restAt); else root.updateMatrixWorld(true);
// Reference pose: the recording's T-pose frame, straightened into a true T-pose (arms out along ±x,
// legs and spine vertical, hips square to +z), because recorded "T-poses" are rarely exact.
const wpos = nm => bones[nm].getWorldPosition(new THREE.Vector3());
const CHILD = { LowerBack:'Spine', Spine:bones.LowerBack ? 'Spine1' : 'Spine1', Spine1:bones.LowerBack ? 'Neck' : 'Spine2', Spine2:'Neck', Neck:bones.Neck1 ? 'Neck1' : 'Head',
  LeftShoulder:'LeftArm', LeftArm:'LeftForeArm', LeftForeArm:'LeftHand', RightShoulder:'RightArm', RightArm:'RightForeArm', RightForeArm:'RightHand',
  LeftUpLeg:'LeftLeg', LeftLeg:'LeftFoot', RightUpLeg:'RightLeg', RightLeg:'RightFoot' };
const CANON = nm => /^Left(Shoulder|Arm|ForeArm)/.test(nm) ? new THREE.Vector3(1, 0, 0) : /^Right(Shoulder|Arm|ForeArm)/.test(nm) ? new THREE.Vector3(-1, 0, 0)
  : /(UpLeg|Leg)$/.test(nm) ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
const hipX = wpos('LeftUpLeg').sub(wpos('RightUpLeg')); hipX.y = 0; hipX.normalize();
const squareHips = new THREE.Quaternion().setFromUnitVectors(hipX, new THREE.Vector3(1, 0, 0)); // removes any yaw of the T-pose
const rest = names.map(nm => {
  const q0 = bones[nm].getWorldQuaternion(new THREE.Quaternion());
  if (nm === 'Hips') return squareHips.clone().multiply(q0).toArray();
  const c = CHILD[nm];
  if (!c || !bones[c]) return squareHips.clone().multiply(q0).toArray();
  const d = wpos(c).sub(wpos(nm)).applyQuaternion(squareHips).normalize();
  return new THREE.Quaternion().setFromUnitVectors(d, CANON(nm)).multiply(squareHips).multiply(q0).toArray();
});
const wy = n => bones[n].getWorldPosition(new THREE.Vector3()).y;
const floorY = Math.min(wy(bones.LeftToeBase ? 'LeftToeBase' : 'LeftFoot'), wy(bones.RightToeBase ? 'RightToeBase' : 'RightFoot'));
const legRef = wy('Hips') - floorY;

const fps = +opt.fps || 20, start = +opt.start || (restAt !== null ? 1 / 120 : 0);
const blend = opt.blend === undefined ? 0.4 : +opt.blend;
const end = Math.min(clip.duration - blend - 1 / 60, +opt.end || clip.duration); // the blend tail must stay inside the recording (past its end the mixer wraps to the T-pose)
const n = Math.max(2, Math.round((end - start) * fps)), nb = Math.min(Math.round(blend * fps), Math.floor(n / 2));
const sample = t => { at(t); return { q:names.map(nm => bones[nm].getWorldQuaternion(new THREE.Quaternion())), p:bones.Hips.getWorldPosition(new THREE.Vector3()) }; };
const frames = []; for (let f = 0; f < n + nb; f++) frames.push(sample(start + f / fps));
if (!opt['free-turn']) { // face-lock: remove turning, so she faces the same way all through the clip
  const hipsI = names.indexOf('Hips'), restHips = new THREE.Quaternion(...rest[hipsI]);
  let prev = null, acc = 0;
  frames.forEach(fr => {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(fr.q[hipsI].clone().multiply(restHips.clone().invert()));
    let yaw = Math.atan2(fwd.x, fwd.z);
    if (prev !== null) { while (yaw - prev > Math.PI) yaw -= 2 * Math.PI; while (yaw - prev < -Math.PI) yaw += 2 * Math.PI; }
    prev = yaw; fr.yaw = yaw;
  });
  // smooth the heading so natural sway stays in, only the slow turning comes out
  const k = Math.max(1, Math.round(fps * 0.8));
  frames.forEach((fr, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - k); j <= Math.min(frames.length - 1, i + k); j++) { s += frames[j].yaw; c++; } fr.heading = s / c; });
  // hips path smoothed over the same window: in place, only the sway around it is kept (in her own frame)
  const smooth = frames.map((fr, i) => { const v = new THREE.Vector3(); let c = 0; for (let j = Math.max(0, i - k); j <= Math.min(frames.length - 1, i + k); j++) { v.add(frames[j].p); c++; } return v.divideScalar(c); });
  frames.forEach((fr, i) => {
    const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -fr.heading);
    fr.q = fr.q.map(w => R.clone().multiply(w));
    if (!opt.travel) { const y = fr.p.y; fr.p.sub(smooth[i]).applyQuaternion(R); fr.p.y = y; }
    else fr.p.applyQuaternion(R);
  });
}
if (!opt.travel) { // in place: remove the drift across the floor, keep the sway
  const p0 = frames[0].p.clone(), p1 = frames[frames.length - 1].p.clone();
  frames.forEach((f, i) => { const k = frames.length > 1 ? i / (frames.length - 1) : 0; f.p.x -= p0.x + (p1.x - p0.x) * k; f.p.z -= p0.z + (p1.z - p0.z) * k; });
  const mx = frames.reduce((s, f) => s + f.p.x, 0) / frames.length, mz = frames.reduce((s, f) => s + f.p.z, 0) / frames.length;
  frames.forEach(f => { f.p.x -= mx; f.p.z -= mz; });
}
// Cross-fade the tail into the head so the loop is seamless.
for (let i = 0; i < nb; i++) {
  const w = (i + 1) / (nb + 1), a = frames[n + i], b = frames[i];
  b.q = b.q.map((q, k) => a.q[k].clone().slerp(q, w));
  b.p = a.p.clone().lerp(b.p, w);
}
frames.length = n;
const q = new Int16Array(n * names.length * 4), p = new Float32Array(n * 3);
frames.forEach((fr, f) => {
  fr.q.forEach((w, i) => [w.x, w.y, w.z, w.w].forEach((v, k) => q[(f * names.length + i) * 4 + k] = Math.round(v * 32767)));
  p.set([fr.p.x, fr.p.y - floorY, fr.p.z], f * 3);
});
const out = { fps, frames:n, bones:names.map(nm => MAP[nm]), rest:rest.map(r => r.map(v => +v.toFixed(5))), legRef:+legRef.toFixed(3),
  source:inFile.split('/').pop(), q:Buffer.from(q.buffer).toString('base64'), p:Array.from(p, v => +v.toFixed(3)) };
fs.mkdirSync('content/mocap', { recursive:true });
fs.writeFileSync('content/mocap/' + key + '.json', JSON.stringify(out));
console.log(inFile, '→ content/mocap/' + key + '.json', n, 'frames', names.length, 'bones', (JSON.stringify(out).length / 1024).toFixed(1) + ' KB',
  'span', start.toFixed(2) + '–' + end.toFixed(2) + 's of', clip.duration.toFixed(2) + 's');

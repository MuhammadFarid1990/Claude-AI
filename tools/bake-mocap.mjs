// Converts a Mixamo FBX (animation) into a compact motion file for Bloom's avatar.
// Stores each mapped bone's rotation per frame (source skeleton), plus the source rest pose,
// so the app can retarget onto the VRM avatar at load time.
import fs from 'fs';
globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }), createElement: () => ({ getContext: () => null, style: {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
// Usage: node tools/bake-mocap.mjs mocap/<clip>.fbx <move-key> [fps=20] [max-seconds]
// Writes content/mocap/<move-key>.json; then add clip:'<move-key>' to that move in content/anim.js.
const [,, inFile, key, fpsArg, maxSecArg] = process.argv;
const outFile = 'content/mocap/' + key + '.json';
fs.mkdirSync('content/mocap', { recursive: true });
const MAP = { Hips:'C_Hips', Spine:'C_Spine', Spine1:'C_Chest', Spine2:'C_UpperChest', Neck:'C_Neck', Head:'C_Head',
  LeftShoulder:'L_Shoulder', LeftArm:'L_UpperArm', LeftForeArm:'L_LowerArm', LeftHand:'L_Hand',
  RightShoulder:'R_Shoulder', RightArm:'R_UpperArm', RightForeArm:'R_LowerArm', RightHand:'R_Hand',
  LeftUpLeg:'L_UpperLeg', LeftLeg:'L_LowerLeg', LeftFoot:'L_Foot', LeftToeBase:'L_ToeBase',
  RightUpLeg:'R_UpperLeg', RightLeg:'R_LowerLeg', RightFoot:'R_Foot', RightToeBase:'R_ToeBase' };
const buf = fs.readFileSync(inFile);
const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const clip = obj.animations[0];
const bones = {}; obj.traverse(o => { const m = o.name.replace(/^mixamorig\d*:?/, ''); if (MAP[m] && !bones[m]) bones[m] = o; });
const names = Object.keys(MAP).filter(n => bones[n]);
obj.updateMatrixWorld(true);
const rest = names.map(n => bones[n].getWorldQuaternion(new THREE.Quaternion()).toArray());
const hipsRest = bones.Hips.getWorldPosition(new THREE.Vector3());
const footRest = (bones.LeftFoot || bones.RightFoot).getWorldPosition(new THREE.Vector3());
const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play();
const fps = +fpsArg || 20, dur = Math.min(clip.duration, +maxSecArg || clip.duration), n = Math.max(2, Math.round(dur * fps));
const q = new Int16Array(n * names.length * 4), p = new Float32Array(n * 3);
for (let f = 0; f < n; f++) {
  mixer.setTime(f / fps); obj.updateMatrixWorld(true);
  names.forEach((nm, i) => { const w = bones[nm].getWorldQuaternion(new THREE.Quaternion()); [w.x, w.y, w.z, w.w].forEach((v, k) => q[(f * names.length + i) * 4 + k] = Math.round(v * 32767)); });
  const hp = bones.Hips.getWorldPosition(new THREE.Vector3()); p.set([hp.x, hp.y, hp.z], f * 3);
}
const out = { fps, frames:n, bones:names.map(n => MAP[n]), rest, hipsRestY:hipsRest.y - footRest.y + 0, legRef:hipsRest.y,
  q:Buffer.from(q.buffer).toString('base64'), p:Array.from(p, v => +v.toFixed(2)) };
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(inFile, '→', outFile, n, 'frames', names.length, 'bones', (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB', 'duration', clip.duration.toFixed(2) + 's', 'hipsY', hipsRest.y.toFixed(1));

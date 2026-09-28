# Motion-capture clips

Drop Mixamo animation files (`.fbx`) here, then convert each one for the app:

    npm install
    npm run mocap -- "mocap/Air Squat.fbx" squat

That writes `content/mocap/squat.json`. Add `clip:'squat'` to the `squat` entry in
`content/anim.js`, and the exercise diagram plays the recording on Bloom's avatar
(keyframes remain the fallback). Mixamo download settings: Format **FBX Binary**,
Skin **Without Skin**, Frames per second **30**, and **In Place** ticked when offered.

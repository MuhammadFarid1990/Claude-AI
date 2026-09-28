# Motion-capture clips

Drop Mixamo animation files (`.fbx`) here, then convert each one for the app:

    npm install
    npm run mocap -- "mocap/Air Squat.fbx" squat

That writes `content/mocap/squat.json`. Add `clip:'squat'` to the `squat` entry in
`content/anim.js`, and the exercise diagram plays the recording on Bloom's avatar
(keyframes remain the fallback). Mixamo download settings: Format **FBX Binary**,
Skin **Without Skin**, Frames per second **30**, and **In Place** ticked when offered.

## Recordings in use

`content/mocap/walk.json`, `march.json` and `neck.json` come from subject 111 (a pregnant
woman) of the CMU Graphics Lab Motion Capture Database; `sidereach.json` (14_06) and
`squat.json` (13_29) come from the same database. Converted from the BVH release
(github.com/una-dinosauria/cmu-mocap) with, for example:

    npm run mocap -- 111_34.bvh walk --start 1 --end 13 --blend 0.5 --fps 24

The CMU data is free for research and commercial use. Requested acknowledgement:
"The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217."

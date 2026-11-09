# HAYATE · 疾風 — production brief

A 58-second, 24 fps, 1920×1080 anime short (23 shots, 1392 frames), wordless, rendered in the browser with three.js, every sound
synthesized. No video or image models, no samples. Series: "Fable 5.5 Anime Lab".

## Look
It must look like hand-drawn 2D theatrical anime action, not 3D. A neon night city after rain: pink, cyan and amber signs in
made-up katakana (no Latin, no real brands), wet asphalt mirroring everything, deep blue-violet shadows, never murk (mean luma
80-100). Cel + ink + gouache. Speed is the whole film: long lens streaks, hard parallax, speed lines, smear shapes, impact frames
(1-2 frame high-contrast black / white / red graphic flashes, luma ramped so no strobing), violent camera shake on ones. Clawd on
twos, FX on threes where drawn, camera on ones. Never floaty.

## Hero and props
- **Clawd**: the mascot (`src/clawd`), terracotta hue 13-18, cel + ink. An open-face red courier helmet with a little visor. He sits
  on the seat, both nubs on the handlebars, feet on the pegs. He leans into every corner. All acting is in the face.
- **The bike**: a small chunky red delivery motorbike, drawn with detail (fork, exhaust, chain, single round headlight, a long red
  tail light that streaks). A square red delivery box on the rack with 疾風 lettered on it.
- **The ramen**: one bowl sealed into the box, steam, perfect at the end.
- **The drones**: a swarm of small round white traffic-enforcement drones with one red camera eye, four ducted fans, a tiny
  blinking siren. Dangerous in numbers, cute alone.
- **The customer**: the little tree frog from our film Ame (a cameo), rebuilt with a real face rig: big eyes, cheeks, a throat, a tongue.
- **The city**: elevated expressways, truck traffic with no visible drivers, shopping arcades with paper lanterns, steel shutters.
  No people anywhere.

## Shots (seconds; frame = round(t*24))
| id | time | what happens |
|---|---|---|
| s01 | 0.0–3.0 | high over the wet neon city, diving down between the towers |
| s02 | 3.0–5.0 | a kitchen hatch: a steaming bowl of ramen is sealed into the red box |
| s03 | 5.0–7.5 | Clawd straps on the box, drops his visor, kicks the engine alive, headlight blooms |
| s04 | 7.5–9.5 | he was parked on a red line: a single small drone scans his plate, its eye turns red, the siren blinks |
| s05 | 9.5–11.0 | LAUNCH: throttle, the back wheel smokes, he is gone, a red streak |
| s06 | 11.0–14.0 | long avenue at full speed, tail light streaking, neon pouring down the wet road |
| s07 | 14.0–16.0 | looking back: hundreds of drones pour out of the alleys, red eyes in the dark |
| s08 | 16.0–18.5 | a full power slide around a corner, bike nearly flat, sparks from the footpeg |
| s09 | 18.5–21.0 | threading between huge trucks in the rain, mirrors missing him by inches |
| s10 | 21.0–23.0 | drones form a wall ahead; CU Clawd under the visor, determined |
| s11 | 23.0–25.5 | he takes the ramp of a car-carrier truck flat out |
| s12 | 25.5–28.0 | THE JUMP: slow motion across the gap between two expressways, the whole city below, the box lid rattling |
| s13 | 28.0–29.5 | landing: forks compress to the stops, an impact frame, sparks |
| s14 | 29.5–32.0 | expressway: drones fire capture nets, he weaves, one net wraps a sign |
| s15 | 32.0–34.0 | tunnel: strobing light bands race across his face and the wet walls |
| s16 | 34.0–37.0 | out of the tunnel the wrong way into a covered arcade, lanterns flying past, drones smashing into signs |
| s17 | 37.0–39.5 | down a long stone staircase, the bike hammering step by step |
| s18 | 39.5–42.0 | a steel shutter is rolling down at the end; he lays the bike flat and slides under; drones slam into it behind him, an impact frame |
| s19 | 42.0–43.6 | sudden quiet in a painted nook: he rolls in, stops exactly on the chalk mark, the engine ticks, he holds his breath |
| s20 | 43.6–46.4 | the noren parts, the frog peeks out, eyes huge, hops up onto the box and sniffs; he flips the lid, steam blooms on both faces, the bowl rises on its tray, the ramen is perfect |
| s21 | 46.4–49.0 | the tongue snaps out, pulls one long noodle in a whipping slurp, cheeks balloon, it melts with joy; Clawd lifts his visor, proud; the frog flicks a coin that lands on his helmet with a ting |
| s22 | 49.0–55.0 | one last tiny drone sinks down through the rain, its eye goes red, it presses a parking ticket on his helmet; he deflates, a long held beat; the frog's tongue snatches the ticket and swallows it, a small burp; the drone's eye goes wide and it flees; they look at each other and laugh |
| s23 | 55.0–58.0 | end card: "Fable 5.5" brush lettering, red 寓話 seal, title HAYATE 疾風 |

CUES: seal-box 3.6, kick 6.4, scan 8.1, launch 9.8, swarm 14.2, slide 16.3, wall 21.2, ramp 24.6, takeoff 25.5, land 28.0, nets 30.0,
tunnel 32.0, arcade 34.0, stairs 37.0, shutter 40.8, slam 41.3, quiet 42.0, stop 42.95, peek 44.0, hop 44.62, perch 45.02, open 45.55, tongue 46.62,
slurp 46.86, gulp 47.78, joy 47.9, visor 48.0, coin 48.35, ting 48.72, drone 49.4, red 50.05, ticket 50.4, deflate 50.55, thwip 52.45, snatch 52.62,
swallow 52.95, burp 53.2, yelp 53.35, flee 53.55, laugh 54.05, card 55.0.

## The nook (s19-s22)
The one warm place in the film: a tiny noodle-delivery hatch in an old wall with a noren curtain, a paper lantern, a wooden frame and ledge, potted plants, posters and
stickers in made-up katakana, a drainpipe, a tin awning dripping in warm light, painted brick and plaster with stains and gouache texture, a warm pool of lamp light
on wet asphalt against cool neon. The wall is one painted plate; everything with depth is a prop in front of it (`src/nook.js`). Steam is drawn: curling cel plumes on
threes with a bold outline, cumulus puffs that bloom past both faces and clear. The ramen is drawn with love: broth, a noodle nest, egg, nori, chashu, narutomaki, menma, scallions.

## Sound (synthesized)
Driving original track: synth bass, taiko and gritty lead at about 160 bpm from the launch, built on one short hook. The engine is a pitched
synth following the speed curve; gear shifts, tyre squeals, wind, whooshes on every pass, drones as a swarm of buzzing pitches, net shots,
truck horns with Doppler, tunnel reverb. Dead silence for one beat at the top of the jump, then the music slams back on the landing.
After the shutter: dripping on a tin awning, soft rain, the engine ticking and cooling, a far muffled city. A tiny lo-fi koto + rhodes melody blooms as the lid opens; ceramic clink,
steam hiss, a long comic slurp with rising pitch, a happy croak melody, coin ting, the ticket's sticky peta, a sad falling synth as he deflates, tongue thwip, gulp, a tiny burp
croak, a little drone yelp, a warm final cadence that lands on their laugh. -14 LUFS, true peak <= -1.5 dBTP.

## Gates
Clawd's nubs on the bars and feet on the pegs in every riding shot, wheels on the road. Nothing clips: a collision tool poses every second frame and tests every prop vertex
(bars, box, visor, ramen, frog, tongue, noodle, coin, ticket, drone) against Clawd's body, nubs and legs, 0 hits. Clawd's hue 13-18, face readable and large in his close shots. Luma jumps <= 25 per frame except ramped impact frames. Pure function of t.
Full-resolution frames inspected, every shot.

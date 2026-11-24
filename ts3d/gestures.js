// Gestures: what an avatar's body does for each quick reaction (and the pray / cheer / throw poses). No three.js here, so
// the table and its timing are testable in Node; ts3d/avatars.js poses the bones (holdPose) and plays the clips.
//
// A gesture is either a Mixamo clip from the model (clip), a procedural pose laid over the current clip every frame
// (pose), or both (a clip for the legs and a pose for the arms). The model has only the ten clips Idle, Walking, Running,
// Dance, Sitting, Wave, Jump, ThumbsUp, Yes and No; everything else is a pose.
//   ms      how long the gesture lasts, then the avatar is back in its base state (idle, walk, sit...)
//   clip    a clip to play once (reps: that many times, rate: time scale); dance: the Dance loop as the base state
//   pose    the pose's weight rises over fadeIn s and falls over the last fadeOut s, so it blends in and out of the clip
//   keep    moving does not cancel it (the pouch throw); every other gesture stops when the avatar starts to move
//   prop    a small thing held in a hand while it plays (ts3d/avatars.js PROPS)
export const CLIPS = Object.freeze(['Idle', 'Walking', 'Running', 'Dance', 'Sitting', 'Wave', 'Jump', 'ThumbsUp', 'Yes', 'No']);

export const GESTURES = Object.freeze({
  // the dock emotes (EMOTES 1 and 3) and the pouch throw
  Pray: { pose: true, ms: 2400 },
  Cheer: { pose: true, ms: 2400 },
  Throw: { pose: true, ms: 700, fadeIn: 0.06, fadeOut: 0.25, keep: true },
  // quick reactions, one each
  Wave: { clip: 'Wave', reps: 3, ms: 1600 },
  Laugh: { pose: true, ms: 2100 },
  Smitten: { pose: true, ms: 2300 },
  Cool: { pose: true, ms: 2200 },
  Party: { pose: true, ms: 2100 },
  Sob: { pose: true, ms: 2400 },
  Gasp: { pose: true, ms: 1600, fadeIn: 0.1 },
  Think: { pose: true, ms: 2400 },
  ThumbsUp: { clip: 'ThumbsUp', rate: 1.75, ms: 2380 },
  Clap: { pose: true, ms: 1900, fadeIn: 0.15 },
  Hooray: { pose: true, ms: 2000 },
  FistPump: { pose: true, ms: 1900 },
  Hundred: { pose: true, ms: 1900 },
  BigHeart: { pose: true, ms: 2400 },
  SmallHeart: { pose: true, ms: 2200 },
  CheerJump: { clip: 'Jump', pose: true, ms: 1300, fadeIn: 0.1, fadeOut: 0.25 },
  Twirl: { pose: true, ms: 1700 },
  FishBread: { pose: true, ms: 2500, prop: 'fish' },
  Noodles: { pose: true, ms: 2500, prop: 'noodles' },
  Groove: { clip: 'Dance', dance: true, ms: 2500 },
  Torch: { pose: true, ms: 2300, prop: 'torch' },
  Taxi: { pose: true, ms: 2100 },
  MoneyRain: { pose: true, ms: 2200, prop: 'money' },
  Doze: { pose: true, ms: 2500, fadeIn: 0.5, fadeOut: 0.4 },
});

// Quick reactions: a bubble over the head and the gesture, sent to others as a 'react' broadcast by index ({ r: i }), so
// the order is the wire format: never reorder or remove, only append. Glyphs stay within Emoji 11 so Windows 10's Segoe
// UI Emoji can draw them. `anim` is the GESTURES key; every glyph has its own.
export const REACTIONS = Object.freeze([
  { g: '👋', anim: 'Wave' }, // waves (the Wave clip, three times)
  { g: '😂', anim: 'Laugh' }, // leans back holding the belly, shaking with laughter
  { g: '😍', anim: 'Smitten' }, // hands clasped by the cheek, head tilted, swaying
  { g: '😎', anim: 'Cool' }, // arms crossed, leaning back, chin up, a slow nod
  { g: '🥳', anim: 'Party' }, // raise-the-roof: palms up over the shoulders, bouncing to the beat
  { g: '😭', anim: 'Sob' }, // slumped, fists rubbing the eyes, shoulders heaving
  { g: '😮', anim: 'Gasp' }, // a startled step back, hands up by the face
  { g: '🤔', anim: 'Think' }, // hand on the chin, other arm across the body, head tilted
  { g: '👍', anim: 'ThumbsUp' }, // the ThumbsUp clip, a little faster
  { g: '👏', anim: 'Clap' }, // hands meet in front of the chest, five claps
  { g: '🙌', anim: 'Hooray' }, // both arms up, pumped twice
  { g: '🔥', anim: 'FistPump' }, // the right fist punches up three times
  { g: '💯', anim: 'Hundred' }, // both thumbs up, pushed forward twice
  { g: '❤️', anim: 'BigHeart' }, // arms curved over the head, hands on top: a big heart
  { g: '💖', anim: 'SmallHeart' }, // hands make a small heart in front of the chest
  { g: '🎉', anim: 'CheerJump' }, // the Jump clip with both arms flung up
  { g: '✨', anim: 'Twirl' }, // one turn on the spot, arms out
  { g: '🐟', anim: 'FishBread' }, // shows a fish bread, then takes two bites
  { g: '🍜', anim: 'Noodles' }, // bowl in one hand, chopsticks to the mouth
  { g: '🎶', anim: 'Groove' }, // the Dance clip
  { g: '🗽', anim: 'Torch' }, // the Statue of Liberty: a torch held high
  { g: '🚕', anim: 'Taxi' }, // hails a cab: arm up, waving, on tiptoe
  { g: '💸', anim: 'MoneyRain' }, // flicks bills from a stack, a few fly off
  { g: '😴', anim: 'Doze' }, // nods off, jerks awake, nods off again
]);

// How long a gesture runs, in ms (unknown names: 0).
export function gestureMs(name) {
  return Object.hasOwn(GESTURES, name) ? GESTURES[name].ms : 0;
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// The pose's weight s seconds into a gesture that lasts len seconds: 0 → 1 over fadeIn, 1 → 0 over the last fadeOut.
export function gestureWeight(s, len, spec = {}) {
  if (!(s >= 0) || !(s <= len)) return 0;
  const fin = spec.fadeIn ?? 0.2, fout = spec.fadeOut ?? 0.3;
  const a = fin > 0 ? smooth(s / fin) : 1;
  const b = fout > 0 ? smooth((len - s) / fout) : 1;
  return Math.min(a, b);
}

// Helpers the poses share: a 0..1 pulse train (count pulses between a and b seconds, each rising and falling smoothly),
// and an ease for one-off moves.
export function pulses(s, a, b, count) {
  if (s <= a || s >= b || count <= 0) return 0;
  const k = ((s - a) / (b - a)) * count;
  return 0.5 - 0.5 * Math.cos((k - Math.floor(k)) * Math.PI * 2);
}
export function ease(s, a, b) {
  return smooth((s - a) / (b - a));
}

// The pouch throw (ts3d/avatars.js POSES.Throw, timesSquare3d.js throwPouch): an underhand toss up at the balloon, short enough
// to play whole between two throws 250 ms apart (the old one took 980 ms and a new throw started it again, so a tapped button
// never got past the wind-up).
//   wind..swing  the arm swings from behind the hip to the top between these seconds
//   release      the pouch leaves the hand here; until then it rides in the hand at `inHand` of its flying size
//   grow         and it is full size after this share of its flight
//   hop, hopS    one small hop (m) that is back on the ground after hopS s, when the next throw can start (it was 0.75 m
//                over 0.8 s: it dropped back at every tap and carried the head over the avatar's own name tag)
export const THROW = Object.freeze({ wind: 0.05, swing: 0.2, release: 0.15, inHand: 0.2, grow: 0.25, hop: 0.3, hopS: 0.25 });
/** How far through its swing the throwing arm is, s seconds into the throw: 0 wound up behind the hip, 1 at the top. */
export function throwSwing(s) {
  return ease(s, THROW.wind, THROW.swing);
}
/** The hop under a throw (m), s seconds into it. */
export function throwHop(s) {
  return s > 0 && s < THROW.hopS ? THROW.hop * Math.sin((s / THROW.hopS) * Math.PI) : 0;
}
/** The pouch's size (a share of its flying size) u of the way through its flight: THROW.inHand in the hand, 1 from THROW.grow on. */
export function throwSize(u) {
  return THROW.inHand + (1 - THROW.inHand) * smooth(u / THROW.grow);
}

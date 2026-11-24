// 같이 춤추기 on the screen and in the world (source checks; the rules themselves are in test/dance.test.mjs). The scored
// rhythm game is gone: no canvas, lanes, %, COMBO, grade, result or 'K-POP 댄스 챌린지'. A strip says what plays, how many
// dance here and 그만 추기; the world plays the clock's move on every dancer and sends only the existing K-댄스 reaction.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENT_NAMES } from '../plaza-account.js';
import { GA_PARAMS } from '../analytics.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ui = read('ui.js'), main = read('main.js'), world = read('timesSquare3d.js'), html = read('index.html'), worker = read('worker.js');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const code = (src) => src.replace(/\/\/[^\n]*/g, '');
const slice = (src, head, end) => { const i = src.indexOf(head); assert.ok(i >= 0, head); return src.slice(i, src.indexOf(end, i + head.length)); };
function rule(scope, selector) {
  const m = scope.match(new RegExp('(^|[}\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
  assert.ok(m, 'no rule ' + selector);
  return m[2];
}
const px = (decl, prop) => { const m = decl.match(new RegExp('(?:^|;)\\s*' + prop + ':\\s*(?:calc\\()?(-?[\\d.]+)px')); assert.ok(m, prop + ' in ' + decl); return Number(m[1]); };
function media(head) {
  const i = css.indexOf('@media ' + head + ' {');
  assert.ok(i >= 0, head);
  let d = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return css.slice(j + 1, k); }
  return '';
}

describe('the old rhythm game is gone', () => {
  it('no canvas, lanes, accuracy, combo, grade, result, arrow keys or 댄스 챌린지 in the page, the HUD or the world', () => {
    const all = code(ui) + code(main) + code(world);
    for (const gone of ['rhythmCanvas', 'rhythmEl', 'rhythmScore', 'rhythmCombo', 'lanePads', 'DANCE_KEYS', 'danceHit', 'drawDance', 'drawArrow', 'LANE_COLORS',
      'COMBO', 'ALL KILL', '정확도', '한 곡 더', '댄스 챌린지', 'K-POP 댄스', 'danceBus', 'stopDanceAudio', 'BALANCE.dance']) assert.equal(all.includes(gone), false, gone);
    assert.equal(css.includes('.rhythm'), false);
    assert.equal(/\bdance: \{ bpm/.test(read('balance.js')), false, 'the judging windows are gone');
    // the one-shot K-댄스 reaction stays as it was
    assert.match(read('ts3d/avatars.js'), /4: \{ anim: 'Dance', glyph: '💃', label: 'K-댄스', hold: 6 \},/);
  });
});

describe('the strip', () => {
  it('says ♪ the track, 지금 N명이 같이 춰요 and 그만 추기, and is hidden while nobody dances', () => {
    assert.match(ui, /const danceEl = h\('div', \{ class: 'glass dancebar', role: 'group', 'aria-label': '같이 춤추기', hidden: true \},\n\s+h\('span', \{ class: 'txt' \}, danceSongEl, danceMatesEl\),\n\s+h\('button', \{ class: 'stop', type: 'button', text: '그만 추기', onclick: \(\) => endDance\('stop'\) \}\)\);/);
    const tick = slice(ui, '  function tickDance(now, force) {', '\n  }\n');
    assert.match(tick, /danceSongEl\.textContent = '♪ ' \+ r\.name;/);
    assert.match(tick, /`지금 \$\{n\}명이 같이 춰요`/);
    assert.match(tick, /const r = radioAt\(nowMs\(\), danceRadio\);/);
    assert.match(css, /\.dancebar\[hidden\] \{ display: none; \}/);
  });
  it('is 44px to tap, text 12px and up, and the button shows when pressed like every button', () => {
    const bar = rule(css, '.dancebar');
    assert.equal(px(bar, 'min-height'), 44);
    assert.match(bar, /pointer-events: auto !important;/);
    const stop = rule(css, '.dancebar .stop');
    assert.equal(px(stop, 'height') + 2 * 3, 44);
    assert.match(rule(css, '.dancebar .stop::after'), /inset: -3px 0;/);
    for (const sel of ['.dancebar .song', '.dancebar .mates', '.dancebar .stop']) assert.ok(Number(rule(css, sel).match(/font: \d+ (\d+)px/)[1]) >= 12, sel);
    assert.match(rule(css, '.dancebar .mates'), /color: var\(--text-2\);/);
    assert.equal(/dancebar[^{]*(animation|transition)/.test(css), false, 'nothing moves on it (prefers-reduced-motion has nothing to stop)');
  });
  it('touch: the bottom lane (the prompt tag is down while dancing); upright phone: over the stick, two text lines; on its side: 10px up', () => {
    const t = rule(css, 'html.touch .dancebar');
    assert.equal(px(t, 'bottom'), 44);
    assert.equal(px(t, 'left'), 122);
    assert.equal(px(t, 'right'), 72);
    assert.match(ui, /const show = !!near && !baking && !sheet && !dance && !driving && !focusOn;/);
    const up = media('(orientation: portrait) and (max-width: 599px)');
    const u = rule(up, 'html.touch .dancebar');
    assert.ok(px(u, 'bottom') >= 36 + 104, 'above the resting stick (36px up, 104px tall)');
    assert.equal(px(u, 'left'), 10);
    assert.match(rule(up, 'html.touch .dancebar .txt'), /flex-direction: column;/);
    // 375px wide: 10px in, 72px clear on the right = 293px for 그만 추기 and the longer of the two lines
    assert.ok(375 - 10 - 72 >= 14 + 130 + 12 + 80 + 3);
    const land = media('(orientation: landscape) and (max-height: 520px)');
    const l = rule(land, 'html.touch .dancebar');
    assert.equal(px(l, 'bottom'), 10);
    assert.ok(px(l, 'left') >= 10 + 88 + 8, 'right of the 88px stick');
  });
  it('the stick, the right-hand buttons and the 동작 button stay up while dancing (only the bake panel hides them)', () => {
    assert.equal(/:has\([^)]*dancebar[^)]*\)[^{]*:is\(\.dock, \.acts, \.joy/.test(css), false);
    assert.match(css, /html\.touch #ui:has\(\.bake\.show\) > :is\(\.dock, \.acts, \.joy, \.prompt, \.reacts\) \{ visibility: hidden !important; \}/);
  });
});

describe('starting and ending', () => {
  it('starts from the stage button, the 동작 row (a dock button on a desktop) and the notice, and says which in dance_start', () => {
    assert.match(ui, /stage: \['같이 춤추기', '모두 같은 음악에 같은 춤', '춤추기'\],/);
    assert.match(main, /else if \(kind === 'stage'\) ui\.startDance\('stage'\);/);
    assert.match(ui, /h\('button', \{ class: 'dance-go', type: 'button', onclick: \(\) => \{ toggleReacts\(false\); startDance\('panel'\); \} \}, icon\('music'\), h\('span', \{ class: 'dl', text: '같이 춤추기' \}\)\)/);
    assert.match(ui, /loungeBtn\.after\(danceGo\);/); // a desktop dock: beside 멍때리기, the two buttons without a number key
    assert.match(css, /html\.touch \.reacts button\.dance-go \{ grid-column: 1 \/ -1;[^}]*height: 44px;/);
    const start = slice(ui, "  function startDance(kind = 'panel') {", '\n  }\n');
    assert.match(start, /trackEvent\('dance_start', \{ kind \}\);/);
    assert.match(start, /if \(ceremonyOn\(\)\) \{ note\('점등식이 끝나면 같이 춰요'\); return false; \}/);
    assert.match(start, /if \(hooks\.danceStart\?\.\(kind\) !== true\) return false;/);
    assert.equal(/lockInput/.test(start), false, 'movement stays: moving is how a dance ends');
  });
  it('ends on 그만 추기, Escape, moving, a sheet, the bake, a taxi, 순간이동, 멍때리기, the tab hidden and a ceremony countdown', () => {
    assert.match(ui, /if \(dance && e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); endDance\('stop'\); return; \}/);
    assert.match(world, /if \(dancing\) \{ setDancing\(false\); opts\.onDanceEnd\?\.\('move'\); \}/);
    assert.match(world, /if \(dancing\) \{ setDancing\(false\); opts\.onDanceEnd\?\.\('taxi'\); \}/);
    assert.match(world, /if \(dancing\) \{ setDancing\(false\); opts\.onDanceEnd\?\.\('teleport'\); \}/);
    assert.match(main, /onDanceEnd: \(why\) => ui\.endDance\?\.\(why\),/);
    assert.match(slice(ui, '  function openSheet(', '\n  }\n'), /if \(dance\) endDance\('sheet'\);/);
    assert.match(slice(ui, '  function startBake() {', '\n  }\n'), /if \(dance\) endDance\('bake'\);/);
    assert.match(ui, /if \(driving\) \{ toggleReacts\(false\); coachDone\(\); endDance\('taxi'\); \}/);
    assert.match(ui, /lounge\(on, n\) \{ if \(on\) endDance\('lounge'\);/);
    assert.match(ui, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'hidden'\) endDance\('hidden'\); \}\);/);
    assert.match(slice(ui, '  function tickDance(now, force) {', '\n  }\n'), /if \(ceremonyOn\(\)\) \{ endDance\('ceremony'\); return; \}/);
    assert.match(ui, /const ceremonyOn = \(\) => document\.body\.classList\.contains\('gift-cer'\);/);
    const end = slice(ui, "  function endDance(why = 'stop') {", '\n  }\n');
    assert.match(end, /trackEvent\('dance_end', \{ span: spanBucket\(performance\.now\(\) - d\.at\) \}\);/);
    assert.match(end, /danceMusicOff\(\);/);
    assert.equal(/showResult|note\(/.test(end), false, 'no result, no score');
  });
  it('the music: the radio track laid over the square at the clock position, and back to the square after', () => {
    assert.match(ui, /bgm\.over\(r\.id, r\.posMs \/ 1000\);/);
    assert.match(slice(ui, '  function danceMusicOff() {', '\n  }\n'), /if \(!lofi\) bgm\.over\(null\);/);
    assert.match(ui, /if \(dance\) danceMusic\(radioAt\(nowMs\(\), danceRadio\)\);/);
  });
  it('a nearby dancer: one tappable notice per player, keyed to one row, never over a sheet or a game', () => {
    const inv = slice(ui, '  function danceInvite(name) {', '\n  }\n');
    assert.match(inv, /if \(dance \|\| screenBusy\(\) \|\| ceremonyOn\(\) \|\| ext\) return false;/);
    assert.match(inv, /note\(`\$\{chars\(String\(name \|\| '익명'\), 12\)\}님이 춤추고 있어요 · 같이 춤추기`, 'ok', \(\) => startDance\('join'\), \{ key: 'dance-near' \}\);/);
    assert.match(main, /onDancerNear: \(id, name\) => ui\.danceInvite\?\.\(name\) === true,/);
    const rd = slice(world, '  function stepRemoteDance(id, r, inCar) {', '\n  }\n');
    assert.match(rd, /if \(opts\.onDancerNear\?\.\(id, r\.nm\) === true\) danceAsked\.add\(id\);/);
    assert.match(rd, /danceAsked\.has\(id\)/);
    assert.match(rd, /isSustained\(r, now\)/);
    assert.match(rd, /NEAR_M \* NEAR_M/);
  });
});

describe('the world', () => {
  it('mine and the others play the same move for the same bar: one radio a frame, one danceMove for both', () => {
    assert.match(world, /if \(dancing && myDanceKey !== radio\.key\) \{ myDanceKey = radio\.key; danceMove\(me, radio\.clip, radio\.barMs \+ 400\); \}/);
    assert.match(world, /if \(r\.danceKey !== radio\.key\) \{ r\.danceKey = radio\.key; danceMove\(r\.av, radio\.clip, radio\.barMs \+ 400\); \}/);
    const sync = slice(world, '  function syncRemotes(dt, t) {', '\n  if (net) {');
    assert.match(sync, /radioAt\(nowMs\(\), radio\);/);
    assert.match(sync, /danceRows\.length = 0;/);
    assert.match(world, /import \{ nowMs \} from '\.\/live\.js';/);
  });
  it('the per-frame dance paths make nothing: radioAt fills one object, the rows are one reused array', () => {
    for (const [head, end] of [['  function stepDance(now) {', '\n  }\n'], ['  function stepRemoteDance(id, r, inCar) {', '\n  }\n'], ['  function danceMove(av, clip, ms) {', '\n  }\n']]) {
      const body = slice(world, head, end);
      assert.equal(/new |\{ [a-z]+:|\[\]|=>|\.\.\.|\.map\(|\.filter\(|radioAt\(nowMs\(\)\)/.test(body.replace(/\/\/[^\n]*/g, '')), false, head);
    }
    assert.match(world, /const radio = \{\}, danceRows = \[\], danceAsked = new Set\(\);/);
  });
  it('sends only the existing reaction: K-댄스 (4) now and every RESEND_MS, inside the emote cooldown; nothing else new', () => {
    const send = slice(world, '  function sendDance(now) {', '\n  }\n');
    assert.match(send, /if \(!resendDue\(now, danceSentAt, lastEmote, EMOTE_GAP_MS\)\) return;/);
    assert.match(send, /net\?\.sendEmoji\?\.\(4\)/);
    assert.match(send, /lastEmote = now;/);
    const dancePart = slice(world, '  function setDancing(on) {', '\n  // Street names for the HUD');
    assert.equal(/net\?*\.send\(|sendEmoji\?\.\((?!4)/.test(dancePart), false, 'no other message');
    assert.match(world, /    if \(dancing\) sendDance\(now\);\n/);
    // the receiver: a re-send while they dance is not shown again
    assert.match(world, /if \(p\.e === 4 && !seenDancer\(remotes\.get\(p\.id\), performance\.now\(\)\)\) return;/);
    // walking or a taxi ends a remote dance on my screen too
    assert.match(slice(world, '  function stepRemoteDance(id, r, inCar) {', '\n  }\n'), /if \(inCar \|\| r\.spd > 0\.6\) \{ r\.lastSeen = 0; r\.danceKey = -1; return; \}/);
  });
  it('the stage light pulses on the beat while I dance on the stage, not under prefers-reduced-motion and not on low', () => {
    const step = slice(world, '  function stepDance(now) {', '\n  }\n');
    assert.match(step, /on = dancing && !calm\.matches && /);
    assert.match(step, /if \(stageLight\.intensity !== want\) stageLight\.intensity = want;/);
    assert.match(world, /let eastLight = null, stageLight = null;/);
    assert.match(world, /  if \(!low\) \{\n    eastLight = new THREE\.PointLight\(0x3fe6ff, 700, 85, 2\);\n    eastLight\.position\.set\(30, 16, 95\);\n    stageLight = new THREE\.PointLight/);
  });
});

describe('measurement', () => {
  it('dance_start, dance_end and bake_start are known events (the Worker checks the same list) and their keys may go to GA', () => {
    for (const n of ['dance_start', 'dance_end', 'bake_start']) assert.ok(EVENT_NAMES.includes(n), n);
    assert.match(worker, /import \{[^}]*EVENT_NAMES[^}]*\} from '\.\/plaza-account\.js';/);
    assert.match(worker, /if \(!EVENT_NAMES\.includes\(name\)\) return J\(\{ err: 'event' \}, 400\);/);
    for (const k of ['kind', 'span']) assert.ok(GA_PARAMS.includes(k), k);
    assert.match(slice(ui, '  function startBake() {', '\n  }\n'), /trackEvent\('bake_start'\);/);
  });
});

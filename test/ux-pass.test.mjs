// The 2026-11-24 screen audit (docs/ux-audit-2026-11-24.md): the rules it led to that are not about where things sit
// (those are in layout.test.mjs). Pressed feedback, sizes, small text, contrast, zoom, focus, names, and the lines that
// were taken out. Worked out from the sources, as in layout.test.mjs: a browser is not available to the tests.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRESS, hintLeft, sameNews } from '../overlay.js';
import { ICONS } from '../uiicons.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const ui = read('ui.js');
const code = (src) => src.replace(/\/\/[^\n]*/g, ''); // without line comments (they may quote what was removed)
function rule(selector) {
  const m = css.match(new RegExp('(^|[}\\n])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}'));
  assert.ok(m, 'no rule ' + selector);
  return m[2];
}
const px = (decls, prop) => Number(decls.match(new RegExp('(?:^|[;\\s])' + prop + ': (?:calc\\()?(-?[\\d.]+)px'))[1]);
const token = (name) => html.match(new RegExp('--' + name + ': (#[0-9a-f]{6});'))[1];
const lum = (hex) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('pressed: every control answers a press', () => {
  it('one rule covers buttons, role=button, summary, link buttons and checkbox rows, for :active and for .tapped', () => {
    const sel = 'html :is(button, [role="button"], summary, a.btn, label.agree):not(:disabled, [aria-disabled="true"]):is(:active, .tapped)';
    const r = rule(sel);
    assert.match(r, /filter: brightness\(1\.25\);/);
    assert.match(r, /box-shadow: inset 0 0 0 100vmax rgba\(255, 255, 255, \.16\);/); // a veil that shows on any background, a transparent one too
    assert.match(r, /scale: \.97;/); // `scale`, not transform: a control's own transform (a centred pill) stays
    assert.match(r, /transition: none;/);
    // the selector list is the one ui.js listens with
    assert.equal(PRESS.sel, 'button, [role="button"], summary, a.btn, label.agree');
    assert.ok(sel.includes(`:is(${PRESS.sel})`));
    // the old five :active rules (a 1px nudge with no colour change) are gone
    assert.equal(/\.btn:active \{ transform/.test(css), false);
    assert.equal(/\.emote:active \{ transform: translateY\(0\) scale\(\.96\); \}/.test(css), true); // the dock's own bounce stays with the veil
  });
  it('ui.js keeps .tapped for 160 ms from pointerdown, so the quickest tap is seen (and iOS shows it at all)', () => {
    assert.equal(PRESS.ms, 160);
    assert.match(ui, /document\.addEventListener\('pointerdown', \(e\) => \{\n\s+const el = e\.target\?\.closest\?\.\(PRESS\.sel\);\n\s+if \(!el \|\| el\.disabled \|\| el\.getAttribute\('aria-disabled'\) === 'true'\) return;\n\s+el\.classList\.add\('tapped'\);\n\s+setTimeout\(\(\) => el\.classList\.remove\('tapped'\), PRESS\.ms\);\n\s+\}, \{ passive: true, capture: true \}\);/);
  });
  it('amber buttons go darker, by a step the eye sees (it was 1.17:1), and a colour swatch only shrinks', () => {
    assert.equal(token('accent-press'), '#c98a12');
    assert.ok(contrast(token('accent'), token('accent-press')) >= 1.5);
    assert.ok(contrast('#ffb020', '#eba21d') < 1.2); // what it was
    const gold = rule('html :is(.btn.gold, .btn.primary, .act.big, .enter-go):not(:disabled):is(:active, .tapped)');
    assert.match(gold, /filter: none; box-shadow: none; background: var\(--accent-press\); scale: \.96;/);
    assert.match(rule('html button:is(.swatch, .theme):not(:disabled):is(:active, .tapped)'), /filter: none; box-shadow: none; scale: \.88;/);
    // the keyboard ring is untouched
    assert.match(css, /html :is\(button, a\[href\], input, select, textarea, summary, \[tabindex\], \[role="button"\]\):not\(#view\):focus-visible \{ outline: none; box-shadow: var\(--focus\) !important; \}/);
  });
});

describe('sizes: what a thumb presses is at least 44px', () => {
  it('the call to action of a sheet is the tallest button of its sheet under 641px too', () => {
    const touch = rule('html.touch .sheet .cta');
    assert.ok(px(touch, 'min-height') >= 48);
    assert.ok(px(touch, 'font-size') >= 16);
    // before: `.btn { height: 38px; font-size: 13px }` under 641px beat `.cta`, and the 44px touch rule skipped .cta
    assert.match(css, /@media \(max-width: 640px\) \{ \.sheet \.cta \{ height: auto; min-height: 48px; font-size: 16px; \} \}/);
    assert.match(css, /html\.touch \.sheet :where\(\.btn:not\(\.icon, \.pick, \.shop-open, \.cta\)\) \{ height: auto; min-height: 44px;/);
  });
  it('chips, tabs, the wish tabs, map buttons, the fold line, sliders and a tappable notice', () => {
    assert.ok(px(rule('html.touch .sheet .seg button'), 'min-height') >= 44);
    assert.ok(px(rule('html.touch .sheet .chips button'), 'min-height') >= 44);
    assert.equal(px(rule('html.touch .sheet .chips'), 'gap'), 8);
    assert.ok(px(rule('html.touch .wish-tab'), 'min-height') >= 44);
    const zoom = rule('html.touch .mapzoom button');
    assert.ok(px(zoom, 'width') >= 44 && px(zoom, 'height') >= 44);
    assert.equal(px(rule('html.touch .mapzoom'), 'gap'), 8);
    assert.ok(px(rule('html.touch .range'), 'height') >= 44);
    assert.ok(px(rule('html.touch .toast.hit'), 'min-height') >= 44);
    assert.ok(px(rule('html.touch .sheet .btn.shop-open'), 'min-height') >= 44);
    // a quick-jump chip is 36px tall and takes taps over 44px; the row fades at its right end (there is more to scroll to)
    assert.equal(px(rule('html.touch .quick button'), 'height') + 2 * 4, 44);
    assert.match(rule('html.touch .quick button::after'), /inset: -4px 0;/);
    assert.match(rule('.quick'), /mask-image: linear-gradient\(90deg, #000 calc\(100% - 28px\), transparent\);/);
  });
  it('colour swatches are 40px circles with a 48px touch area, and the free colour picker is a circle like them', () => {
    const sw = css.match(/\n\s*\.swatch \{ width: 40px; height: 40px; position: relative; \}/);
    assert.ok(sw, 'no 40px swatch rule');
    assert.match(rule('html.touch .swatch::after'), /inset: -4px;/);
    assert.match(rule('.swatches input[type=color]'), /width: 40px; height: 40px;[^}]*border-radius: 50%;/);
    assert.equal(/width: '38px'/.test(ui), false); // the profile sheet's inline 38px is gone
    // a swatch is named by its colour, not by a hex value
    assert.match(ui, /'aria-label': swatchName\(c\), title: swatchName\(c\)/);
    assert.equal(/class: `?'?swatch[^\n]*'aria-label': c[,\s]/.test(ui), false);
  });
  it('a checkbox row is a 22px box with its words beside it on a 44px row, and its links are their own line', () => {
    const row = css.match(/\n\s*\.agree \{ min-height: 44px; align-items: center; gap: 12px; margin-top: 8px; \}/);
    assert.ok(row, 'no 44px checkbox row');
    assert.match(css, /\n\s*\.agree input \{ width: 22px; height: 22px; margin: 0; \}/);
    // sign-up: the label holds no link (a tap meant for the box opened the terms); the two documents open from the next line
    const login = ui.slice(ui.indexOf('  function openLogin('), ui.indexOf('  function handoverMoved('));
    assert.match(login, /h\('label', \{ class: 'agree' \}, agree, h\('span', \{ text: '만 14세 이상이며 이용약관과 개인정보처리방침에 동의합니다\.' \}\)\),\n\s+h\('p', \{ class: 'agree-links' \}, legal\.link\('terms', '이용약관 보기'\), legal\.link\('privacy', '개인정보처리방침 보기'\)\)\);/);
    // settings: the words are right beside the box (the field's title row pushed them to the far edge)
    assert.match(ui, /h\('div', \{ class: 'field' \}, h\('div', null, h\('label', \{ class: 'agree' \}, box, h\('span', null, '방문 통계 보내지 않기'\)\)\), said\);/);
  });
  it('desktop rows that are buttons are at least 24px tall', () => {
    assert.match(css, /html:not\(\.touch\) \.liveboard :is\(\.livehead, button\.rank, button\.f\), html:not\(\.touch\) \.stay-quest button, html:not\(\.touch\) \.wallet \.nextgoal:not\(\.task\) \{ min-height: 24px; \}/);
  });
});

describe('text: nothing under 12px, and what is dim still reads', () => {
  it('no font size under 12px in the stylesheet', () => {
    const small = [];
    for (const m of css.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)) if (Number(m[1]) > 0 && Number(m[1]) < 12) small.push(m[0]);
    for (const m of css.matchAll(/font: (?:\d{3} )?(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 12) small.push(m[0]);
    assert.deepEqual(small, []); // 멍때리기 / 동작 were 9px, the action names and 속보 LIVE 10px, badges and the status line 11px
  });
  it('the dim colour passes 4.5:1 on a disabled button, and links in running text take the link colour', () => {
    assert.ok(contrast(token('dim'), token('surface-2')) >= 4.5); // it was #666d92: 3.03:1 under 포인트가 부족해요
    assert.match(css, /\n\s*\.note a, \.callout a, \.credits a \{ color: var\(--info\); font-weight: 700; \}/); // a bare <a> was #0000ee, 1.84:1
    // a plot level not reached yet is dimmed by its picture; its name keeps full strength (it was 2.58:1)
    assert.match(css, /\n\s*\.lv, \.lv\.done \{ opacity: 1; \}/);
    assert.match(css, /\n\s*\.lv \.t \{ color: var\(--text-2\); \}/);
    assert.ok(contrast(token('text-2'), token('surface-2')) >= 4.5);
  });
  it('a text box uses the app font (문의하기 was monospace)', () => {
    assert.match(css, /\n\s*textarea \{ font-family: inherit; \}/);
  });
});

describe('zoom and focus', () => {
  it('the viewport does not block zoom; a double tap never zooms; the canvas keeps its own gestures', () => {
    const vp = html.match(/<meta name="viewport" content="([^"]*)"/)[1];
    assert.equal(vp, 'width=device-width, initial-scale=1, viewport-fit=cover');
    assert.equal(/maximum-scale|user-scalable/.test(html), false);
    assert.match(css, /html, body \{[^}]*touch-action: manipulation; \}/);
    assert.match(rule('#view'), /touch-action: none;/);
    assert.match(css, /\.bigmap canvas \{[^}]*touch-action: none; \}/);
    // a pinch zoom is a window onto the page, not a new screen size: the layout keeps its unzoomed height and top
    assert.match(html, /const zoom = vv && vv\.scale > 1\.01 \? vv\.scale : 1;\n\s+s\.setProperty\('--app-h', \(vv \? vv\.height \* zoom : innerHeight\) \+ 'px'\);\n\s+s\.setProperty\('--app-top', \(vv && zoom === 1 \? vv\.offsetTop : 0\) \+ 'px'\);/);
  });
  it('a sheet is modal: the HUD is inert and the canvas out of the tab order behind it, and Tab goes round inside it', () => {
    // the canvas is not made inert (the world keeps its own pointer state for a camera drag): it only leaves the tab order
    assert.match(ui, /function backInert\(on\) \{\n\s+on = !!on \|\| !!ext;[^\n]*\n\s+root\.inert = on;\n\s+if \(!viewEl\) return;\n\s+viewEl\.tabIndex = on \? -1 : 0;\n\s+if \(on\) viewEl\.setAttribute\('aria-hidden', 'true'\);\n\s+else viewEl\.removeAttribute\('aria-hidden'\);\n\s+\}/);
    assert.match(html, /<canvas id="view" aria-label="타임스퀘어 3D 광장" tabindex="0"><\/canvas>/);
    // a sheet that opens while the thumb is on the stick takes the pointer away with no pointerup: the stick lets go
    assert.match(ui, /joyZone\.addEventListener\('lostpointercapture', end\);/);
    assert.match(ui, /if \(ev\.type !== 'pointerup' \|\| engaged\) hooks\.tapUp\?\.\(origin\.x \+ 999, origin\.y\);/);
    const open = ui.slice(ui.indexOf('  function openSheet('), ui.indexOf('  const backKeeper ='));
    assert.match(open, /document\.body\.classList\.add\('has-sheet'\);\n\s+backInert\(true\);/);
    assert.match(open, /el\.addEventListener\('keydown', \(e\) => trapTab\(e, box\)\);/);
    assert.match(open, /role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1'/);
    const after = ui.slice(ui.indexOf('  function afterSheets('), ui.indexOf('  function backSheet('));
    // inert comes off before focus goes back to what opened the sheet
    assert.ok(after.indexOf('backInert(sheets.length > 0);') > 0 && after.indexOf('backInert(sheets.length > 0);') < after.indexOf('back.focus('));
    const trap = ui.slice(ui.indexOf('  function trapTab('), ui.indexOf('  function afterSheets('));
    assert.match(trap, /if \(e\.shiftKey && \(at === first \|\| at === box\)\) \{ e\.preventDefault\(\); last\.focus\(\); \}\n\s+else if \(!e\.shiftKey && at === last\) \{ e\.preventDefault\(\); first\.focus\(\); \}/);
    // the box is focused on opening so the keyboard starts inside; that draws no ring round the whole sheet
    assert.match(css, /html div\.sheet:not\(#view\):focus-visible \{ box-shadow: var\(--shadow-sheet\) !important; \}/);
  });
  it('the canvas shows keyboard focus, inside its edge', () => {
    assert.match(css, /#view:focus-visible \{ box-shadow: inset 0 0 0 3px var\(--info\); \}/);
  });
});

describe('names and states a screen reader hears', () => {
  it('소리 is a switch at the top of the settings sheet with its state in words; the tool button is gone', () => {
    const set = ui.slice(ui.indexOf('  function openSettings() {'), ui.indexOf('  function operatorFooter()'));
    assert.match(set, /const sound = switchRow\(\(on\) => icon\(on \? 'soundOn' : 'soundOff'\), '소리', \(\) => soundOn, \(\) => setSoundOn\(!soundOn\)\);/);
    assert.match(set, /b\.setAttribute\('aria-pressed', String\(on\)\);\n\s+state\.textContent = on \? '켜짐' : '꺼짐';/);
    assert.match(set, /host\.append\(\n\s+h\('div', \{ class: 'rowlist', style: \{ marginTop: 0 \} \}, sound\.el, full\?\.el\),/);
    assert.equal(/soundBtn|'aria-label': '사운드'/.test(ui), false);
    // 전체 화면: a switch here on touch (where the browser can do it), a tool button in a desktop window
    assert.match(set, /const full = coarse && fsCan\(\) \? switchRow\(\(on\) => icon\(on \? 'fullscreenExit' : 'fullscreen'\), '전체 화면', \(\) => !!fsOn\(\), \(\) => toggleFullscreen\(\)\) : null;/);
    assert.match(ui, /class: 'btn ghost icon tool-more tool-desk', type: 'button', 'aria-label': '전체 화면'/);
    assert.match(css, /html\.touch \.tools \.btn\.tool-desk \{ display: none !important; \}/);
    // the setter is what the old button did
    assert.match(ui, /function setSoundOn\(on\) \{\n\s+soundOn = !!on;\n\s+store\('kts_sound', soundOn\);\n\s+setSound\(soundOn\);\n\s+if \(!soundOn\) \{ cityStop\(\); lofiStop\(\); danceSong = ''; return; \}/);
  });
  it('the two sliders are named, the tab groups say which is chosen, and the four rows that open a sheet look alike', () => {
    const set = ui.slice(ui.indexOf('  function openSettings() {'), ui.indexOf('  function operatorFooter()'));
    assert.match(set, /class: 'range', 'aria-label': label, 'aria-valuetext': fmt\(value\)/);
    assert.match(set, /row\('네온 글로우', 0, 100,/);
    assert.match(set, /row\('화면 밝기', 60, 130,/);
    assert.match(set, /'aria-pressed': String\(s\.quality === q\)/);
    for (const name of ['알림', '받은 소식', '이번 주 코드', '문의하기']) assert.ok(set.includes(`open('${name}', () => open`), name);
    assert.equal(/class: 'btn gold', type: 'button', text: '알림'/.test(set), false); // it read as the sheet's main action
    // hints nobody read at the far edge of a title row are gone
    assert.equal(/눈부시면 낮춰 주세요|반사·해상도|포인트 지급은 이 번호로만/.test(set), false);
    // the account number: a plain line shortened in the middle, copied whole
    assert.match(set, /const idShort = accountId\.length > 26 \? `\$\{accountId\.slice\(0, 16\)\}…\$\{accountId\.slice\(-6\)\}` : accountId;/);
    assert.match(set, /if \(await writeClip\(accountId\)\) note\('계정 번호를 복사했어요', 'ok'\);\n\s+else showManual\(accountId, idManual\);/);
  });
  it('the four links of the settings sheet are a 2 x 2 block of buttons, and a photo\'s links are buttons under its line', () => {
    const p = ui.slice(ui.indexOf('  function policyLinks() {'), ui.indexOf('  function openLinkPrompt()'));
    for (const t of ['지도 © OpenStreetMap', '사진·캐릭터 라이선스', '이용약관', '개인정보처리방침']) assert.ok(p.includes(`row('${t}'`), t);
    assert.equal(/\[이용약관\]|\[개인정보처리방침\]/.test(ui), false);
    assert.ok(px(rule('.linkrow > :is(a, button)'), 'min-height') >= 44);
    assert.match(rule('.linkrow'), /grid-template-columns: 1fr 1fr;/);
    const cr = ui.slice(ui.indexOf('  function openCredits() {'), ui.indexOf('  function speciesPicker('));
    assert.match(cr, /links\(\[`라이선스 · \$\{c\.license \|\| 'license'\}`, c\.license_url \|\| c\.source\], \['원본', c\.source\]\)/);
    // the keyboard and mouse controls are not listed on a touch screen
    assert.match(cr, /coarse \? null : h\('div', \{ class: 'callout', style: \{ marginTop: 0 \} \}, h\('b', \{ text: '조작법' \}\)/);
  });
  it('map buttons have names, and 순간이동 is written out (the bolt alone is also the taxi\'s boost)', () => {
    const m = ui.slice(ui.indexOf('  function openMap('), ui.indexOf('  function statsField()'));
    for (const name of ['확대', '축소', '내 위치', '목적지로 순간이동', '목적지 지우기']) assert.ok(m.includes(`'aria-label': '${name}'`), name);
    assert.match(m, /icon\('bolt'\), h\('span', \{ text: '순간이동' \}\)\)/);
    // the how-to line shows three times, then never (kts_maphint)
    assert.match(m, /const howTo = hintLeft\(seenHint\) > 0 \?/);
    assert.match(m, /if \(howTo\) store\('kts_maphint', seenHint \+ 1\);/);
    assert.equal(hintLeft(0), 3);
    assert.equal(hintLeft(2), 1);
    assert.equal(hintLeft(3), 0);
    assert.equal(hintLeft(99), 0);
    assert.equal(hintLeft('x'), 3);
    assert.equal(hintLeft(1, 1), 0);
  });
  it('the wallet card is not a button around other buttons: its amount line is the one button of its own', () => {
    assert.match(ui, /const amtBtn = h\('button', \{ class: 'wallet-amt', type: 'button', 'aria-label': '응원 포인트 · 지갑 열기'/);
    assert.match(ui, /const walletEl = h\('div', \{ class: 'glass wallet', onclick: \(\) => openWalletInfo\(\) \}, coinIcon,/);
    assert.equal(/class: 'glass wallet', role: 'button'/.test(ui), false);
  });
  it('the fields of a board and a building sign are named by more than their example text', () => {
    assert.match(ui, /placeholder: \['메인 문구 \(16자\)', '둘째 줄 \(16자\)', '셋째 줄 \(16자\)'\]\[i\], 'aria-label': \['첫째 줄', '둘째 줄', '셋째 줄'\]\[i\]/);
    assert.match(ui, /placeholder: '간판 이름 \(14자\)', 'aria-label': '간판 이름'/);
  });
});

describe('icons', () => {
  it('전광판 걸기 is a billboard and the megaphone is 광장 소식 only, so neither looks like a speaker', () => {
    assert.notDeepEqual(ICONS.board, ICONS.megaphone);
    assert.equal(ICONS.board.some((s) => Array.isArray(s) && s[0] === 'rect'), true); // a wide screen …
    assert.equal(ICONS.board.filter((s) => typeof s === 'string' && /^M[\d.]+ [\d.]+H[\d.]+$/.test(s)).length, 2); // … with two lines of text …
    assert.equal(ICONS.board.filter((s) => typeof s === 'string' && /^M[\d.]+ [\d.]+V[\d.]+$/.test(s)).length, 2); // … on two legs
    assert.equal(ICONS.megaphone[0], ICONS.soundOn[0].replace('L12 5.5V18.5', 'L14 5V19')); // the megaphone is the speaker's cousin: that was the problem
    const megaphone = [...ui.matchAll(/'megaphone', '([^']+)'/g)].map((m) => m[1]);
    assert.ok(megaphone.length >= 3);
    for (const t of megaphone) assert.equal(t, '광장 소식');
    assert.match(ui, /\}, icon\('board'\)\),\n\s+wishBtn,/); // the tool
    assert.match(ui, /openSheet\(\['board', '전광판 걸기'\]/);
  });
  it('the gift tool uses the line icon like its neighbours', () => {
    const gift = read('gift.js');
    assert.match(gift, /import\('\.\/uiicons\.js\?v=\d+'\)\.then\(\(m\) => btn\.replaceChildren\(m\.icon\('gift'\)\)\)/);
    assert.equal(/btn\.textContent = '🎁'; btn\.addEventListener/.test(gift), false);
    assert.ok(Object.hasOwn(ICONS, 'gift'));
  });
});

describe('lines that were taken out', () => {
  const all = code(ui) + code(read('main.js')) + code(read('teamui.js'));
  it('the dance lists no reward steps (the dance pays nothing), and no prompt tells which button to press', () => {
    assert.equal(/55% 미만|\+2 · 55%|90% \+12/.test(all), false);
    assert.equal(/←↓↑→ 또는 D F J K|lanePads/.test(all), false); // 같이 춤추기 has no keys to learn
  });
  it('stale and duplicate lines from the audit are gone', () => {
    for (const gone of [
      'S급 메인 타워부터', '전광판과 수익이 남아요', '주간 리그 지출', '외벽 광고 수익의 50%는', '코리아웨이',
      '정산은 자동이에요', '화면 왼쪽 위 큰 숫자는', '출석·응원·관람·공유·초대로 모아요', '명당은 응원 팀 자리',
      '초록에서 멈추면 바삭', '버튼을 눌러 뒤집으세요', '운전 시작!', '진행 방향 도로 위에', '관람을 마쳤어요',
      '8초마다 다음 전광판', '눈부시면 낮춰 주세요', '스폰서 안내 주소가 아직 없어요', '응원 포인트는 돈으로 팔지 않아요. 출석',
      '계정 연결하고 받기', '링크를 열면 이 사진이 미리 보이고', '증축할수록 건물이 커지고', '아무도 가져갈 수 없어요. 하루 한 번',
      '운영자가 확인한 사진만 광장 전체에 송출되고', '같은 인터넷 연결은 팀마다 한 명). 포인트로는',
    ]) assert.equal(all.includes(gone), false, gone);
    // an internal slot id is not shown as text
    assert.equal(/text: `PLOT_\$\{id\}`/.test(ui), false);
  });
  it('what replaced them is short', () => {
    for (const kept of [
      "'거리 전광판에 내 문구를 걸어요.'", "'텐트에서 타워까지 5단계.'", "'계정을 연결하면 전광판과 응원 포인트가 남아요. '",
      "'전광판과 꾸미기에 써요. 출석·응원·관람으로 모아요.'", "'돈으로 팔지 않고, 보낼 수도 없어요.'", "'종류마다 하나씩 장착해요.'",
      "'비었거나 기간이 끝난 칸만 걸 수 있어요.'", "'사진은 운영자가 확인한 뒤 걸려요.'", "'하루 한 번 불 켜기로 72시간을 다시 이어요.'",
      "'창을 닫아도 포인트와 전광판이 남아요.'", "'복주머니를 맞혀 보세요'", "'손님 기둥 앞에서 속도를 줄이세요'",
    ]) assert.ok(ui.includes(kept), kept);
    assert.ok(read('teamui.js').includes("'오늘 팀을 응원한 사람 수예요. 포인트로는 오르지 않아요.'"));
    // the wallet sheet: one figure, and the two cells that only show while they hold something
    const w = ui.slice(ui.indexOf('  function openWalletInfo() {'), ui.indexOf('  function openFeed() {'));
    assert.match(w, /stat\('합계', sumEl\), waitCell, ticketCell\)/);
    assert.match(w, /waitCell\.hidden = !\(wallet\.pending > 0\);/);
    assert.match(w, /ticketCell\.hidden = !tickets;/);
    // the board sheet's cells say one thing each, and the streak cell shows only while there is one
    const b = ui.slice(ui.indexOf('  function openBillboard('), ui.indexOf('  function openAdReport('));
    assert.match(b, /stHolder\.textContent = !on \? '비어 있음' :/);
    assert.match(b, /stBid\.textContent = `\$\{money\(floorOf\(slot\)\)\} 포인트`;/);
    assert.match(b, /if \(stStreak\.parentElement\) stStreak\.parentElement\.hidden = !\(days > 0\);/);
  });
  it('the same news line is told apart from a new one by its text', () => {
    assert.equal(sameNews('곰님, 위시보드에 오신 걸 환영해요!', ' 곰님,  위시보드에 오신 걸 환영해요! '), true);
    assert.equal(sameNews('곰님, 위시보드에 오신 걸 환영해요!', '쥐님, 위시보드에 오신 걸 환영해요!'), false);
    assert.equal(sameNews('', ''), false);
    assert.equal(sameNews(null, undefined), false);
  });
});

describe('the bake panel and short screens', () => {
  it('the bake panel: the title on one line, its marks under it, ✕ to leave, and the zones told by colour', () => {
    assert.match(ui, /h\('header', null, h\('div', null, h\('h3', null, \.\.\.withIcon\('fish', '황금 붕어빵 굽기'\)\), bakeMarks\),\n\s+h\('button', \{ class: 'x', type: 'button', 'aria-label': '그만 굽기', title: '그만 굽기', onclick: \(\) => stopBake\(true\) \}, icon\('close'\)\)\),/);
    assert.match(ui, /h\('div', \{ class: 'gauge' \}, needle\),/);
    assert.equal(/text: 'GOOD'|text: 'GOLD'/.test(ui), false);
    assert.equal(css.includes('.gauge .lbl'), false);
    assert.match(css, /\n\s*\.bake h3 \{ white-space: nowrap; \}/);
    assert.match(ui, /if \(bakeMarks\.textContent !== marks\) bakeMarks\.textContent = marks;/);
    // 그만 추기 on the dance strip is one line, and its taps are 44px (38px and 3px above and below)
    const x = rule('.dancebar .stop');
    assert.match(x, /white-space: nowrap;/);
    assert.equal(px(x, 'height'), 38);
    assert.match(rule('.dancebar .stop::after'), /inset: -3px 0;/);
  });
  it('the ranks sheet shows its tabs and its list on a short screen, and an empty list does not hold the sheet open', () => {
    assert.match(css, /\n\s*\.sheet\.steady \.seg \{ flex: none; \}/); // it was squeezed to 10px with a 0px list under it
    const short = css.slice(css.indexOf('@media (max-height: 520px) {\n    .sheet.steady'));
    assert.match(short, /\.sheet\.steady \{ display: block; height: auto; max-height: calc\(var\(--app-h, 100dvh\) - 20px\); overflow: auto; \}/);
    assert.match(short, /\.sheet\.steady \.ranks \{ min-height: 132px; overflow: visible; \}/);
    assert.match(css, /\.sheet\.steady:has\(\.ranks > \.note:only-child\) \{ height: auto; \}/);
  });
  it('short and wide: the claim wizard and the billboard sheet are two columns, the preview on the left', () => {
    const wide = css.slice(css.indexOf('@media (max-height: 520px) and (min-width: 640px) {'));
    assert.match(wide, /\.sheet\.wiz \.content:has\(> \.screen\) \{ display: grid; grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\);/);
    assert.match(wide, /\.sheet\.wiz \.content:has\(> \.screen\) > \.screen \{ grid-column: 1; grid-row: 1 \/ span 12; position: sticky; top: 0; margin-top: 0; \}/);
    assert.match(wide, /\.sheet\.bill \.grid2\.bb \{ display: grid; grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\);/);
    assert.match(ui, /\}, true, 'wiz'\);\n  \}\n  function pumpLink\(/); // the wizard's sheet carries the class
    // a narrow short screen: the preview is at most 120px tall, so the fields start on the first screen
    assert.match(css, /\.sheet:not\(\.bill\) \.screen canvas \{ width: auto; max-width: 100%; height: min\(120px, 28vh\); margin: 0 auto; \}/);
    assert.match(css, /\.shot-preview \{ width: auto; max-width: 100%; max-height: calc\(var\(--app-h, 100dvh\) - 200px\); margin: 0 auto; \}/);
  });
  it('a desktop window 520px tall or less (200% zoom): the identity card alone on the left, the dock one compact row', () => {
    const short = css.slice(css.indexOf('@media (max-height: 520px) {\n    html:not(.touch) .hud-l > :not(.ident)'));
    assert.match(short, /html:not\(\.touch\) \.hud-l > :not\(\.ident\) \{ display: none; \}/);
    assert.match(short, /html:not\(\.touch\) \.ident \.id-coin \{ display: flex;/);
    assert.match(short, /html:not\(\.touch\) \.dock \{ left: 50%; right: auto; bottom: calc\(10px \+ var\(--safe-b\)\); transform: translateX\(-50%\); flex-direction: row;/);
    // 640 x 380: the dock row (10 … 64px up), the 속보 line (70 … 110), the pill (116 … 154), the prompt (from 162), the notices (from 222)
    const narrow = css.slice(css.indexOf('@media (max-height: 520px) and (max-width: 640px) {\n    html:not(.touch) .news'));
    const at = (sel) => Number(narrow.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{ bottom: calc\\((\\d+)px'))[1]);
    assert.ok(at('html:not(.touch) .news') >= 10 + 54 + 6);
    assert.ok(at('html:not(.touch) .waypill') >= at('html:not(.touch) .news') + 40 + 6);
    assert.ok(at('html:not(.touch) .prompt') >= at('html:not(.touch) .waypill') + 38 + 8);
    assert.ok(at('html:not(.touch) .toasts') >= at('html:not(.touch) .prompt') + 52 + 8);
    assert.ok(380 - at('html:not(.touch) .toasts') - 44 >= 14 + 60 + 8); // under the identity card
  });
});

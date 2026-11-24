// Interface icons: one hand-drawn line set for the HUD, sheets, menus and buttons (no emoji as chrome).
// Every icon sits on a 24×24 grid inside about 3..21, stroke only. index.html styles `svg.ico`
// (size 1.25em, stroke currentColor 1.75, round caps and joins); the attributes set here are only a fallback.
// Shapes: a string is a path with absolute M/L/H/V/A/C/Q/Z commands, ['circle', cx, cy, r],
// ['rect', x, y, w, h, rx] and ['ellipse', cx, cy, rx, ry]. Small dots are circles of r 0.5–1.
// Not the 3D landmark icons: those live in ts3d/icons.js.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICONS = Object.freeze({
  // 전광판 걸기: a billboard, a wide screen with two lines of text on two legs. It was a megaphone, which next to the
  // speaker of the sound button read as a second sound button.
  board: [['rect', 3, 4, 18, 11.5, 2], 'M7 8H17', 'M7 11.5H13.5', 'M8.5 15.5V20.5', 'M15.5 15.5V20.5'],
  // megaphone: 광장 소식 only
  megaphone: ['M4 9.5H7.5L14 5V19L7.5 14.5H4Z', 'M7.5 14.5L8.8 19.5', 'M17 9.5A3.5 3.5 0 0 1 17 14.5', 'M19.5 7A7 7 0 0 1 19.5 17'],
  // shooting star: 오늘의 소원
  wish: ['M9.5 8L11.2 12.15L15.68 12.49L12.26 15.4L13.32 19.76L9.5 17.4L5.68 19.76L6.74 15.4L3.32 12.49L7.8 12.15Z', 'M13.5 8.5L20 3.5', 'M17 11L21 8', 'M11.5 6L15 3'],
  trophy: ['M8 4H16V10A4 4 0 0 1 8 10Z', 'M8 6H4.5V8A3 3 0 0 0 7.5 11', 'M16 6H19.5V8A3 3 0 0 1 16.5 11', 'M12 14V17.5', ['rect', 8.5, 17.5, 7, 3, 1]],
  crown: ['M4 8L7.5 12.5L12 6L16.5 12.5L20 8L18.5 17H5.5Z', 'M6 20H18'],
  camera: ['M3 9.5A2.5 2.5 0 0 1 5.5 7H7.5L9 4.5H15L16.5 7H18.5A2.5 2.5 0 0 1 21 9.5V17.5A2.5 2.5 0 0 1 18.5 20H5.5A2.5 2.5 0 0 1 3 17.5Z', ['circle', 12, 13, 3.5]],
  image: [['rect', 3.5, 4.5, 17, 15, 2], ['circle', 9, 9.5, 1.5], 'M3.5 16.5L8.5 12L13 16L15.5 13.5L20.5 18'],
  // a building with a lower wing: 토지 분양, 건물, 타워
  building: ['M5 21V5.5A1.5 1.5 0 0 1 6.5 4H13.5A1.5 1.5 0 0 1 15 5.5V21', 'M15 10H17.5A1.5 1.5 0 0 1 19 11.5V21', 'M3 21H21', 'M8.5 8H11.5', 'M8.5 12H11.5', 'M8.5 16H11.5'],
  gear: ['M10.4 5.6L10.75 3.09H13.25L13.6 5.6A6.6 6.6 0 0 1 15.4 6.34L17.42 4.81L19.19 6.58L17.66 8.6A6.6 6.6 0 0 1 18.4 10.4L20.91 10.75V13.25L18.4 13.6A6.6 6.6 0 0 1 17.66 15.4L19.19 17.42L17.42 19.19L15.4 17.66A6.6 6.6 0 0 1 13.6 18.4L13.25 20.91H10.75L10.4 18.4A6.6 6.6 0 0 1 8.6 17.66L6.58 19.19L4.81 17.42L6.34 15.4A6.6 6.6 0 0 1 5.6 13.6L3.09 13.25V10.75L5.6 10.4A6.6 6.6 0 0 1 6.34 8.6L4.81 6.58L6.58 4.81L8.6 6.34A6.6 6.6 0 0 1 10.4 5.6Z', ['circle', 12, 12, 3]],
  soundOn: ['M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4Z', 'M15.5 9A4 4 0 0 1 15.5 15', 'M18 6.5A7.5 7.5 0 0 1 18 17.5'],
  soundOff: ['M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4Z', 'M15.5 9.5L20.5 14.5', 'M20.5 9.5L15.5 14.5'],
  fullscreen: ['M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9', 'M15 4H18.5A1.5 1.5 0 0 1 20 5.5V9', 'M20 15V18.5A1.5 1.5 0 0 1 18.5 20H15', 'M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15'],
  fullscreenExit: ['M9 4V7.5A1.5 1.5 0 0 1 7.5 9H4', 'M15 4V7.5A1.5 1.5 0 0 0 16.5 9H20', 'M20 15H16.5A1.5 1.5 0 0 0 15 16.5V20', 'M4 15H7.5A1.5 1.5 0 0 1 9 16.5V20'],
  // diagonal corners: open the map large
  expand: ['M14 4H20V10', 'M20 4L13.5 10.5', 'M10 20H4V14', 'M4 20L10.5 13.5'],
  keyboard: [['rect', 2.5, 5.5, 19, 13, 2], ['circle', 7, 9.5, 0.5], ['circle', 10.33, 9.5, 0.5], ['circle', 13.67, 9.5, 0.5], ['circle', 17, 9.5, 0.5], ['circle', 7, 12.5, 0.5], ['circle', 10.33, 12.5, 0.5], ['circle', 13.67, 12.5, 0.5], ['circle', 17, 12.5, 0.5], 'M8.5 15.5H15.5'],
  bell: ['M6 15.5V10.5A6 6 0 0 1 18 10.5V15.5L19.5 17.5H4.5Z', 'M10 19.5A2.2 2.2 0 0 0 14 19.5'],
  map: ['M3.5 6.5L9 4.5L15 6.5L20.5 4.5V17.5L15 19.5L9 17.5L3.5 19.5Z', 'M9 4.5V17.5', 'M15 6.5V19.5'],
  pin: ['M12 21C12 21 5.5 15 5.5 10A6.5 6.5 0 0 1 18.5 10C18.5 15 12 21 12 21Z', ['circle', 12, 10, 2.5]],
  // clear the waypoint: the pin, struck through
  pinOff: ['M12 21C12 21 5.5 15 5.5 10A6.5 6.5 0 0 1 18.5 10C18.5 15 12 21 12 21Z', ['circle', 12, 10, 2.5], 'M4 4L20 20'],
  // crosshair: 내 위치
  locate: [['circle', 12, 12, 5.5], 'M12 3V6.5', 'M12 17.5V21', 'M3 12H6.5', 'M17.5 12H21', ['circle', 12, 12, 0.5]],
  // 포춘 분수 (map chip)
  fountain: ['M4.5 14H19.5', 'M5.5 14C6 17.5 8.5 19 12 19C15.5 19 18 17.5 18.5 14', 'M9 21H15', 'M12 19V21', 'M12 14V6', 'M12 6C10.5 4 7.5 4.5 7 9.5', 'M12 6C13.5 4 16.5 4.5 17 9.5'],
  // 황금 링 (map chip)
  ring: [['circle', 12, 14.5, 6], 'M9.5 6L12 3.5L14.5 6L12 8.5Z'],
  // the arrow inside the waypoint and taxi pills; points right at rotation 0
  navigate: ['M4.5 5L20 12L4.5 19L8 12Z'],
  // two overlapping coins
  coin: [['circle', 9.5, 9.5, 6], 'M15.43 8.57A6 6 0 1 1 8.57 15.43', 'M9.5 7.5V11.5'],
  heart: ['M12 20C12 20 3.5 15 3.5 9A4.5 4.5 0 0 1 12 7A4.5 4.5 0 0 1 20.5 9C20.5 15 12 20 12 20Z'],
  gift: [['rect', 4, 9, 16, 4, 1], 'M5.5 13V19.5A1 1 0 0 0 6.5 20.5H17.5A1 1 0 0 0 18.5 19.5V13', 'M12 9V20.5', 'M12 9C10.5 6.5 7.5 5 7 7C6.6 8.6 9.5 9 12 9', 'M12 9C13.5 6.5 16.5 5 17 7C17.4 8.6 14.5 9 12 9'],
  // calendar with a tick: 미션
  mission: [['rect', 4, 5.5, 16, 15, 2], 'M8 3.5V7', 'M16 3.5V7', 'M4 10H20', 'M9 15L11 17L15 13'],
  users: [['circle', 9, 8.5, 3], 'M3.5 19.5A5.5 5.5 0 0 1 14.5 19.5', 'M15.5 5.5A3 3 0 0 1 15.5 11.5', 'M17 14A5.5 5.5 0 0 1 20.5 19.5'],
  user: [['circle', 12, 8.5, 3.5], 'M5 20A7 7 0 0 1 19 20'],
  taxi: ['M4 17V13L6.5 7.5H17.5L20 13V17Z', 'M4 13H20', 'M6 17V19.5H8.5V17', 'M15.5 17V19.5H18V17', 'M10 7.5V5H14V7.5', ['circle', 7.5, 15, 0.5], ['circle', 16.5, 15, 0.5]],
  // 붕어빵: a plain fish
  fish: ['M3.5 12C6 7.5 12 6.5 16 10L20.5 7V17L16 14C12 17.5 6 16.5 3.5 12Z', 'M11 9.5A4 4 0 0 1 11 14.5', ['circle', 7.5, 11.2, 0.5]],
  music: ['M9 17.5V5.5L19 3.5V15.5', 'M9 9.5L19 7.5', ['circle', 6.5, 17.5, 2.5], ['circle', 16.5, 15.5, 2.5]],
  coffee: ['M5 9.5H16V14.5A4.5 4.5 0 0 1 11.5 19H9.5A4.5 4.5 0 0 1 5 14.5Z', 'M16 11H17.5A2.25 2.25 0 0 1 17.5 15.5H16', 'M8.5 4V6.5', 'M12.5 4V6.5'],
  // Emote dock faces (the glyph sent to other players stays the emoji in avatars.js EMOTES).
  // 대박기원: two palms pressed together, cuffs at the wrists
  pray: ['M12 4C10.6 4 9.5 5.4 9.5 7V12.2L6 15.7L8.8 18.5L12 15.3', 'M12 4C13.4 4 14.5 5.4 14.5 7V12.2L18 15.7L15.2 18.5L12 15.3', 'M12 4V15.3', 'M7.4 17.1L4.5 20', 'M16.6 17.1L19.5 20'],
  // 폭죽발사: a burst of short rays over a dotted trail
  firework: ['M12 7.3V3', 'M12 11.7V13.5', 'M14.2 9.5H18.5', 'M9.8 9.5H5.5', 'M13.56 7.94L16.6 4.9', 'M10.44 7.94L7.4 4.9', 'M13.56 11.06L16.6 14.1', 'M10.44 11.06L7.4 14.1', ['circle', 12, 17, 0.5], ['circle', 12, 20, 0.5]],
  // 만세: a figure with both arms raised
  cheer: [['circle', 12, 5.5, 2], 'M12 9.5V15', 'M12 10.5L7 6.5', 'M12 10.5L17 6.5', 'M12 15L8.5 20.5', 'M12 15L15.5 20.5'],
  // K-댄스: a figure mid-step, one arm up
  dance: [['circle', 13.5, 5, 2], 'M13 9L11.5 14.5', 'M12.8 10L17 7', 'M12.8 10L8 11.5', 'M11.5 14.5L15 17L14 20.5', 'M11.5 14.5L8 19.5'],
  smile: [['circle', 12, 12, 8.5], 'M8.5 14A4 4 0 0 0 15.5 14', ['circle', 9, 10, 0.5], ['circle', 15, 10, 0.5]],
  // 복주머니: a round bag gathered at the neck under a frill of cloth, tied with a knot whose two cord ends hang down. It replaced
  // `packet` on the pouch buttons, where an envelope read as mail (the owner: "the icon has nothing to do with a pouch").
  pouch: ['M9 10.5C5.8 11.8 4 14.2 4 16.8A3.7 3.7 0 0 0 7.7 20.5H16.3A3.7 3.7 0 0 0 20 16.8C20 14.2 18.2 11.8 15 10.5', 'M9 10.5C7.6 9 6.8 6.8 7.5 4.5C9.5 6 14.5 6 16.5 4.5C17.2 6.8 16.4 9 15 10.5', 'M8.6 10.5H15.4', ['circle', 12, 10.5, 1.2], 'M11.3 11.6L10.3 15.2', 'M12.7 11.6L13.7 15.2'],
  // 붉은 봉투 (no longer on a button: the pouch buttons use `pouch`)
  packet: [['rect', 5.5, 3.5, 13, 17, 2], 'M5.5 8L12 12L18.5 8', ['circle', 12, 12.5, 1.6]],
  // crystal ball (the 9 pm drop)
  orb: [['circle', 12, 10.5, 6.5], 'M7 19.5H17', 'M8.5 16.3L7.5 19.5', 'M15.5 16.3L16.5 19.5', 'M9 9A3.2 3.2 0 0 1 11.5 7'],
  ticket: ['M3.5 8A1.5 1.5 0 0 1 5 6.5H19A1.5 1.5 0 0 1 20.5 8V10A2 2 0 0 0 20.5 14V16A1.5 1.5 0 0 1 19 17.5H5A1.5 1.5 0 0 1 3.5 16V14A2 2 0 0 0 3.5 10Z', 'M14 6.5V17.5'],
  bolt: ['M13 3L5 13.5H11.5L10.5 21L19 10.5H12.5Z'],
  target: [['circle', 12, 12, 8.5], ['circle', 12, 12, 4.5], ['circle', 12, 12, 0.5]],
  chart: ['M4 20H20', 'M7 16V11', 'M12 16V6', 'M17 16V9'],
  news: [['rect', 4, 4, 16, 16, 2], 'M7.5 8H16.5', 'M7.5 12H11', 'M7.5 15.5H11', ['rect', 13.5, 11.5, 3, 4, 0.5]],
  key: [['circle', 8, 15.5, 4], 'M10.9 12.6L19.5 4', 'M16.5 7L19 9.5', 'M14.5 9L16.5 11'],
  briefcase: [['rect', 3.5, 7, 17, 12.5, 2], 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4H13.5A1.5 1.5 0 0 1 15 5.5V7', 'M3.5 12.5H20.5'],
  hourglass: ['M7 3.5H17', 'M7 20.5H17', 'M8 3.5C8 8 12 9.5 12 12C12 14.5 8 16 8 20.5', 'M16 3.5C16 8 12 9.5 12 12C12 14.5 16 16 16 20.5'],
  refresh: ['M19.5 12A7.5 7.5 0 1 1 17.3 6.7', 'M13.8 6.7H17.3V3.2'],
  arrowUp: ['M12 19V5', 'M6 11L12 5L18 11'],
  close: ['M6 6L18 18', 'M18 6L6 18'],
  chevronRight: ['M9 5L16 12L9 19'],
  chevronLeft: ['M15 5L8 12L15 19'],
  chevronDown: ['M5 9L12 16L19 9'],
  chevronUp: ['M5 15L12 8L19 15'],
  more: [['circle', 5.5, 12, 1], ['circle', 12, 12, 1], ['circle', 18.5, 12, 1]],
  share: ['M12 3.5V14.5', 'M8 7.5L12 3.5L16 7.5', 'M8.5 10.5H6.5A1.5 1.5 0 0 0 5 12V19A1.5 1.5 0 0 0 6.5 20.5H17.5A1.5 1.5 0 0 0 19 19V12A1.5 1.5 0 0 0 17.5 10.5H15.5'],
  link: ['M10.5 7.5L12.2 5.8A4.25 4.25 0 0 1 18.2 11.8L16.5 13.5', 'M13.5 16.5L11.8 18.2A4.25 4.25 0 0 1 5.8 12.2L7.5 10.5', 'M9.5 14.5L14.5 9.5'],
  copy: [['rect', 8.5, 8.5, 12, 12, 2], 'M15.5 8.5V5.5A2 2 0 0 0 13.5 3.5H5.5A2 2 0 0 0 3.5 5.5V13.5A2 2 0 0 0 5.5 15.5H8.5'],
  edit: ['M4 20L4.8 16.2L15.8 5.2A2.15 2.15 0 0 1 18.8 8.2L7.8 19.2Z', 'M13.8 7.2L16.8 10.2'],
  trash: ['M4.5 7H19.5', 'M9.5 7V5A1 1 0 0 1 10.5 4H13.5A1 1 0 0 1 14.5 5V7', 'M6.5 7L7.4 19.1A1.5 1.5 0 0 0 8.9 20.5H15.1A1.5 1.5 0 0 0 16.6 19.1L17.5 7', 'M10 11V16.5', 'M14 11V16.5'],
  flag: ['M5.5 21V4', 'M5.5 4.5H17L14.5 9L17 13.5H5.5'],
  lock: [['rect', 5, 10.5, 14, 10, 2], 'M8 10.5V7.5A4 4 0 0 1 16 7.5V10.5', 'M12 14.5V16.5'],
  clock: [['circle', 12, 12, 8.5], 'M12 7.5V12L15 14'],
  info: [['circle', 12, 12, 8.5], 'M12 11V16.5', ['circle', 12, 7.8, 0.5]],
  warning: ['M12 4L21 19.5H3Z', 'M12 10V14', ['circle', 12, 16.8, 0.5]],
  plus: ['M12 5V19', 'M5 12H19'],
  minus: ['M5 12H19'],
  check: ['M5 12.5L10 17.5L19 7'],
  checkCircle: [['circle', 12, 12, 8.5], 'M8 12.3L10.8 15L16 9.5'],
  // an open mission step (the empty partner of checkCircle)
  todo: [['circle', 12, 12, 8.5]],
  // 화면만 보기 on a phone, and (struck through) 화면 다시 보기
  eye: ['M2.5 12C5 7.5 8.3 5.5 12 5.5C15.7 5.5 19 7.5 21.5 12C19 16.5 15.7 18.5 12 18.5C8.3 18.5 5 16.5 2.5 12Z', ['circle', 12, 12, 3]],
  eyeOff: ['M2.5 12C5 7.5 8.3 5.5 12 5.5C15.7 5.5 19 7.5 21.5 12C19 16.5 15.7 18.5 12 18.5C8.3 18.5 5 16.5 2.5 12Z', ['circle', 12, 12, 3], 'M4 4L20 20'],
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

const SHAPE_ATTRS = { circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx'], ellipse: ['cx', 'cy', 'rx', 'ry'] };

// One shape as [tag, { attr: value }]. Exported for the tests, which check the geometry without a DOM.
export function shapeOf(s) {
  if (typeof s === 'string') return ['path', { d: s }];
  const [tag, ...nums] = s;
  const names = SHAPE_ATTRS[tag];
  const attrs = {};
  if (names) names.forEach((n, i) => { if (nums[i] != null) attrs[n] = String(nums[i]); });
  return [tag, attrs];
}

// icon('trophy') → <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">…</svg>. opts.class adds classes,
// opts.label makes it a labelled image instead of decoration. An unknown name gives an empty span and never throws.
export function icon(name, opts = {}) {
  const shapes = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null;
  if (!shapes || typeof document === 'undefined') {
    if (typeof document === 'undefined') return null;
    const span = document.createElement('span');
    span.className = 'ico ico-missing';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', opts.class ? `ico ${opts.class}` : 'ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (opts.label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', String(opts.label));
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-icon', name);
  for (const s of shapes) {
    const [tag, attrs] = shapeOf(s);
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

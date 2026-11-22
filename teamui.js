// 응원 팀과 명당 sheets (docs/prime-screens.md): my team, a team's public page, the prime screen sheet and the 응원 순위 lists. Browser only
// (ui.js imports it with ?v=). What counts and how the prime screens are shared come from primerules.js, the same rules the Worker uses.
// k: what ui.js hands over: h, icon, withIcon, openSheet, closeSheet, note, sendLink, hooks (teamMe, teamPage, teamOp, teamRanks, prime,
// isGuest, openLogin, focusShot, slotName, openRanks).
import { PRIME, SCREENS, isPrime, kstDay, primeAt, primeCard, teamSlots, slotLine, goalOf, nextGoal, GOAL_NAME, GOAL_PRIZE, pct, mdOk, mdText, nameFault, TEAM_ERR, WHY_CHIP } from './primerules.js';
import { nowMs } from './live.js';

const CSS = `
.team-hero { display: grid; gap: 4px; padding: 14px; border-radius: 14px; background: linear-gradient(135deg, rgba(255,176,32,.16), rgba(28,36,64,.9)); border: 1px solid var(--line); }
.team-hero .tn { font: 800 22px/1.2 var(--font); color: var(--text); overflow-wrap: anywhere; }
.team-hero .ts { font-size: 12px; font-weight: 700; color: var(--muted); }
.team-count { display: flex; align-items: baseline; gap: 6px; margin-top: 6px; }
.team-count b { font: 800 30px/1 var(--font); color: var(--accent); font-variant-numeric: tabular-nums; }
.team-count span { font-size: 13px; font-weight: 700; color: var(--text-2, var(--text)); }
.goal-track { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
.goal-step { padding: 8px 6px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); text-align: center; min-width: 0; }
.goal-step b { display: block; font: 800 14px/1.1 var(--font); font-variant-numeric: tabular-nums; }
.goal-step small { display: block; margin-top: 3px; font-size: 11px; font-weight: 700; color: var(--muted); line-height: 1.25; }
.goal-step.on { border-color: var(--accent); background: rgba(255,176,32,.14); }
.goal-step.on b { color: var(--accent); }
.goal-bar { position: relative; height: 8px; margin-top: 10px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
.goal-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: var(--accent); }
.team-line { margin: 8px 0 0; font-size: 13px; font-weight: 700; line-height: 1.45; }
.team-why { margin: 6px 0 0; font-size: 12px; line-height: 1.45; color: var(--muted); }
.team-why.ok { color: var(--ok); }
.team-cheer { width: 100%; min-height: 52px; margin-top: 12px; font-size: 16px; }
.team-list { display: grid; gap: 6px; margin-top: 6px; }
.team-row { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); min-width: 0; }
.team-row .n { width: 22px; flex: none; color: var(--muted); font-weight: 800; font-variant-numeric: tabular-nums; }
.team-row b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.team-row .v { flex: none; font-size: 12px; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; }
.team-row .mini { flex: none; }
.team-row.me { border-color: var(--accent); }
.team-sec { margin: 16px 0 4px; font-size: 13px; font-weight: 800; color: var(--text); }
.team-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 99px; font-size: 11px; font-weight: 800; color: #1b1300; background: var(--accent); }
.team-form { display: grid; gap: 8px; margin-top: 8px; }
.team-form .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.team-rules { margin-top: 14px; }
.team-rules li { margin: 4px 0; font-size: 12px; line-height: 1.45; color: var(--text-2, var(--text)); }
.prime-now .team-chip { justify-self: start; }
.team-row.wrap b { white-space: normal; overflow: visible; line-height: 1.4; padding: 4px 0; }
.prime-now { display: grid; gap: 6px; padding: 14px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); }
.prime-now .tn { font: 800 20px/1.2 var(--font); overflow-wrap: anywhere; }
`;
let styled = false;
function style() { if (styled || typeof document === 'undefined') return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); }
const TOMORROW = { small: '코너 아래 화면 하루', big: '코너 위 큰 화면 하루', tower: '메인 타워 1시간' };
const num = (n) => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('ko-KR');
const dayText = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ''; };
const PAST = { small: (n) => `서로 다른 ${num(n)}명 · 작은 명당`, big: (n) => `서로 다른 ${num(n)}명 · 큰 화면`, tower: (n) => `서로 다른 ${num(n)}명 · 메인 타워 1시간`, hot: (n) => `참여율 ${num(n)}% · 가장 뜨거운 팀`, ann: () => '기념일 메인 타워', gold: (n) => `9시 전까지 ${num(n)}명 · 밤 9시 메인 타워` };
export const TEAM_RULES = [
  '하루(한국 시간 0시~24시)에 서로 다른 30명이 응원하면 다음 날 코너 아래 화면, 100명이면 코너 위 큰 화면, 1,000명이면 메인 타워 1시간이 돌아가요. 여러 팀이 함께 채우면 화면을 1분씩 번갈아 써요.',
  '오늘 응원한 팀원 ÷ 최근 7일 동안 응원한 팀원이 참여율이에요. 그런 팀원이 10명 이상인 팀만 매기고, 하루 1위 팀은 다음 날 1번 코너 위 큰 화면을 하루 종일 써요.',
  '오늘 밤 9시 전까지 서로 다른 사람이 가장 많이 응원한 팀(10명 이상)이 21:00~22:00 메인 타워에 올라요.',
  '운영자가 승인한 팀 기념일에는 메인 타워 정시 1분이 돌아가요(그날 기념일 팀끼리 번갈아).',
  '응원은 한 사람이 하루 한 번, 들어간 팀 하나에만 해요. 계정을 연결하고 3일이 지난 사람만, 같은 인터넷 연결에서는 팀마다 하루 한 명만 세요.',
  '명당은 포인트나 돈으로 살 수 없어요. 어떤 결제도 응원 수, 참여율, 순위에 들어가지 않아요.',
];

export function createTeamUI(k) {
  style();
  const { h, icon, withIcon, openSheet, closeSheet, note, sendLink, hooks } = k;
  const ic = (name, text) => (withIcon ? withIcon(name, text) : [text]);
  const rules = () => h('details', { class: 'more team-rules' }, h('summary', { text: '명당은 이렇게 돌아가요' }), h('ul', null, ...TEAM_RULES.map((t) => h('li', { text: t }))));
  const loading = (text = '불러오는 중…') => h('p', { class: 'note', text });
  const fail = (box, e) => box.replaceChildren(h('p', { class: 'note', text: e?.message || TEAM_ERR.down }));
  const shareUrl = (id) => location.origin + '/t/' + id;
  async function share(t, into) {
    const n = Math.floor(Number(t.today?.n) || 0), ng = t.today?.next;
    const text = `${t.name} 응원 팀 · 오늘 서로 다른 ${num(n)}명이 응원했어요${ng ? ` · ${num(ng.at)}명까지 ${num(ng.left)}명` : ''}. 함께 응원하면 가상 타임스퀘어 명당에 팀 이름이 걸려요.`;
    if (await sendLink({ kind: 'team', text, url: shareUrl(t.id), title: `${t.name} 응원 팀 · WISH BOARD`, native: true, into }) === 'copied') note('팀 링크를 복사했어요', 'ok');
  }
  // Goal progress: the three goals as steps (reached ones lit) and a bar to the next one.
  function goals(n) {
    const G = PRIME.goals, next = nextGoal(n);
    const step = (g, label) => h('div', { class: 'goal-step' + (n >= G[g] ? ' on' : '') }, h('b', { text: num(G[g]) + '명' }), h('small', { text: label }));
    const from = next ? (next.goal === 'small' ? 0 : next.goal === 'big' ? G.small : G.big) : G.tower;
    const frac = next ? Math.max(0, Math.min(1, (n - from) / (next.at - from))) : 1;
    return [h('div', { class: 'goal-track' }, step('small', '코너 아래 화면'), step('big', '코너 위 큰 화면'), step('tower', '메인 타워 1시간')),
      h('div', { class: 'goal-bar', 'aria-hidden': 'true' }, h('i', { style: { width: Math.round(frac * 100) + '%' } })),
      h('p', { class: 'team-line', text: next ? `${num(next.at)}명까지 ${num(next.left)}명 남았어요 · 채우면 ${GOAL_PRIZE[next.goal]}` : '오늘 메인 타워 목표까지 채웠어요 · 내일 메인 타워 1시간' })];
  }
  function rateLine(t) {
    const act = Math.floor(Number(t.today?.act) || 0);
    return t.today?.rate != null ? `참여율 ${pct(t.today.rate)} · 최근 7일 응원한 ${num(act)}명 가운데 오늘 ${num(t.today.n)}명` : `참여율은 최근 7일 동안 응원한 팀원이 ${PRIME.minTeam}명 이상일 때 매겨요(지금 ${num(act)}명)`;
  }
  // The public part of a team page: anyone may see it (transparency). mine: { role, today, guest } when it is my team.
  function teamBody(t, mine, box, rerender) {
    const kids = [];
    kids.push(h('div', { class: 'team-hero' },
      h('div', { class: 'tn', text: t.name }),
      h('div', { class: 'ts', text: `팀원 ${num(t.members)}명${mine ? (mine.role === 'owner' ? ' · 내가 만든 팀' : ' · 내 팀') : ''}` }),
      h('div', { class: 'team-count' }, h('b', { text: num(t.today?.n) }), h('span', { text: '명이 오늘 응원했어요 (서로 다른 사람)' })),
    ));
    kids.push(...goals(Math.floor(Number(t.today?.n) || 0)));
    kids.push(h('p', { class: 'team-why', text: rateLine(t) }));
    if (mine) kids.push(cheerBox(t, mine, rerender));
    // Where the team shows today, and what today has already earned for tomorrow.
    const slots = Array.isArray(t.slots) ? t.slots : [];
    kids.push(h('div', { class: 'team-sec', text: '오늘 이 팀이 걸린 명당' }));
    kids.push(slots.length ? h('div', { class: 'team-list' }, ...slots.map((s) => h('div', { class: 'team-row wrap' }, h('span', { class: 'team-chip', text: WHY_CHIP[s.why] || '명당' }), h('b', { class: '', text: slotLine(s) }),
      h('button', { class: 'chip mini', type: 'button', text: '보기', onclick: () => { closeSheet(); hooks.focusShot?.(s.slot || 'MAIN_TOP'); } }))))
      : h('p', { class: 'note', text: '오늘은 걸린 명당이 없어요. 어제 목표를 채우면 오늘 걸려요.' }));
    const goal = goalOf(t.today?.n);
    kids.push(h('p', { class: 'team-why' + (goal ? ' ok' : ''), text: goal ? `내일 명당 확정: ${TOMORROW[goal]} (오늘 서로 다른 ${num(PRIME.goals[goal])}명을 넘었어요)` : `내일 명당은 오늘 0시~24시에 서로 다른 ${PRIME.goals.small}명 이상이 응원하면 정해져요.` }));
    kids.push(h('div', { class: 'team-sec', text: '지난 기록' }));
    const past = Array.isArray(t.past) ? t.past : [];
    kids.push(past.length ? h('div', { class: 'team-list' }, ...past.slice(0, 12).map((x) => h('div', { class: 'team-row wrap' }, h('span', { class: 'team-chip', text: WHY_CHIP[x.kind] || '기록' }), h('b', { text: `${dayText(x.d)} · ${(PAST[x.kind] || (() => x.kind))(x.n)}` })))) : h('p', { class: 'note', text: '아직 기록이 없어요.' }));
    if (t.ann) kids.push(h('p', { class: 'team-why', text: `기념일 ${mdText(t.ann.md)}${t.ann.label ? ' · ' + t.ann.label : ''} · ${t.ann.st === 'ok' ? '승인됨: 그날 메인 타워 정시 1분' : t.ann.st === 'wait' ? '운영자 확인 중' : '승인되지 않았어요'}` }));
    if (mine?.role === 'owner') kids.push(annForm(t, rerender));
    const copyBox = h('div', { class: 'manual-copy', hidden: true });
    kids.push(h('button', { class: 'btn gold', type: 'button', style: { width: '100%', marginTop: '14px' }, onclick: () => share(t, copyBox) }, ...ic('share', '팀 링크 보내기')), copyBox);
    kids.push(h('p', { class: 'team-why', text: '팀 이름은 응원하는 대상을 나타내는 이름표예요. 아이돌 이름은 쓸 수 있지만 사진·로고는 올리지 않아요. 팀은 돈을 모으거나 맡지 않아요.' }));
    kids.push(rules());
    box.replaceChildren(...kids);
  }
  // My cheer of the day: one per person, for my team. Guests and young accounts are recorded but not counted; the line says why.
  function cheerBox(t, mine, rerender) {
    const line = h('p', { class: 'team-why', role: 'status' });
    const btn = h('button', { class: 'btn primary team-cheer', type: 'button' });
    const say = (text, ok) => { line.textContent = text || ''; line.className = 'team-why' + (ok ? ' ok' : ''); };
    const today = mine.today;
    const done = !!today && today.here !== false;
    btn.disabled = done;
    btn.replaceChildren(...ic(done ? 'checkCircle' : 'heart', done ? '오늘 응원했어요' : '오늘 우리 팀 응원하기'));
    if (done) say(today.counted ? '오늘 응원이 세어졌어요. 내일 0시(한국 시간)에 다시 할 수 있어요' : whyText(today.why), today.counted);
    else if (mine.guest) say('손님도 응원할 수 있지만 세지는 않아요. 계정을 연결하고 3일이 지나면 세어져요.');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.replaceChildren(...ic('hourglass', '응원하는 중…'));
      try {
        const r = await hooks.teamOp?.({ op: 'cheer' });
        say(r?.line || '', !!r?.counted);
        btn.replaceChildren(...ic('checkCircle', '오늘 응원했어요'));
        if (r?.counted) note(`${t.name} 팀 응원이 세어졌어요 · 오늘 ${num(r.n)}명`, 'ok');
        setTimeout(() => rerender?.(), 900);
      } catch (e) { btn.disabled = false; btn.replaceChildren(...ic('heart', '오늘 우리 팀 응원하기')); say(e?.message || TEAM_ERR.down); }
    });
    const kids = [btn, line];
    if (mine.guest) kids.push(h('button', { class: 'btn ghost', type: 'button', style: { width: '100%', marginTop: '6px' }, onclick: () => hooks.openLogin?.() }, ...ic('user', '계정 연결하고 응원이 세어지게 하기')));
    return h('div', null, ...kids);
  }
  const whyText = (why) => ({ guest: '손님 응원이라 기록만 하고 세지 않았어요. 계정을 연결하고 3일이 지나면 세어져요', young: '가입하고 3일이 지나지 않아 세지 않았어요', net: '같은 인터넷 연결에서 오늘 이 팀을 응원한 사람이 이미 있어서 세지 않았어요', wait: '계정을 확인하지 못해 세지 않았어요', ok: '오늘 응원이 세어졌어요' }[why] || '오늘은 이미 응원했어요');
  // The owner asks for one anniversary (a month-day and a label); the operator approves it (admin 응원 팀).
  function annForm(t, rerender) {
    const month = h('select', { class: 'input', 'aria-label': '기념일 달' }, ...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0'), text: (i + 1) + '월' })));
    const day = h('select', { class: 'input', 'aria-label': '기념일 날' }, ...Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1).padStart(2, '0'), text: (i + 1) + '일' })));
    if (t.ann?.md) { month.value = t.ann.md.slice(0, 2); day.value = t.ann.md.slice(3, 5); }
    const label = h('input', { class: 'input', maxLength: PRIME.labelMax, placeholder: '예: 데뷔 기념일, ○○ 생일', value: t.ann?.label || '', 'aria-label': '기념일 이름' });
    const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
    const go = h('button', { class: 'btn ghost', type: 'button', text: t.ann ? '기념일 다시 신청하기' : '기념일 신청하기' });
    go.addEventListener('click', async () => {
      const md = month.value + '-' + day.value;
      err.hidden = true;
      if (!mdOk(md)) { err.textContent = TEAM_ERR.md; err.hidden = false; return; }
      if (label.value.trim() && nameFault(label.value, PRIME.labelMax)) { err.textContent = TEAM_ERR.label; err.hidden = false; return; }
      go.disabled = true;
      try { await hooks.teamOp?.({ op: 'anniv', md, label: label.value.trim() }); note('기념일을 신청했어요. 운영자가 확인하면 그날 메인 타워 정시 1분이 돌아가요', 'ok'); rerender?.(); }
      catch (e) { err.textContent = e?.message || TEAM_ERR.down; err.hidden = false; go.disabled = false; }
    });
    return h('details', { class: 'more' }, h('summary', { text: '팀 기념일 (만든 사람만)' }),
      h('div', { class: 'team-form' }, h('div', { class: 'two' }, month, day), label, go, err,
        h('p', { class: 'team-why', text: '한 팀에 하나예요. 승인되면 매년 그날 메인 타워 정시 1분이 돌아가요. 하루에 23팀까지예요.' })));
  }
  // A list of teams with a 보기 button (rankings, search results).
  function rows(list, value, mineId = '') {
    return h('div', { class: 'team-list' }, ...list.map((r, i) => h('div', { class: 'team-row' + (r.id === mineId ? ' me' : '') },
      h('span', { class: 'n', text: String(r.rank || i + 1) }), h('b', { text: r.name }), h('span', { class: 'v', text: value(r) }),
      h('button', { class: 'chip mini', type: 'button', text: '보기', onclick: () => openTeam(r.id) }))));
  }
  // No team yet: what a team is, find one, today's top teams, make one (accounts only).
  function discover(box, me, rerender) {
    const find = h('input', { class: 'input', type: 'search', maxLength: 16, placeholder: '팀 이름으로 찾기', 'aria-label': '팀 이름으로 찾기' });
    const found = h('div');
    const top = h('div', null, loading());
    let timer = 0;
    find.addEventListener('input', () => { clearTimeout(timer); const q = find.value.trim(); if (!q) { found.replaceChildren(); return; }
      timer = setTimeout(async () => { try { const r = await hooks.teamRanks?.(q); const list = r?.found || []; found.replaceChildren(list.length ? rows(list, (x) => `팀원 ${num(x.members)}`) : h('p', { class: 'note', text: '그 이름의 팀이 없어요. 새로 만들 수 있어요.' })); } catch (e) { fail(found, e); } }, 350); });
    const name = h('input', { class: 'input', maxLength: PRIME.nameMax, placeholder: '팀 이름 (16자) 예: ○○ 응원단, 망원동 친구들', 'aria-label': '팀 이름' });
    const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
    const make = h('button', { class: 'btn gold', type: 'button', style: { width: '100%' } }, ...ic('plus', '응원 팀 만들기'));
    make.addEventListener('click', async () => {
      err.hidden = true;
      const f = nameFault(name.value); if (f) { err.textContent = TEAM_ERR[f]; err.hidden = false; return; }
      make.disabled = true;
      try { await hooks.teamOp?.({ op: 'create', name: name.value }); note('응원 팀을 만들었어요. 팀 링크를 보내 함께 응원해요', 'ok'); rerender?.(); }
      catch (e) { err.textContent = e?.message || TEAM_ERR.down; err.hidden = false; make.disabled = false; }
    });
    const guest = !!me?.guest;
    box.replaceChildren(...[ // replaceChildren writes a null out as the text "null", so the empty branches are dropped
      h('p', { class: 'team-line', text: '응원 팀은 팬덤, 동네, 친구 모임이에요. 하루에 서로 다른 30명이 응원하면 다음 날 명당(코너 화면, 메인 타워)에 팀 이름이 걸려요. 사람 수로만 정하고, 포인트로는 살 수 없어요.' }),
      me?.hopAt ? h('p', { class: 'team-why', text: `팀을 나온 지 24시간이 지나면 다른 팀에 들어갈 수 있어요 · ${new Date(me.hopAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}부터` }) : null,
      h('div', { class: 'team-sec', text: '팀 찾기' }), find, found,
      h('div', { class: 'team-sec', text: '오늘 응원이 많은 팀' }), top,
      h('div', { class: 'team-sec', text: '새 팀 만들기' }),
      guest ? h('p', { class: 'team-why', text: TEAM_ERR.link }) : h('div', { class: 'team-form' }, name, make, err),
      guest ? h('button', { class: 'btn ghost', type: 'button', style: { width: '100%' }, onclick: () => hooks.openLogin?.() }, ...ic('user', '계정 연결하기')) : null,
      rules()].filter(Boolean));
    hooks.teamRanks?.('').then((r) => { const list = (r?.today || []).slice(0, 10); top.replaceChildren(list.length ? rows(list, (x) => `${num(x.n)}명`) : h('p', { class: 'note', text: '오늘은 아직 응원한 팀이 없어요. 첫 팀이 되어 보세요.' })); }).catch((e) => fail(top, e));
  }
  /** My team (or how to find / make one). */
  function openTeams() {
    style();
    openSheet(['users', '응원 팀'], null, (host) => {
      const box = h('div', null, loading());
      host.append(box);
      let alive = true;
      const render = async () => {
        let me;
        try { me = await hooks.teamMe?.(); } catch (e) { if (alive) fail(box, e); return; }
        if (!alive) return;
        hooks.teamName?.(me?.team?.name || '');
        if (!me?.team) { discover(box, me, render); return; }
        teamBody(me.team, { role: me.role, today: me.today, guest: !!me.guest }, box, render);
        const leave = h('button', { class: 'btn ghost', type: 'button', style: { width: '100%', marginTop: '10px' }, text: '팀에서 나가기' });
        let armed = false;
        leave.addEventListener('click', async () => {
          if (!armed) { armed = true; leave.textContent = '한 번 더 누르면 나가요 · 24시간 동안 다른 팀에 못 들어가요'; return; }
          leave.disabled = true;
          try { await hooks.teamOp?.({ op: 'leave' }); note('팀에서 나왔어요', 'ok'); render(); } catch (e) { note(e?.message || TEAM_ERR.down, 'err'); leave.disabled = false; }
        });
        box.append(leave);
      };
      render();
      return () => { alive = false; };
    }, false, '', { kind: 'team' });
  }
  /** A team's public page (a shared link, a ranking row). Join when I have no team; my own team opens as mine. */
  function openTeam(id) {
    style();
    openSheet(['users', '응원 팀'], null, (host) => {
      const box = h('div', null, loading());
      host.append(box);
      let alive = true;
      const render = async () => {
        let page, me = null;
        try { [page, me] = await Promise.all([hooks.teamPage?.(id), hooks.teamMe?.().catch(() => null)]); } catch (e) { if (alive) fail(box, e); return; }
        if (!alive) return;
        const t = page?.team; if (!t) { box.replaceChildren(h('p', { class: 'note', text: TEAM_ERR.team })); return; }
        const mineTeam = me?.team?.id === t.id;
        teamBody(mineTeam ? me.team : t, mineTeam ? { role: me.role, today: me.today, guest: !!me.guest } : null, box, render);
        if (mineTeam) return;
        const err = h('p', { class: 'note login-err', role: 'alert', hidden: true });
        const join = h('button', { class: 'btn primary team-cheer', type: 'button' }, ...ic('plus', `${t.name} 팀에 들어가기`));
        if (me?.team) { join.disabled = true; join.replaceChildren(...ic('info', `지금 내 팀은 ${me.team.name}이에요 · 한 번에 한 팀만`)); }
        else if (me?.hopAt) { join.disabled = true; join.replaceChildren(...ic('hourglass', '팀을 나온 지 24시간 뒤에 들어갈 수 있어요')); }
        join.addEventListener('click', async () => {
          join.disabled = true; err.hidden = true;
          try { await hooks.teamOp?.({ op: 'join', id: t.id }); note(`${t.name} 팀에 들어왔어요. 오늘 응원해 주세요`, 'ok'); render(); }
          catch (e) { err.textContent = e?.message || TEAM_ERR.down; err.hidden = false; join.disabled = false; }
        });
        box.prepend(join, err);
      };
      render();
      return () => { alive = false; };
    }, false, '', { kind: 'team' });
  }
  /** A prime screen: who is on it now, its turns today, and how it is earned. Never a claim form. */
  function openPrime(slot) {
    style();
    const name = hooks.slotName?.(slot) || slot;
    openSheet(['trophy', '명당'], name, (host) => {
      const plan = hooks.prime?.() || null, t = nowMs(), e = primeAt(plan, slot, t), card = e ? primeCard(e) : null;
      const now = e && !e.wait ? h('div', { class: 'prime-now' }, h('span', { class: 'team-chip', text: card.chip }), h('div', { class: 'tn', text: e.name }), h('p', { class: 'team-why', text: card.sub }),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => openTeam(e.id) }, ...ic('users', '이 팀 보기')))
        : h('div', { class: 'prime-now' }, h('div', { class: 'tn', text: e?.wait ? '9시 주인공을 정하는 중이에요' : '지금은 이 화면에 걸린 팀이 없어요' }), h('p', { class: 'team-why', text: '응원 팀이 목표를 채우면 다음 날 이 화면이 돌아가요. 그사이에는 오늘의 소원과 안내가 보여요.' }));
      const kind = String(slot).startsWith('MAIN_') ? 'tower' : SCREENS.big.includes(slot) ? 'big' : 'small';
      const lines = [];
      if (plan && plan.day === kstDay(t)) {
        if (kind === 'tower') {
          if (plan.gold) lines.push(`21:00~22:00 · 밤 9시 주인공 ${plan.names?.[plan.gold.id] || ''}`); else lines.push('21:00~22:00 · 밤 9시 주인공 (오늘 9시 전까지 응원이 가장 많은 팀)');
          for (const s of plan.tower || []) lines.push(`${slotLine({ why: 'tower', a: s.a, b: s.b }).replace('메인 타워 · ', '')} · ${plan.names?.[s.id] || ''}`);
          for (const a of plan.ann || []) lines.push(`${a.hours.map((x) => x + '시').join(', ')} 정시 1분 · ${plan.names?.[a.id] || ''} 기념일`);
        } else {
          const i = (kind === 'big' ? SCREENS.big : SCREENS.small).indexOf(slot), list = (kind === 'big' ? plan.big : plan.small)?.[i] || [];
          if (slot === SCREENS.hot && plan.hot) lines.push(`하루 종일 · 가장 뜨거운 팀 ${plan.names?.[plan.hot.id] || ''} (어제 참여율 ${pct(plan.hot.rate)})`);
          else if (list.length) lines.push(`하루 종일 · ${list.map((x) => plan.names?.[x] || '').join(', ')}${list.length > 1 ? ` (${list.length}팀이 1분씩)` : ''}`);
        }
      }
      host.append(now,
        h('div', { class: 'team-sec', text: '오늘 이 화면' }),
        lines.length ? h('div', { class: 'team-list' }, ...lines.map((x) => h('div', { class: 'team-row wrap' }, h('b', { text: x })))) : h('p', { class: 'note', text: '오늘은 이 화면에 걸린 팀이 없어요.' }),
        h('p', { class: 'team-line', text: kind === 'tower' ? '메인 타워는 하루에 서로 다른 1,000명이 응원한 팀이 다음 날 1시간씩 쓰고, 밤 9시는 그날 9시 전까지 응원이 가장 많은 팀이 써요.' : kind === 'big' ? '코너 위 큰 화면은 하루에 서로 다른 100명이 응원한 팀과 가장 뜨거운 팀(참여율 1위)이 다음 날 써요.' : '코너 아래 화면은 하루에 서로 다른 30명이 응원한 팀이 다음 날 써요.' }),
        h('p', { class: 'team-why', text: '명당은 포인트로 걸 수 없고, 어떤 결제도 응원 수에 들어가지 않아요.' }),
        h('div', { class: 'team-form' },
          h('button', { class: 'btn gold', type: 'button', onclick: () => openTeams() }, ...ic('users', '응원 팀 보기')),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => hooks.openRanks?.('today') }, ...ic('trophy', '응원 순위'))),
        rules());
    }, true, '', { kind: 'prime' });
  }
  // 응원 순위 tabs for the 🏆 sheet: today by distinct supporters, participation, this week's goals. -> fills `list` and returns the note.
  async function rankInto(list, tab) {
    list.replaceChildren(loading());
    let r; try { r = await hooks.teamRanks?.(''); } catch (e) { fail(list, e); return ''; }
    const pick = tab === 'rate' ? r?.rate : tab === 'week' ? r?.week : r?.today;
    const rowsOf = Array.isArray(pick) ? pick : [];
    const value = tab === 'rate' ? (x) => pct(x.rate) : tab === 'week' ? (x) => `${num(x.k)}번` : (x) => `${num(x.n)}명`;
    list.replaceChildren(rowsOf.length ? rows(rowsOf, value, hooks.myTeamId?.() || '') : h('p', { class: 'note', text: tab === 'rate' ? `참여율은 최근 7일 응원한 팀원이 ${PRIME.minTeam}명 이상인 팀만 매겨요. 아직 그런 팀이 없어요.` : tab === 'week' ? '이번 주에는 아직 목표를 채운 팀이 없어요.' : '오늘은 아직 응원한 팀이 없어요.' }));
    return tab === 'rate' ? '오늘 응원한 팀원 ÷ 최근 7일 동안 응원한 팀원. 하루 1위는 다음 날 1번 코너 위 큰 화면을 하루 종일 써요.'
      : tab === 'week' ? '월요일 0시(한국 시간)부터 이번 주에 팀이 채운 목표(30·100·1,000명, 가장 뜨거운 팀, 밤 9시)의 수예요.'
        : '오늘 0시(한국 시간)부터 팀을 응원한 서로 다른 사람의 수예요(계정 연결 3일 이상, 같은 인터넷 연결은 팀마다 한 명). 포인트로는 오르지 않아요.';
  }
  return { openTeams, openTeam, openPrime, rankInto, isPrime };
}


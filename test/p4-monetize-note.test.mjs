import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { it } from 'node:test';

const path = new URL('../docs/superpowers/specs/2026-11-15-monetize-legal-note.md', import.meta.url);

it('the monetize note is a checklist and not product code', () => {
  const text = readFileSync(path, 'utf8');
  for (const heading of ['# 유료화 전 메모', '## 코인 상점', '## 법무 확인', '## 하지 않는 것']) {
    assert.equal(text.includes(heading), true, heading);
  }
  assert.match(text, /hat_ribbon[\s\S]*400/);
  assert.match(text, /cab_yellow[\s\S]*800/);
  assert.match(text, /frame_streak[\s\S]*600/);
  assert.match(text, /시즌 패스[\s\S]*2,000/);
  assert.match(text, /reason `pass`/);
  assert.equal(text.includes('PLAN=paid'), false);
  assert.equal(text.includes('service_role'), false);
  assert.match(text, /슬롯은 현금으로 팔지 않는다/);
  assert.match(text, /## 착수 조건/);
  assert.match(text, /ret\[1\] \/ new >= 0\.35/);
  assert.match(text, /ret\[7\] \/ new >= 0\.15/);
  assert.match(text, /ret\[30\] \/ new >= 0\.06/);
  assert.match(text, /focus_new \/ share_accounts >= 0\.3/);
  assert.match(text, /분모가 0이면 데이터 없음/);
});

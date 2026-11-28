// The share pages of a plaza board (/rt/card/<slot>) and a wish (/rt/w/<id>), rendered by the Worker (worker.js cardPage, wishPage): the
// link-preview tags as before, then a page of their own that opens without the 3D plaza: the board or wish drawn as a card in HTML (the
// gift card's colours), 3D 광장에서 보기 (the address the page used to jump to), 공유하기, 나도 만들기 (/gift), and the friends line when there
// is one. Nothing moves by itself (2026-11-27: the page used to refresh straight into the plaza). Everything people wrote is escaped; the one
// inline script reads the share words from the button's data attributes, never from the markup around it.
// Server and browser safe (no I/O); worker.js imports it with no query.
const MAKE = /^\/gift(\?[\w=&-]*)?$/; // 나도 만들기: the maker, with the link's own query (inv, pref) and nothing else
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = ':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(900px 520px at 85% -10%,#3a1150 0%,transparent 60%),radial-gradient(800px 600px at -10% 10%,#14205a 0%,transparent 55%),#07061a;color:#f3f1ff;font:15px/1.55 "Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;word-break:keep-all;overflow-wrap:break-word}'
  + 'main{max-width:520px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom))}'
  + '.top{display:flex;justify-content:space-between;align-items:center;padding:4px 0 12px}.brand{display:inline-flex;align-items:center;min-height:44px;font-weight:900;font-size:13px;letter-spacing:.08em;color:#ffe9a8;text-decoration:none}.brand small{color:#adabce;font-weight:700;font-size:12px;letter-spacing:0;margin-left:6px}'
  + '.card{aspect-ratio:16/9;border-radius:22px;padding:12px 16px 18px;display:flex;flex-direction:column;text-align:center;background:linear-gradient(135deg,#ff4fa3,#5b21ff);box-shadow:inset 0 0 0 3px rgba(255,224,138,.8),0 18px 40px rgba(0,0,0,.35)}.mid{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:6px 0}'
  + '.card.wish{background:linear-gradient(135deg,#312e81,#020617)}.chip{align-self:flex-start;padding:4px 12px;border-radius:999px;background:rgba(8,6,28,.55);font-weight:800;font-size:12px}'
  + '.big{font-size:clamp(22px,7vw,34px);font-weight:900;line-height:1.25;color:#ffe08a;margin:0;text-shadow:0 1px 2px rgba(20,4,40,.85),0 0 1px rgba(20,4,40,.9)}.line{font-size:clamp(15px,4.4vw,19px);font-weight:800;margin:8px 0 0}.by{font-size:13px;font-weight:700;opacity:.92;margin:10px 0 0}'
  + '.shot{display:block;width:100%;border-radius:16px;margin:12px 0 0}.fr{color:#39f58a;font-weight:800;font-size:14px;margin:12px 0 0;text-align:center}'
  + '.acts{display:grid;gap:10px;margin:16px 0 0}.btn{display:flex;align-items:center;justify-content:center;min-height:52px;padding:8px 18px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#f3f1ff;font:inherit;font-weight:900;font-size:16px;text-decoration:none;cursor:pointer;width:100%}'
  + '.btn.gold{border:0;color:#2a1800;background:linear-gradient(135deg,#ffe9a8,#ffcf5a 45%,#e6a52a)}.note{color:#39f58a;font-size:13px;font-weight:800;text-align:center;min-height:1em;margin:6px 0 0}'
  + '.foot{color:#a3a2c4;font-size:12px;margin:22px 0 0;text-align:center}.foot a{color:#ffcf5a;display:inline-flex;align-items:center;min-height:44px}@media (orientation:landscape) and (max-height:520px){.card{max-width:calc((100vh - 160px) * 16 / 9);margin:0 auto}.acts{grid-template-columns:1fr 1fr 1fr}.acts .btn{font-size:15px;white-space:nowrap;padding:8px 10px}}a:focus-visible,button:focus-visible{outline:2px solid #ffe9a8;outline-offset:2px}';

// The share button: the system sheet, else the clipboard. The words come from data-title / data-text (escaped attributes).
const SCRIPT = '<script>(function(){var b=document.getElementById("share"),n=document.getElementById("note");if(!b)return;b.addEventListener("click",async function(){var u=location.origin+location.pathname,t=b.getAttribute("data-title")||"",x=b.getAttribute("data-text")||"";'
  + 'try{if(navigator.share){await navigator.share({title:t,text:x,url:u});return;}}catch(e){if(e&&e.name==="AbortError")return;}'
  + 'try{await navigator.clipboard.writeText(x+" "+u);n.textContent="링크를 복사했어요. 카카오톡에 붙여 넣어 보내세요.";}catch(e){n.textContent=u;}});})();</script>';

/**
 * o: { title, desc, image, url (og:url), dest (the 3D plaza's address for it), kind ('card' | 'wish'), chip, big, line, by, fr (the friends
 * line or ''), shot (a snapshot image URL or ''), share: { title, text } (the share sheet's words), make (나도 만들기: '/gift' with the
 * link's inv / pref kept; only a /gift address is taken) }. -> the whole HTML document.
 */
export function sharePage(o = {}) {
  const share = o.share || { title: o.title, text: o.desc };
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#07061a">'
    + '<title>' + esc(o.title) + '</title><meta name="robots" content="noindex">'
    + '<meta property="og:title" content="' + esc(o.title) + '">'
    + '<meta property="og:description" content="' + esc(o.desc) + '">'
    + '<meta property="og:image" content="' + esc(o.image) + '">'
    + '<meta property="og:url" content="' + esc(o.url) + '">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + '<style>' + CSS + '</style></head><body><main>'
    + '<div class="top"><a class="brand" href="/">WISH BOARD<small>모두의 전광판</small></a></div>'
    + '<section class="card' + (o.kind === 'wish' ? ' wish' : '') + '" aria-label="' + esc(o.big) + '">'
    + (o.chip ? '<span class="chip">' + esc(o.chip) + '</span>' : '')
    + '<div class="mid"><p class="big">' + esc(o.big) + '</p>' + (o.line ? '<p class="line">' + esc(o.line) + '</p>' : '') + (o.by ? '<p class="by">' + esc(o.by) + '</p>' : '') + '</div>'
    + '</section>'
    + (o.shot ? '<img class="shot" src="' + esc(o.shot) + '" alt="가상 광장에서 찍은 사진" loading="lazy">' : '')
    + (o.fr ? '<p class="fr">' + esc(o.fr) + '</p>' : '')
    + '<div class="acts"><a class="btn gold" href="' + esc(o.dest) + '">3D 광장에서 보기</a>'
    + '<button class="btn" type="button" id="share" data-title="' + esc(share.title) + '" data-text="' + esc(share.text) + '">공유하기</button>'
    + '<a class="btn" href="' + esc(MAKE.test(String(o.make || '')) ? o.make : '/gift') + '">나도 만들기</a></div><p class="note" id="note" role="status"></p>'
    + '<p class="foot">뉴욕 타임스퀘어를 본뜬 가상 광장의 전광판이에요. 실제 타임스퀘어와는 관계가 없어요.<br><a href="/discover">다른 전광판 구경하기</a></p>'
    + '</main>' + SCRIPT + '</body></html>';
}

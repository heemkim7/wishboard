# AI 바탕 영상(플레이트) 프롬프트 (2026-11-27)

목적: 타임스퀘어 느낌의 밤거리 영상에 **초록 화면(그린스크린) 전광판**이 있는 바탕 영상을 AI로 만든다. 나중에 앱이 그 초록 화면 자리에 사용자의 선물 전광판을 정확한 글자로 합성한다. 그래서 바탕 영상에는 **글자·로고가 하나도 없어야** 하고, 초록 화면은 **평평하고 고르고 네 모서리가 끝까지 보여야** 한다.

프롬프트는 영어가 결과가 좋다. 각 장면에 한국어 설명을 붙였다.

## 0. 먼저 읽기 (모든 장면 공통)

**만드는 순서 (권장)**
1. 이미지 AI로 **첫 장면 사진**을 먼저 만든다(아래 "사진 프롬프트"). 초록 화면 모양과 구도를 사진에서 고른다.
2. 그 사진을 영상 AI의 **이미지→영상(image-to-video)**에 넣고 "움직임 프롬프트"를 준다. 처음부터 글로만 영상을 만드는 것보다 구도와 초록 화면이 훨씬 안정적이다.
3. 사진 단계가 어려우면 "글→영상 프롬프트"를 바로 써도 된다.

**설정**
- 비율 **9:16 세로**, 해상도는 고를 수 있는 가장 높은 것(1080×1920 이상), 길이 **8~10초**, 24 또는 30fps.
- 카메라는 **고정(삼각대)** 또는 **아주 느리게 앞으로**. 흔들림·컷·줌 튐 없음.
- 소리를 같이 만드는 도구(Veo 3, Sora 2 등)면 **거리 소음만**(군중 웅성임, 자동차, 멀리 경적). 음악·말소리 없음.
- 도구가 "부정 프롬프트(negative prompt)"를 받으면 아래 공통 부정 프롬프트를 넣는다.

**공통 부정 프롬프트 (negative)**
```
text, letters, words, numbers, logos, brand names, trademarks, readable signage, watermark, subtitles, captions,
anything on the green screen, gradient or texture on the green screen, reflections or glare on the green screen,
moire, flicker, people or objects in front of the green screen, screen cut off by frame edge, curved screen,
camera shake, handheld wobble, fast zoom, scene cut, close-up faces, identifiable faces, distorted buildings, warped perspective
```

**받아 오실 때**
- 원본 화질 그대로 MP4로 저장. 파일 이름 예: `plate-01-front-night.mp4`
- 어떤 도구·요금제로 만들었는지 적어 주세요(상업적 이용 조건 확인용). 무료 요금제는 상업 이용이 안 되는 경우가 많다.
- 아래 "확인할 것"에 걸리는 영상은 다시 만든다.

**확인할 것 (영상마다)**
- [ ] 초록 화면이 처음부터 끝까지 네 모서리가 다 보인다
- [ ] 초록 화면이 한 가지 색으로 고르다(무늬·반사·그라데이션 없음)
- [ ] 초록 화면 앞을 사람·물체가 지나가지 않는다
- [ ] 영상 어디에도 읽히는 글자·로고가 없다
- [ ] 건물과 화면이 휘거나 녹아내리지 않는다
- [ ] 가까이 보이는 얼굴이 없다(뒷모습이나 멀리 있는 사람만)

---

## 1. 정면 · 밤 · 메인 영상 (가장 먼저)

한국어: 타임스퀘어 한복판, 사람들 뒤에서 큰 전광판을 정면으로 보는 장면. 카메라가 아주 천천히 다가간다. 몇 사람은 휴대폰을 들어 전광판을 찍는다. 가장 많이 쓸 기본 영상.

**사진 프롬프트**
```
Vertical 9:16 photorealistic night photo in a dense Times Square-style plaza in New York, shot on a smartphone at eye level
from behind a crowd. In the upper center, one huge flat rectangular LED billboard mounted on a tall building faces the camera
straight on; the billboard displays a perfectly uniform solid chroma-key green (#00FF00), matte, no reflections, all four
corners clearly visible with dark frame borders around it. Surrounding buildings are covered in glowing neon signs and smaller
screens showing only abstract colorful motion-graphic patterns with no text and no logos. Wet asphalt reflecting pink, cyan and
gold light. In the lower third, the backs of people's heads and shoulders, several people raising phones toward the billboard,
nobody's face visible. Light haze, realistic night photography, natural phone camera look, high detail.
```

**움직임 프롬프트 (이미지→영상)**
```
Very slow, smooth forward dolly toward the green billboard, as if a person walks two steps closer while filming with a phone
held steady. The crowd in the foreground sways gently and a few phones stay raised; people stay below the billboard and never
pass in front of it. Neon signs and small screens around it animate with abstract light patterns. The green billboard stays
perfectly flat, uniform and fully in frame for the whole shot. No cuts, no shake, no zoom jumps. Ambient city sound only:
crowd murmur, distant traffic, a far car horn. No music, no speech.
```

**글→영상 프롬프트 (사진 없이 바로)**
```
9:16 vertical, 10 seconds, photorealistic smartphone footage at night in a Times Square-like plaza in New York. Camera behind a
crowd at eye level, very slowly moving forward. One giant flat rectangular billboard on a tall building faces the camera and
shows a perfectly uniform solid chroma-key green (#00FF00), matte, all four corners visible the whole time. Every other sign
and screen shows only abstract colorful light patterns, no text, no logos. Wet asphalt with neon reflections, light haze,
people seen only from behind, some raising phones to film the billboard, nobody walks in front of it. Steady camera, no cuts.
Ambient street sound only, no music, no speech.
```

## 2. 올려다보기 · 메인 타워

한국어: 높은 타워 꼭대기 쪽 대형 화면을 아래에서 올려다보는 장면. "메인 타워 1분"용.

**사진 프롬프트**
```
Vertical 9:16 photorealistic night photo looking up from street level at a very tall skyscraper in a Times Square-style plaza.
Near the top of the tower, a huge flat vertical rectangular LED screen shows a perfectly uniform solid chroma-key green
(#00FF00), matte, all four corners visible, seen at a moderate upward angle (not extreme). The tower below is wrapped in
stacked neon bands and smaller screens with abstract color patterns only, no text, no logos. Night sky with soft city glow.
At the very bottom edge, a few silhouetted raised hands holding phones pointing up. Realistic, high detail, natural lens.
```

**움직임 프롬프트**
```
Slow, smooth upward tilt that ends with the green screen centered in the upper half of the frame, then holds still. Neon bands
on the tower pulse softly with abstract light. The raised phones at the bottom move slightly. The green screen stays flat,
uniform and fully visible the entire time. No cuts, no shake. Ambient city sound, no music, no speech.
```

## 3. 비 오는 밤 · 반사

한국어: 비가 막 그친 밤, 젖은 바닥에 전광판 빛이 길게 비친다. 감성 영상용.

**사진 프롬프트**
```
Vertical 9:16 photorealistic night photo of a Times Square-style plaza just after rain. A large flat rectangular billboard on a
building faces the camera at a slight angle (about 15 degrees), showing a perfectly uniform solid chroma-key green (#00FF00),
matte, all four corners visible. Puddles and wet pavement in the foreground reflect the surrounding neon in long vertical
streaks. A few people with umbrellas seen from behind, far from the camera. All other signs show abstract color patterns only,
no text, no logos. Moody, cinematic but realistic, phone camera at chest height.
```

**움직임 프롬프트**
```
Camera locked off, completely still. Light drizzle falls, ripples move across the puddles, umbrellas drift slowly across the
lower part of the frame without covering the billboard. Neon reflections shimmer on the wet ground. The green billboard stays
flat, uniform and fully visible. Ambient rain and street sound, no music, no speech.
```

## 4. 연말 · 눈 · 카운트다운

한국어: 눈 내리는 연말 밤, 들뜬 군중. 12월 31일·생일 자정용. 꽃가루와 눈이 초록 화면 앞을 가리지 않게 한다.

**사진 프롬프트**
```
Vertical 9:16 photorealistic photo of a packed Times Square-style plaza on a snowy New Year's Eve night. One large flat
rectangular billboard faces the camera, showing a perfectly uniform solid chroma-key green (#00FF00), matte, all four corners
visible. Gentle snow falls in the street, but the area directly in front of the billboard is clear. The crowd below is seen from
behind, wearing hats and scarves, many holding up phones. Other screens and signs glow with warm gold and red abstract patterns,
no text, no logos. Festive, realistic night photography.
```

**움직임 프롬프트**
```
Camera steady with a very slow push forward. Snowflakes drift down in the foreground and street, never in front of the green
billboard. The crowd bounces with excitement, phones raised. Other screens flash warm abstract light patterns in rhythm. The
green billboard stays flat, uniform and fully visible. Ambient festive crowd cheer and street sound, no music, no speech,
no countdown numbers.
```

## 5. 휴대폰으로 찍는 손 (어깨 너머)

한국어: 화면 아래쪽에 누군가 휴대폰을 들고 전광판을 찍는 손이 크게 보인다. 휴대폰 화면도 초록이라 같은 선물 전광판을 두 번 합성한다. "진짜 찍은 느낌"이 가장 강한 영상. 두 화면을 맞추기가 조금 더 어렵다.

**사진 프롬프트**
```
Vertical 9:16 photorealistic over-the-shoulder night photo in a Times Square-style plaza. In the lower half, a person's hand
holds a modern smartphone up toward a giant billboard; the phone's screen shows a perfectly uniform solid chroma-key green
(#00FF00) with all four corners of the phone screen visible. In the upper half, the giant flat rectangular billboard on a building
also shows the same uniform chroma-key green, matte, all four corners visible. Neon signs around show abstract colors only, no
text, no logos. Shallow depth of field on the hand, realistic, natural light from the screens.
```

**움직임 프롬프트**
```
The hand holds the phone steady with a tiny natural sway. The giant billboard stays still in the background. Both green screens
stay flat, uniform and fully visible for the whole shot. People in the far background move slowly. No cuts. Ambient street
sound, no music, no speech.
```

## 6. 모퉁이를 감싸는 L자 전광판 (입체 광고용)

한국어: 건물 모서리 두 면을 감싸는 L자 화면. 샘플 A처럼 상자·캐릭터가 튀어나오는 입체 연출을 합성할 바탕. 두 면이 각각 초록이고, 모서리 선이 또렷해야 한다.

**사진 프롬프트**
```
Vertical 9:16 photorealistic night photo from street level, diagonally facing the corner of a tall building in a Times
Square-style plaza. A large L-shaped LED screen wraps around the building corner across two faces at 90 degrees; both faces show
perfectly uniform solid chroma-key green (#00FF00), matte, with a sharp clean vertical corner edge and all outer corners
visible. Dark thin frame around the screen. Surrounding signs show abstract colors only, no text, no logos. Crowd far below seen
from behind. Realistic, high detail, natural phone camera look.
```

**움직임 프롬프트**
```
Camera completely still (tripod). Only the crowd below and the abstract neon around move. The L-shaped green screen stays
perfectly flat on both faces, uniform, with a sharp corner, fully visible. No cuts, no shake. Ambient street sound, no music,
no speech.
```

## 7. 해 질 녘 (블루아워)

한국어: 하늘이 짙은 파랑일 때. 낮 생일·합격 축하용으로 밝은 느낌.

**글→영상 프롬프트**
```
9:16 vertical, 8 seconds, photorealistic smartphone footage at blue hour in a Times Square-style plaza, deep blue sky, city
lights turning on. One large flat rectangular billboard faces the camera showing a perfectly uniform solid chroma-key green
(#00FF00), matte, all four corners visible throughout. Other screens show abstract colorful patterns only, no text, no logos.
Pedestrians seen from behind and far away, nobody passes in front of the billboard. Camera steady with a very slow forward move.
Ambient street sound only, no music, no speech.
```

---

## 도구별 메모

- **Google Veo 3 / Flow**: 소리까지 같이 만든다. 이미지→영상을 쓰면 초록 화면이 가장 잘 유지된다. 길이 8초.
- **Runway (Gen-4 등)**: 이미지→영상 권장. 소리는 없다. "camera: static" 같은 카메라 옵션이 있으면 고정으로.
- **Kling**: 이미지→영상, 부정 프롬프트 칸에 공통 부정 프롬프트를 넣는다. 5초/10초 중 10초.
- **Sora**: 글→영상과 이미지→영상 둘 다. 소리 지원 버전이면 거리 소음만.
- 결과에서 초록이 조금 얼룩지는 것은 합성 단계에서 보정할 수 있다. 하지만 **글자가 생기거나 화면 앞을 사람이 지나가는 것**은 고치기 어려우니 다시 만든다.

## 법적으로 지킬 것

- 이 영상들은 실제 장소를 본뜬 **AI 합성**이다. 앱에서 쓸 때 영상 구석에 "AI 합성 · 가상" 표시를 남기고, "실제 타임스퀘어에 송출됐다"고 말하지 않는다.
- 실제 브랜드 로고가 생긴 영상은 쓰지 않는다.
- 도구의 상업 이용 조건(요금제)을 확인한다. 만든 도구와 요금제를 알려 주시면 약관을 확인한다.

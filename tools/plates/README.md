# tools/plates — 실사 축하 영상 자산

AI로 만든 바탕 영상(`video/plate-0N-*.mp4`, 초록 화면)에서 앱이 쓰는 자산과 샘플 영상을 만든다.
설계는 `docs/superpowers/specs/2026-11-27-real-video-design.md`. 모든 소리는 코드로 합성한다(내려받은 음원 없음).

준비물: Python 3.14 + numpy, scipy, opencv-python, Pillow, matplotlib, 그리고 PATH의 ffmpeg/ffprobe.
명령은 저장소 루트에서 실행한다.

## 앱 자산 (`assets/plates/`)

| 할 일 | 명령 |
|---|---|
| 전부 다시 만들기(영상·미리보기·JSON·음악·index, 끝에 검사) | `python tools/plates/export.py --all` |
| 장면 몇 개만(영상·미리보기·JSON + index) | `python tools/plates/export.py --plates 05 06` |
| JSON만 | `python tools/plates/export.py --json --plates 04` |
| 음악 6곡만 | `python tools/plates/export.py --music` |
| 검사만(크기·프레임 수·JSON 모양·키 품질·음악 크기/LUFS) | `python tools/plates/export.py --check` |

- `plate-0N.mp4`: 1080×1920(1088 폭에서 양옆 4px 자름, 7번은 1072×1904를 꽉 차게 늘린 뒤 자름), 24fps, 241프레임, H.264 High, faststart, 거리 소리 AAC 모노 64kb/s, 8,000,000바이트 이하. 들어가는 가장 낮은 CRF를 고르고, 키 품질(초록 마스크 IoU, 테두리 오차)을 출력한다.
- `plate-0N.jpg`: 5초 지점 360×640, 40KB 이하.
- `plate-0N.json`: 프레임별 화면 모서리(출력 1080×1920 좌표). 형식은 `export.py` 맨 위 설명.
- `music-<occ>.m4a`: `giftrules.js` `OCCASIONS` 키(bday, anniv, pass, cheer, just, thanks), 10.04초, −19 LUFS, AAC 112kb/s 스테레오.
- 7번의 늘린 사본과 추적 캐시는 `%TEMP%/kts-plates`에 둔다(저장소에 넣지 않는다).

## 샘플 영상 (`out/2026-11-27/plates/`)

| 할 일 | 명령 |
|---|---|
| 1·2번 합성 | `composite.py` 맨 위 사용법 |
| 3~7번 합성(여러 화면, 휴대폰, 코너) | `scene.py` 맨 위 사용법 |
| 음악 한 곡(WAV) | `python tools/plates/music.py render bday out/2026-11-27/plates/bgm-bday.wav --png` |
| 영상에 음악 섞기 | `python tools/plates/music.py mix <영상> <결과> --music <wav> --music-db -5` |
| 소리 검사 | `python tools/plates/music.py check <파일>` |

파일: `track.py` 모서리 추적, `card.py` 카드, `corner.py` 코너 두 면과 튀어나오는 상자, `composite.py`·`scene.py` 합성, `music.py` 음악, `export.py` 앱 자산.

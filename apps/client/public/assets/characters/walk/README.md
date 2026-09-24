# Walking character artwork

Four original transparent PNG sheets, 1254 × 1254 pixels each:

- `chestnut.png`: chestnut hair, masculine base.
- `black.png`: black hair, masculine base.
- `red-ponytail.png`: red ponytail, feminine base.
- `silver.png`: silver hair, feminine base.

Each sheet contains 24 poses in six columns and four rows. Columns 1–3
contain the first direction in a row and columns 4–6 the second:

| Row | Columns 1–3 | Columns 4–6 |
| --- | --- | --- |
| 1 | South | Southwest |
| 2 | West | Northwest |
| 3 | North | Northeast |
| 4 | East | Southeast |

The three poses are step A, neutral, step B. Playback is `0, 1, 2, 1`
at eight frames per second. Idle uses pose `1` in the last facing direction.

The original PNGs are preserved. Integer source rectangles, alignment anchors
and neck boundaries are in `src/appearance/walkAtlas.json`. Row boundaries are
0, 314, 627, 940 and 1254; do not treat the source as a fixed 313-pixel grid.

The client composes head and body independently, applies saved colors and face
options, and creates normalized 64 × 108 frames. The starting outfit is a
separate transparent texture with the same frame names and timing. Base
underwear belongs to the source body. The creator uses the same renderer for
its front-facing idle preview, with a toggle for the outfit layer.

Local movement uses keyboard, click-to-move or joystick displacement. Server
position reconciliation does not start a local walk cycle. Other players animate
while interpolating received positions and return to idle on arrival. No server
protocol or saved appearance data changes are needed.

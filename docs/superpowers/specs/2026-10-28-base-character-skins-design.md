# Six base character skins

The requested change is three male and three female pixel-art skins inspired by
the supplied 4814.gif, selectable in character creation.

Implementation choices: traveler, scout and lightly armored guard outfits for
each gender; four directions and four walking frames per direction; transparent
1024×1536 atlases with virtual 256×384 frames. Actual row bounds are recorded in
the client manifest so complete sprites remain visible despite generated row
spacing. Phaser and DOM previews crop the same source rectangles and align feet.
The generated images remain separate from
the user's reference and are saved under the client's public assets directory.

The creator shows native radio choices, three skins for the selected gender,
an animated preview and direction controls. Gender changes preserve the nickname
and equivalent outfit. The selection is cosmetic and is submitted as
`appearance: { gender, skinId }`.

The existing PostgreSQL JSON appearance column stores the selection without a
migration. Server validation rejects unknown skins and gender mismatches. Player
and world snapshots carry the appearance to all viewers; old records receive a
default skin. The world uses the same images as the creator and keeps a visible
fallback if an asset fails to load.

Alternatives considered: creator-only previews would not show the selected skin
in gameplay; reusing the separate restoration branch would introduce unrelated
changes. This change extends the currently deployed implementation instead.

Acceptance: six distinct atlases, three visible choices per gender, persistent
selection after login/reload, corresponding local and remote world sprites,
directional walking, usable mobile layout and existing account flows preserved.

# Asset Sources & Licenses — 6ixNetworks 3D World

Every externally sourced asset used in the 3D world is recorded here.
Rule: only CC0 / public-domain assets with a verified license page are imported.
No ripped, extracted, or unclear-license assets. No runtime hotlinking — all files live in this repo.

## Verified sources

| Source | Creator | URL | License | Verified |
|---|---|---|---|---|
| Stylized Nature MegaKit | Quaternius | https://quaternius.com/packs/stylizednaturemegakit.html | CC0 1.0 — confirmed in the pack's own License_Standard.txt ("CC0 1.0 Universal, Public Domain Dedication") | 2026-11-22 |
| Ultimate Nature Pack | Quaternius | https://quaternius.com/packs/ultimatenature.html | CC0 1.0 | page check 2026-11-22 |
| Ultimate Animated Animals | Quaternius | https://quaternius.com/packs/ultimateanimatedanimals.html | CC0 1.0 (License.txt in the Drive folder) | page check 2026-11-22 |
| Medieval Village MegaKit | Quaternius | https://quaternius.com/packs/medievalvillagemegakit.html | CC0 1.0 — confirmed in the pack's License_Standard.txt | 2026-11-22 |
| Downtown City MegaKit | Quaternius | https://quaternius.com/packs/downtowncitymegakit.html | CC0 1.0 — confirmed in the pack's License_Standard.txt | 2026-11-22 |
| Nature Kit (330 assets) | Kenney | https://kenney.nl/assets/nature-kit | CC0 — confirmed in the pack's License.txt ("License: (Creative Commons Zero, CC0)") and pack page | 2026-11-22 |
| Textures / HDRIs | Poly Haven | https://polyhaven.com/license | CC0 — "All assets on this site are licensed as CC0… You can use our assets for any purpose… You can redistribute them" | 2026-11-22 |
| Stylized Forest Kit | AssetQuest | https://assetquest.itch.io/stylized-forest-kit | CC0 per listing — PAID pack, NOT purchased; do not use without owner approval | not acquired |

## Downloads (2026-11-22, all via the free $0 path — nothing purchased)

| Pack | File | Size | Contents |
|---|---|---|---|
| Stylized Nature MegaKit [Standard] | itch.io upload 11055123 | 104,088,529 B | 68 glTF models (Standard edition = 68 of 116; Pro has the rest) |
| Ultimate Nature Pack | itch.io upload 1588309 | 22,951,353 B | 150 models, FBX/Blend/OBJ only |
| Medieval Village MegaKit [Standard] | itch.io upload 12563480 | 161,003,471 B | 176 glTF models |
| Downtown City MegaKit [Standard] | itch.io upload 17615373 | 234,753,092 B | 153 glTF models |
| Kenney Nature Kit | kenney.nl signed download | 10,537,521 B | 329 GLB models |
| Ultimate Animated Animals | Google Drive folder 1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk | — | 12 rigged glTF mapped (Deer, Stag, Fox, Wolf, Horse, …) — download blocked by a Drive quota error on 2026-11-22, retry pending |

Inspection: all 68 MegaKit + all 329 Kenney models batch-inspected in Blender (tris/dims/materials,
zero import errors); all 68 MegaKit models preview-rendered. Curation: `CATALOG.md`.

## Imported assets

Conversion for all rows below: Blender 4.2.3 import → textures capped at 1024px → GLB export
with WebP textures → base64-wrapped `.glb.b64` for the repo push pipeline. Creator for all
rows: Quaternius. Source: https://quaternius.itch.io/stylized-nature-megakit (Stylized Nature
MegaKit [Standard]). License: CC0 1.0. Downloaded: 2026-11-22.

| Asset | Original format | Converted size | Local path |
|---|---|---|---|
| CommonTree_1 | glTF + PNG textures | 584,440 B | world3d/assets/nature/CommonTree_1.glb.b64 |
| CommonTree_3 | glTF + PNG textures | 400,596 B | world3d/assets/nature/CommonTree_3.glb.b64 |
| CommonTree_5 | glTF + PNG textures | 363,892 B | world3d/assets/nature/CommonTree_5.glb.b64 |
| Pine_2 | glTF + PNG textures | 312,060 B | world3d/assets/nature/Pine_2.glb.b64 |
| Pine_4 | glTF + PNG textures | 303,828 B | world3d/assets/nature/Pine_4.glb.b64 |
| TwistedTree_2 | glTF + PNG textures | 824,520 B | world3d/assets/nature/TwistedTree_2.glb.b64 |
| Bush_Common | glTF + PNG textures | 113,832 B | world3d/assets/nature/Bush_Common.glb.b64 |
| Bush_Common_Flowers | glTF + PNG textures | 250,756 B | world3d/assets/nature/Bush_Common_Flowers.glb.b64 |
| Rock_Medium_1 | glTF + PNG textures | 56,204 B | world3d/assets/nature/Rock_Medium_1.glb.b64 |
| Rock_Medium_3 | glTF + PNG textures | 63,044 B | world3d/assets/nature/Rock_Medium_3.glb.b64 |
| Fern_1 | glTF + PNG textures | 91,132 B | world3d/assets/nature/Fern_1.glb.b64 |
| Flower_3_Group | glTF + PNG textures | 162,444 B | world3d/assets/nature/Flower_3_Group.glb.b64 |
| Flower_4_Group | glTF + PNG textures | 196,548 B | world3d/assets/nature/Flower_4_Group.glb.b64 |
| Grass_Common_Tall | glTF + PNG textures | 18,164 B | world3d/assets/nature/Grass_Common_Tall.glb.b64 |

Remaining curated models (CATALOG.md) are converted the same way at CP6.

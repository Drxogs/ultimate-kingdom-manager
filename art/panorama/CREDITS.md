# Panorama art

Pixel art for the Settlements tab panorama. Generated with PixelLab (an AI pixel-art tool) for Drxogs and picked, trimmed and arranged by Claude. The wall tiles were cut to repeat seamlessly, the stage 2 wall tower was made by shortening the citadel tower, the plains sky was cleaned by hand, and the river strip (`water.png`) was drawn in code.

Scale: one pixel of art is one pixel of the 576 × 120 panorama canvas; the ground line is at y 92. Buildings stand on the bottom edge of their file.

- `bg-{terrain}.png`: backgrounds, 576 × 120, opaque
- `water.png`: river strip, 576 × 24, laid over the bottom of the background
- `{track}-{stage}.png`: the ten track buildings, stages 0 to 3
- `{track}-pinnacle.png`, `walls-pinnacle.png`: the landmarks
- `homes-{stage}-{a..f}.png`: houses the town's rows are built from (stage 0 has one hut)
- `walls-{stage}-tile.png`, plus towers, end caps and the keep

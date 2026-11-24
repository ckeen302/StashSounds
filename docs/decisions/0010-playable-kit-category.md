# 0010 Playable kit pads carry the kit category
- Context: The contract reviewer noted that `playableSchema`'s kit pads use `kitCategorySchema` (kick, snare, 808 and so on), the same enum as `kit_samples.category`, and asked that this be written down.
- Options: A separate display category for pads; reuse the stored category.
- Choice: Reuse `KitCategory`. The pad grid colors and orders pads by the stored category, and the worker's labelling is the only source.
- Reason: One enum means a new category is added in one place (enums.ts plus the kit_samples check) and every surface picks it up.
- Consequence: Adding a category is a contracts and migration change through the lead.

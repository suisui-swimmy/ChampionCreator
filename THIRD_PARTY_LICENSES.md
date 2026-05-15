# Third Party Licenses

This project will keep license notices for third-party libraries used in the app.

Milestone -1 uses the following npm packages:

- `@smogon/calc`
- React
- React DOM
- Vite
- TypeScript

## `@smogon/calc`

- Package: `@smogon/calc`
- Version used by this project: see `package-lock.json`
- Repository: `github:smogon/damage-calc`
- License: MIT

ChampionCreator uses `@smogon/calc` as the source of truth for damage rolls and related battle calculation behavior. The app must not copy or reimplement the damage formula, type chart, move power logic, or random damage roll logic.

## Build-Time Data Sources

The generated UI option JSON files use local data sources for display/search labels only.
These files are not used as the source of truth for battle calculation.

### `@motemen/pokemon-data`

- Local path used during generation: `others/pokemon-data/ITEM_ALL.json`, `others/pokemon-data/POKEMON_ALL.json`
- Repository: `https://github.com/motemen/pokemon-data`
- License declared in local `package.json`: ISC
- Note: this local checkout does not currently include a `LICENSE` file. Reconfirm the upstream license text before public release.

ChampionCreator uses this data to join Showdown item names to Japanese item labels, and to infer temporary Mega Stone labels from Pokemon Japanese names when the item dictionary lacks those names.

### `pokeranker_SV`

- Local path used during generation: `../others/pokeranker_SV/data/foreign_move.txt`, `../others/pokeranker_SV/data/foreign_ability.txt`
- Repository noted by local README: `https://github.com/tmwork1/pokeranker_SV`
- License in local checkout: MIT
- Copyright notice in local `LICENSE`: Copyright (c) 2024 tmwork1

ChampionCreator uses these files as optional build-time dictionaries for Japanese move and ability labels.
If the local files are unavailable, generation falls back to Showdown names and marks the affected entries in each generated summary.

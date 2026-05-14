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

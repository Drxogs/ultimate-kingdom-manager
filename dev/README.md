# Development tools

Not part of the module (the release zip doesn't include this folder).

- `harness/`: Node tests that run the module's code outside Foundry with a mocked `game`. Run each `test-*.mjs` with Node 22; a line starting `FAIL` is a failure. `setup.mjs` builds the mock world. The paths assume the repo is at `/home/claude/ukm-repo`.
- `harness/sim-campaign.mjs`: a whole campaign from level 1 to 20 with real dice and a simulated party (`node sim-campaign.mjs <seed> <daysPerLevel> <daily|weekly>`). Prints one JSON line per level and a summary.
- `.eslintrc.json`: run `eslint --no-eslintrc -c dev/.eslintrc.json scripts` before a release to catch undefined names.

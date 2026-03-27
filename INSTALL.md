# Install

1. Copy `CLAUDE.md` to the root of your repo.
2. Copy the entire `.claude/` folder into the repo root.
3. Review `.claude/settings.json` and trim or expand permissions for your environment.
4. Run the command names exactly as written, for example:
   - `/repo-audit`
   - `/audit-ui https://your-app-url`
   - `/stress-test market-data`
   - `/pitch MSFT`

## Included
- master `CLAUDE.md`
- 6 agents
- 9 slash commands
- 4 checklists
- 4 reusable skills
- `settings.json` with hooks and command permissions

## Notes
- The package is opinionated for a Next.js + TypeScript + finance product
- If your repo uses different scripts, update the command files and settings hooks accordingly
- The hooks assume `npm`, `npx`, TypeScript, and lint/test/build scripts exist

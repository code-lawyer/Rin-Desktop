# Repository working guide

Read README.md, docs/project-status.md and CONTRIBUTING.md. The current user request defines scope.

- Preserve existing changes, the original GitHub repository, user data, models, runtimes, original artwork and private Dots. The main application stays in prototypes/live2d-codex for compatibility; source data stays in work/runtime/avatar.
- Use root npm commands. Run npm run check:project, relevant tests, the frontend build when affected, and npm run check:public. Audit the actual Git index separately before publishing.
- Keep only maintained usage, build, privacy, license and acceptance instructions. Update the affected guide when behavior changes; do not recreate historical task ledgers, generated progress pages or dated development reports.
- Maintained verification belongs in tools/qa and tools/probes. Run output belongs in ignored work/qa. Live CLI probes require --run and explicit task scope; ordinary tests must not consume accounts or access hardware.
- Keep public documentation independent of private data and machine-specific paths. Do not turn unit tests into claims of real hardware, Agent, installation or license acceptance; pending boundaries are in docs/project-status.md.

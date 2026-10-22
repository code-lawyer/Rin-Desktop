# Repository working guide

Read `docs/development/README.md`, then the relevant task in `docs/development/backlog.json`. The current user request defines scope; the ledger explains project context and outstanding work without requiring prior chats.

- Preserve existing working-tree changes and the original GitHub repository. Main application paths, user data, model/runtime directories and private Dots have intentional compatibility constraints documented in the repository map.
- Use the root npm commands. Run `npm run check:project`, relevant tests, the frontend build when affected, and `npm run check:public` for public changes. Index auditing is separate from working-tree auditing.
- Update task status, dependencies, acceptance and evidence in the JSON ledger, then run `npm run project:docs`. Do not manually edit generated progress/reconciliation pages or claim hardware/Agent acceptance from unit tests.
- Use `tools/qa` and `tools/probes` for maintained verification source; put run outputs in ignored `work/qa`. Live CLI probes require `--run` and an appropriate task scope; ordinary tests must not consume accounts or access hardware.
- Keep public documentation independent of private research, raw device/account data and machine-specific absolute paths. Historical material is not the current architecture or application data schema.
- FIX-01 through FIX-05 and DATA-03 have offline evidence in docs/development/review-fixes.md. DATA-01/02 and AGT-02 offline contracts are covered in docs/development/data-agent-validation.md; test candidates use docs/development/test-acceptance.md. RC003 source integration is in docs/development/remote-integration.md. Remaining work includes RC003 hardware/IME coexistence, real multi-CLI/install acceptance and release scope/license review. Do not claim those from unit tests.

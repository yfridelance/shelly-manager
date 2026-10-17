# Contributing to Shelly Manager

Thanks for your interest! Shelly Manager is a small project. Contributions of any size help: a bug report, a
test result from a real device, a translation or a pull request.

Please be respectful; see the [Code of Conduct](CODE_OF_CONDUCT.md). Issues and discussions can be in English or
German.

## Ways to help

- **Test with real devices.** The test suite runs against a mock fleet. Reports from real hardware are the most
  valuable contribution right now, especially for models, firmware versions and template settings (static IP,
  Wi-Fi AP, scripts) that have not been tried yet. Use the «Device report» issue template.
- **Report bugs** with the bug report template.
- **Translate.** The UI and the documentation are currently in German. An English UI is the next big step.
- **Code**: see the open issues. Issues labelled `good first issue` are a good start.

## Development setup

Requires Node.js 24 (at least 24.15; `.nvmrc` is included).

```bash
nvm use
npm install
npm run dev:mock   # server :3000, Angular :4200 and a mock Shelly fleet
```

Scan `10.99.0.0/24` in the UI to find the mock devices. Details on architecture, database, tests and the mock fleet:
[docs/entwicklung.md](docs/entwicklung.md) (German). [CLAUDE.md](CLAUDE.md) is the binding reference for rules,
the data model, the REST API and the Shelly API notes.

## Pull requests

1. Open an issue first for larger changes, so we can agree on the approach.
2. Keep changes small and focused; one topic per pull request.
3. `npm run build` and `npm test` must pass (CI runs both).
4. Add tests: server logic in `apps/server/test` (Vitest, against the mock fleet), UI in `*.spec.ts` next to the
   component. Extend the mock in `apps/server/test/mock-shelly/` when you use a new device API.
5. Update the documentation in the same pull request when behaviour, configuration or operation changes:
   `docs/` for humans and `CLAUDE.md` for the reference.

### Conventions

- TypeScript `strict`, no `any` without a comment explaining why.
- Code, identifiers and comments in English. UI texts are currently in German with Swiss spelling (no «ß»).
- Small, focused modules; device adapters, scan, database and HTTP routes stay separate.
- Store raw device answers unchanged; normalise only into separate fields.
- New database changes go into a new numbered migration in `apps/server/migrations/`; never edit an existing one.
- When Shelly behaviour is unclear, check the [official API docs](https://shelly-api-docs.shelly.cloud), and note
  the source or assumption in a comment.

### Safety rules (not negotiable)

This app can reset devices. These rules come from [CLAUDE.md](CLAUDE.md#9-sicherheitsregeln-nicht-verhandelbar)
and are covered by tests:

- No bulk factory reset; a reset is always per device, with typed confirmation and a server-side `confirmMac` check.
- Always take a snapshot before a reset; if it fails, block the reset unless the user explicitly overrides.
- Never log, persist or export device passwords.
- An error on one device must never break a scan or affect other devices.

## Reporting issues with real devices

Please include the model, generation and firmware version (shown on the device page). If you attach a config from
a JSON export, **remove anything sensitive first**: Wi-Fi names, MQTT servers and users, coordinates. The app never
exports passwords, but configs can still reveal details about your network.

## Security issues

Please do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

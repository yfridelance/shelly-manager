# Security Policy

Shelly Manager has no login and can reboot, update and factory-reset devices. Security issues are taken seriously.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub:
[Report a vulnerability](https://github.com/yfridelance/shelly-manager/security/advisories/new).
Do not open a public issue.

Please include what you found, how to reproduce it and what an attacker could achieve. You will get an answer
within a week. Once a fix is available, the advisory will be published with credit to you, unless you prefer
otherwise.

## Supported versions

Only the latest state of the `master` branch is supported. There are no maintained release branches yet.

## Scope and design assumptions

- The app is meant to run on a trusted machine or behind a reverse proxy with authentication. Missing
  authentication is therefore by design, not a vulnerability. Bypassing the built-in protections is:
  - the host and origin checks against DNS rebinding and cross-site requests
  - the per-device confirmation for factory resets
  - the rule that passwords are never stored
- Device passwords must never be written to the database, logs or exports. Any way to make that happen is a
  vulnerability.
- Shelly devices themselves (firmware, Gen1 Basic auth over plain HTTP) are out of scope; please report those to
  Shelly.

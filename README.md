# Cocotivity eLead Extension

Sibling Chrome extension for an eLead workflow. Product behavior, host
permissions, selectors, data fields, and release decisions belong here and
must be added deliberately.

## Family baseline

This repository follows the family rules in [FAMILY.md](FAMILY.md) and the
semantic tokens in [design/tokens.css](design/tokens.css).

Base contract: cocotivity-chrome-extensions v0.1.0

## Current state

This is an intentionally minimal Manifest V3 scaffold. Before adding a
collector or page integration, document the authorized scope, data handling,
permissions, diagnostics, and manual test cases. Do not add credentials,
cookies, raw page captures, or customer fixtures.

## Development

```bash
npm test
```

Load the repository directory through `chrome://extensions` with Developer
mode enabled when a product workflow is implemented.

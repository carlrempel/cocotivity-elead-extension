# Cocotivity extension family contract

This sibling adopts the reusable baseline maintained by
`cocotivity-chrome-extensions`. It owns its product workflow, manifest,
permissions, host rules, selectors, tests, release history, and runtime state.

## Boundaries

- Do not inherit selectors, fixtures, workflow code, credentials, host rules,
  report definitions, or business-data assumptions from another extension.
- Justify every permission in this repository; family changes must not broaden
  permissions silently.
- Never store or transmit cookies, credentials, access tokens, raw page HTML,
  raw responses, or screenshots as diagnostics.
- Keep output local by default. External delivery must be explicit, scoped,
  visible, and pausable.
- Diagnostics must be sanitized, durable, copyable, and preserve all warnings
  and exceptions in an `exceptions` array.
- Use named stage/status text; color must never carry meaning alone.

## Shared experience

- Use the semantic roles in `design/tokens.css` for compact operational UI.
- Provide one clear primary action for the current safe next step.
- Surface scope, timing, outcome, and failure reason in diagnostics.
- Reconcile a validation mismatch once, with a bounded re-capture, before
  declaring it unresolved.
- Long-running workflows need a persistent observation surface backed by
  durable shared state.

## Vocabulary

Use outcome-oriented labels such as **Start**, **Save locally**, **Send to
destination**, **Copy diagnostic**, and **Completed with exceptions**. Labels
must not claim delivery, verification, or persistence that did not occur.

## Compatibility

Base contract: `cocotivity-chrome-extensions v0.1.0`

The sibling adopts this pinned baseline explicitly and does not automatically
consume later base changes.

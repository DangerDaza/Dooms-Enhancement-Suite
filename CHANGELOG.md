# Changelog

## [Unreleased]

### Fixed
- Chat bubble dialogue text now displays the correct per-character color. SillyTavern's global `--SmartThemeQuoteColor` was overriding inline colors on `<q>` tags inside bubble text.
- Bubble renderers now prefer the AI's original `<font color>` for dialogue, falling back to the extension's assigned color only when no font tag is present.
- Residual `<font>` tags are stripped from rendered bubble text for cleaner output.

### Changed
- Narrator bubbles no longer display an avatar in Discord style, keeping the layout cleaner.
- Avatar shape changed from circle to rounded rectangle (6px border-radius) for better portrait display.

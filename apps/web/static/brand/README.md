# ⅃ooL brand files

Drawn for the ⅃ooL design system (foot dot E). Not wired into the app
yet: the rename puts them in the top bar, favicon and titles, so the
app never shows two names at once.

- `lool-wordmark.svg`: wordmark in `currentColor`; inline it and set
  `color` (`--brand-forest` on light grounds, `--brand-cream` on forest).
- `lool-wordmark-forest.svg`, `-cream.svg`, `-black.svg`: fixed colours
  for `<img>`; black for Sun mode and one-colour print.
- `lool-symbol.svg`: control-flag symbol for dark and forest grounds;
  `lool-symbol-on-light.svg` adds a hairline for cream and white.
- `lool-favicon-32.svg`: the on-light symbol drawn for 32 px.
- `lo.svg`: Lo the lynx, for the kids' screens only.

The SVGs carry `aria-label="LooL"`: ⅃ (U+2143) is for the drawing only,
never for text, titles or screen readers. Next to the name in text, mark
the SVG `aria-hidden="true"`. Minimum size: wordmark 72 px wide, symbol
16 px.

---
name: stylex
description: Author, review, and set up styles with StyleX (@stylexjs/stylex), Meta's compile-time atomic CSS-in-JS library. Use whenever code imports @stylexjs/stylex or @stylexjs/atoms, uses stylex.create / stylex.props / sx={}, has *.stylex.ts token files, configures @stylexjs/unplugin, babel-plugin, or postcss-plugin, or builds on Astryx (which is built on StyleX).
metadata:
  harness: claude pi
  scope: opt-in
  machine: local remote
---

# StyleX

StyleX compiles `stylex.create()` calls to atomic CSS at build time. Every rule below exists because the compiler must statically evaluate styles. Current version: 0.19.x.

For bundler setup, ESLint, and compiler options, read [references/installation.md](references/installation.md).

When unsure about an API, fetch the official docs: `https://stylexjs.com/llms-full.txt` (full docs) or `https://stylexjs.com/docs/api`.

## Core rules

- Create styles only with `stylex.create()`; apply with `stylex.props()` (React) or `stylex.attrs()` (Solid, Svelte, Vue, Qwik, SSR strings).
- Prefer longhands and single-value shorthands. Never use multi-value shorthands (`margin: '8px 16px'`, `border: '1px solid red'`).
- Unitless numbers on length properties are pixels.
- `null` unsets a property.
- Pseudo-classes, media queries, `@supports`, `@container`, and `stylex.when.*` go **inside property values**, never at the top level of a namespace. A `default` key is required (use `null` when nothing applies).
- Pseudo-elements (`::placeholder`, `::selection`) are the exception: top-level keys inside a namespace.
- Only StyleX values can be referenced inside `create()`: local literals, `defineVars`, `defineConsts`, `keyframes`, `positionTry`, `stylex.env`. Importing a plain JS constant fails compilation.
- Never put `className` or `style` on an element that spreads `stylex.props()`.
- Prefer real elements over `::before`/`::after`, and JS logic over `:first-child`/`:nth-child`; both shrink the CSS bundle.

## Writing and applying styles

```tsx
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  container: {
    display: 'flex',
    alignItems: 'center',
    padding: 16,
  },
  button: {
    backgroundColor: {
      default: 'lightblue',
      ':hover': 'blue',
      ':focus-visible': 'royalblue',
      ':disabled': 'gray',
    },
    flexDirection: {
      default: 'column',
      '@media (min-width: 768px)': 'row',
    },
  },
  input: {
    color: 'black',
    '::placeholder': { color: 'gray' },
  },
  bar: (width: number) => ({ width }),
});

function Toolbar({ isCompact, width }) {
  return (
    <div {...stylex.props(styles.container, isCompact ? styles.input : styles.button, styles.bar(width))} />
  );
}
```

- Arguments merge left to right; arrays and falsy values are allowed.
- Merging defaults to `styleResolution: 'property-specificity'`: for the same property the later style wins, but a longhand (`marginTop`) beats a shorthand (`margin`) regardless of order. Another reason to avoid shorthands.
- Dynamic styles (arrow functions) compile to CSS variables; use them only for genuinely runtime values.

### `sx` prop

With the compiler, lowercase host elements accept `sx` as shorthand for the `stylex.props` spread:

```tsx
<button sx={styles.button}>Save</button>
```

Custom components still receive `stylex.props(...)` or a `style` prop explicitly. The name is configurable via `sxPropName` (or disabled with `false`).

### Atoms (`@stylexjs/atoms`)

Inline atomic styles, usable anywhere a StyleX style is. Must be compiled; they throw at runtime otherwise.

```tsx
import x from '@stylexjs/atoms';

<button
  {...stylex.props(
    x.display['inline-flex'],
    x.paddingInline._12px,
    x.opacity['0.5'],
    x.color(color),
  )}
/>
```

`_` prefix for values starting with a digit, brackets for other non-identifiers, call syntax (single argument) for dynamic values. Use dynamic atoms sparingly. Prefer `stylex.create` for anything reused.

## Component style props

Put local styles first so the caller can override them:

```tsx
import type { StyleXStyles, StyleXStylesWithout } from '@stylexjs/stylex';

type CardProps = {
  children: React.ReactNode;
  style?: StyleXStyles;
};

function Card({ children, style }: CardProps) {
  return <div {...stylex.props(styles.card, style)}>{children}</div>;
}

type ColorOnly = StyleXStyles<{ color?: string; backgroundColor?: string }>;
type NoLayout = StyleXStylesWithout<{ margin: unknown; padding: unknown; width: unknown }>;
```

- `StyleXStyles<>`: any styles, optionally constrained to listed properties.
- `StyleXStylesWithout<>`: everything except listed properties.
- `StaticStyles<>`: like `StyleXStyles` but rejects dynamic styles. Prefer `StyleXStyles` unless you need that.
- `VarGroup<typeof vars>` and `Theme<typeof vars>`: types for variable groups and themes.

## Tokens: constants, variables, themes

`defineConsts`, `defineVars`, and `defineMarker` must be:

- in a `.stylex.ts` / `.stylex.js` (or `.mjs`, `.cjs`, `.tsx`, `.jsx`) file,
- direct named exports (no default export, no re-assigned or nested objects),
- the only value exports in that file (type exports are allowed; consts and vars can mix).

Use `defineConsts` for anything not themed (breakpoints, z-indices, durations). It inlines values with no CSS variables. Use `defineVars` only when values change by theme or subtree.

`tokens.stylex.ts`:

```tsx
import * as stylex from '@stylexjs/stylex';

export const breakpoints = stylex.defineConsts({
  medium: '@media (min-width: 768px)',
});

export const colors = stylex.defineVars({
  text: 'black',
  background: 'white',
  accent: stylex.types.color({
    default: 'blue',
    '@media (prefers-color-scheme: dark)': 'lightblue',
  }),
});
```

Usage:

```tsx
import { breakpoints, colors } from './tokens.stylex';

const styles = stylex.create({
  page: {
    color: colors.text,
    padding: { default: 8, [breakpoints.medium]: 16 },
  },
});

export const darkTheme = stylex.createTheme(colors, {
  text: 'white',
  background: '#1a1a1a',
});

<div {...stylex.props(isDark && darkTheme)}>{children}</div>;
```

- `createTheme` can live in any file and be passed around. It applies to the element's subtree.
- `stylex.types.*` (`color`, `length`, `angle`, `time`, `number`, `integer`, `percentage`, `lengthPercentage`, `url`, `image`, `resolution`, `transformFunction`, `transformList`) emit `@property` rules, which makes variables animatable.
- Theming needs `unstable_moduleResolution` in the compiler config.
- `stylex.env.*` (experimental) reads compile-time tokens from the babel `env` option. Values are inlined and dedupe with no extra CSS.

## Other APIs

**Relational selectors.** Style based on another element's state. Mark the observed element with `stylex.defaultMarker()`, or use `stylex.defineMarker()` (in a `.stylex.ts` file) for independent sets:

```tsx
const styles = stylex.create({
  card: {
    transform: {
      default: 'translateX(0)',
      [stylex.when.ancestor(':hover')]: 'translateX(10px)',
    },
  },
});

<div {...stylex.props(stylex.defaultMarker())}>
  <div {...stylex.props(styles.card)} />
</div>;
```

Available: `when.ancestor`, `when.descendant`, `when.anySibling`, `when.siblingBefore`, `when.siblingAfter`. `descendant`, `anySibling`, and `siblingAfter` rely on `:has()`.

**Keyframes and anchor fallbacks.** Must be declared in the same file that uses them. Share them across files through `defineVars`.

```tsx
const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const fallback = stylex.positionTry({ positionAnchor: '--anchor', top: '0', left: '0' });

const styles = stylex.create({
  animated: { animationName: fadeIn, animationDuration: '0.3s' },
  tooltip: { positionTryFallbacks: fallback },
});
```

`positionTry` accepts only anchor, inset, margin, size, and self-alignment properties.

**View transitions.** `stylex.viewTransitionClass({ group, imagePair, old, new })` returns a class for React's `<ViewTransition>`. No media queries inside.

**Fallback values.** `stylex.firstThatWorks('sticky', '-webkit-sticky', 'fixed')`.

## Antipatterns

| Wrong | Right |
|---|---|
| `{ ':hover': { color: 'blue' } }` at namespace top level | `color: { default: 'black', ':hover': 'blue' }` |
| `{ '@media (...)': { padding: 16 } }` at namespace top level | `padding: { default: 8, '@media (...)': 16 }` |
| `import { PADDING } from './constants'` inside `create` | `defineConsts` in a `.stylex.ts` file |
| `margin: '8px 16px'` | `marginBlock: 8, marginInline: 16` |
| `<div className="x" {...stylex.props(s.a)} />` | Only `stylex.props(...)` (or `sx`) |
| `defineVars` for values that never change | `defineConsts` |
| `export default stylex.defineVars(...)` | `export const tokens = stylex.defineVars(...)` |

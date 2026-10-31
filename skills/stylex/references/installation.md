# StyleX installation and configuration

StyleX needs a build-time compiler. Pick the integration for the bundler. Quick start for a new project: `npm create @stylexjs my-app`.

## Packages

| Package | Purpose |
|---|---|
| `@stylexjs/stylex` | Runtime, always required |
| `@stylexjs/unplugin` | Bundler plugin: `.vite()`, `.webpack()`, `.rspack()`, `.rollup()`, `.esbuild()`, Bun via `@stylexjs/unplugin/bun` |
| `@stylexjs/babel-plugin` + `@stylexjs/postcss-plugin` | Next.js and other Babel-based setups |
| `@stylexjs/eslint-plugin` | Lint rules |
| `@stylexjs/atoms` | Inline atomic styles (compiled by the babel plugin) |
| `@stylexjs/cli` | Pre-compile a directory without a bundler: `npx stylex --input ./src --output ./dist` |

## Vite

```bash
npm install @stylexjs/stylex
npm install --save-dev @stylexjs/unplugin
```

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/unplugin';

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
});
```

Keep the StyleX plugin before `@vitejs/plugin-react` so Fast Refresh keeps working. Webpack, Rspack, Rollup, and esbuild use the same options via `stylex.webpack()`, `stylex.rspack()`, `stylex.rollup()`, `stylex.esbuild()`.

Vite-only options: `devMode` (`'full'` | `'css-only'` | `'off'`), `devPersistToDisk`. Use `externalPackages` to compile StyleX shipped inside dependencies (for example a design system such as Astryx).

## Next.js (Babel + PostCSS)

```bash
npm install @stylexjs/stylex
npm install --save-dev @stylexjs/babel-plugin @stylexjs/postcss-plugin
```

`babel.config.js`:

```js
const path = require('path');
const dev = process.env.NODE_ENV !== 'production';

module.exports = {
  presets: ['next/babel'],
  plugins: [
    [
      '@stylexjs/babel-plugin',
      {
        dev,
        runtimeInjection: false,
        enableInlinedConditionalMerge: true,
        treeshakeCompensation: true,
        aliases: { '@/*': [path.join(__dirname, '*')] },
        unstable_moduleResolution: { type: 'commonJS' },
      },
    ],
  ],
};
```

`postcss.config.js`:

```js
const babelConfig = require('./babel.config');

module.exports = {
  plugins: {
    '@stylexjs/postcss-plugin': {
      include: ['src/**/*.{js,jsx,ts,tsx}', 'app/**/*.{js,jsx,ts,tsx}'],
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: babelConfig.plugins,
      },
      useCSSLayers: true,
    },
    autoprefixer: {},
  },
};
```

## CSS entrypoint

Every integration needs one CSS file containing the directive, imported from the app root. The compiled CSS is appended there. Include the directive only once.

```css
@stylex;
```

## Key compiler options

| Option | Default | Notes |
|---|---|---|
| `dev` | `false` | Readable class names in development |
| `runtimeInjection` | `false` | Inject styles at runtime; not for production |
| `styleResolution` | `'property-specificity'` | Or `'application-order'` (strict last-wins) |
| `useCSSLayers` | `false` | Wrap output in `@layer`. Set `false` when StyleX must override existing app CSS; otherwise `true` |
| `unstable_moduleResolution` | — | Required for theming (`defineVars` / `createTheme` across files) |
| `aliases` | `{}` | Must match the bundler's path aliases |
| `treeshakeCompensation` | `false` (`true` for Vite/Rollup) | Set when styles disappear after tree-shaking |
| `sxPropName` | `'sx'` | Rename or disable (`false`) the `sx` JSX prop |
| `env` | — | Compile-time values for `stylex.env.*` (experimental) |
| `importSources` | `['@stylexjs/stylex']` | Custom import paths |

Removed in 0.19.1: `enableDebugClassNames` and property-prefixed debug class names.

## ESLint

```bash
npm install --save-dev @stylexjs/eslint-plugin
```

```js
import stylexPlugin from '@stylexjs/eslint-plugin';

export default [
  {
    plugins: { '@stylexjs': stylexPlugin },
    rules: {
      '@stylexjs/valid-styles': 'error',
      '@stylexjs/no-unused': 'error',
      '@stylexjs/no-conflicting-props': 'error',
      '@stylexjs/enforce-extension': 'error',
      '@stylexjs/valid-shorthands': 'warn',
      '@stylexjs/sort-keys': 'warn',
    },
  },
];
```

Other rules: `no-legacy-contextual-styles`, `no-lookahead-selector`. ESLint 10 is supported.

## Troubleshooting

- **No styles:** the CSS file with `@stylex;` isn't imported, the file isn't matched by `include`, or another transform runs before StyleX.
- **Theme variables unresolved:** add `unstable_moduleResolution` and matching `aliases`.
- **Styles lose to existing CSS:** toggle `useCSSLayers` (see the table).
- **Debugging:** the StyleX DevTools extension (Chrome, Firefox, Safari) inspects and overrides atomic styles. For PostCSS, set `STYLEX_POSTCSS_DEBUG=1`.

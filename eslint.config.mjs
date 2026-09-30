import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Process boundaries (see docs/architecture.md). Type-only imports are allowed across them.
const rendererCode = ['src/app/renderer/**/*.{ts,tsx}', 'src/features/*/ui/**/*.{ts,tsx}']
const mainCode = ['src/app/main/**/*.ts', 'src/features/*/main.ts', 'src/features/*/main/**/*.ts']
const preloadCode = ['src/app/preload/**/*.ts', 'src/features/*/preload.ts']
const sharedCode = ['src/shared/**/*.ts', 'src/features/*/ipc.ts']

const noElectron = { name: 'electron', message: 'Only main and preload code may import electron.' }
const noNode = {
  group: ['node:*'],
  message: 'Node built-ins are only available in the main process.',
}
const noMain = {
  group: ['**/main', '**/main/**', '**/app/preload/**', '**/preload'],
  message: 'Talk to the main process through the preload bridge (window.antimony), not imports.',
}
const noRenderer = {
  group: ['**/ui', '**/ui/**', '**/app/renderer/**', 'react', 'react-dom', 'react-dom/*'],
  message: 'Main and preload code must not import renderer code.',
}
const restrict = (paths, patterns) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    { paths, patterns: patterns.map((p) => ({ ...p, allowTypeImports: true })) },
  ],
})

export default tseslint.config(
  { ignores: ['out/', 'coverage/', 'test-results/', 'playwright-report/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: rendererCode,
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
    rules: restrict([noElectron], [noNode, noMain]),
  },
  { files: mainCode, rules: restrict([], [noRenderer]) },
  { files: preloadCode, rules: restrict([], [noRenderer, noNode]) },
  { files: sharedCode, rules: restrict([noElectron], [noNode, noMain, noRenderer]) },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)

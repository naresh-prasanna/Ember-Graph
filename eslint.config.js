import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist', 'dev-dist', 'legacy', 'node_modules', '.mcp-probe-kit', '.agents'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
      'no-cond-assign': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
];

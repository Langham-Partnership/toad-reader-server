import globals from 'globals';
import pluginJs from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  pluginJs.configs.recommended, // Apply recommended ESLint rules
  tseslint.configs.recommended, // Apply recommended TypeScript rules
  prettierConfig, // Disable rules that conflict with Prettier
  {
    files: ['**/*.browser.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser, // Enable browser global variables
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node, // Enable Node.js global variables
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-redeclare': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
]);

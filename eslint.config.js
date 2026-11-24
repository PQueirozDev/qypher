import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.{js,mjs}'], languageOptions: { globals: globals.node } },
  { files: ['apps/showcase/*.js'], languageOptions: { globals: globals.browser } },
  {
    files: ['extensions/browser/src/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
);

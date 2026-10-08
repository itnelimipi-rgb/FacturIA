import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {languageOptions: {globals: {...globals.browser, ...globals.node}}},
  {files: ['src/**/*.tsx'], ...reactHooks.configs.flat.recommended},
]);

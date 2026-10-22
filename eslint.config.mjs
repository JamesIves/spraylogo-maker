import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Everything that must carry a JSDoc comment: functions, methods and classes, plus
 * interfaces, their properties and type aliases.
 */
const documentedContexts = [
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'MethodDefinition',
  'TSInterfaceDeclaration',
  'TSPropertySignature',
  'TSTypeAliasDeclaration',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    files: ['**/*.test.ts'],
    ...vitest.configs.recommended,
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            Number: { message: 'Use number instead', fixWith: 'number' },
            String: { message: 'Use string instead', fixWith: 'string' },
            Boolean: { message: 'Use boolean instead', fixWith: 'boolean' },
            Object: { message: 'Use object instead', fixWith: 'object' },
            '{}': { message: 'Use object instead', fixWith: 'object' },
            Symbol: { message: 'Use symbol instead', fixWith: 'symbol' },
          },
        },
      ],
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-destructuring': [
        'error',
        { array: false, object: true },
        { enforceForRenamedProperties: false },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-alert': 'error',
      'no-debugger': 'error',

      // Names say what they hold: no single letter variables.
      'id-length': ['error', { min: 2, exceptions: ['_'], properties: 'never' }],

      // Inline callbacks (like the one passed to `.map`) are exempt from needing a
      // comment. No fixer: it would only add empty stubs.
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          enableFixer: false,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSPropertySignature',
            'TSTypeAliasDeclaration',
          ],
        },
      ],
      'jsdoc/require-description': ['error', { contexts: documentedContexts }],
      'jsdoc/multiline-blocks': ['error', { noSingleLineBlocks: true }],
      // Types come from TypeScript, so tags are optional.
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
  eslintConfigPrettier,
);

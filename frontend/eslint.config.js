import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (type-aware not needed for unused import detection)
  ...tseslint.configs.recommended,

  // Vue 3 recommended rules (includes vue/no-unused-components, vue/no-unused-vars)
  ...pluginVue.configs['flat/recommended'],

  // Configure the Vue parser to use TypeScript and add browser globals
  {
    files: ['**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // Add browser globals for all TS files (they run in a browser context)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Project-specific rule overrides
  {
    files: ['**/*.vue', '**/*.ts', '**/*.tsx'],
    rules: {
      // --- Unused import detection ---
      // TypeScript's noUnusedLocals covers variables but not all import cases in Vue SFCs.
      // This rule catches unused imports that TypeScript misses in <script setup> blocks.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // Do not flag variables used only in template bindings — vue-tsc handles those
        ignoreRestSiblings: true,
      }],

      // --- Vue-specific rules ---
      // Allow multi-word component names (single-word names like App.vue are fine)
      'vue/multi-word-component-names': 'off',

      // Allow v-html when needed (used sparingly in this project)
      'vue/no-v-html': 'off',

      // Disable attribute ordering enforcement to avoid noisy diffs
      'vue/attributes-order': 'off',

      // Allow self-closing in normal elements (project preference)
      'vue/html-self-closing': 'off',

      // Disable max-attributes-per-line to avoid formatting churn
      'vue/max-attributes-per-line': 'off',

      // Disable singleline-html-element-content-newline to avoid formatting churn
      'vue/singleline-html-element-content-newline': 'off',

      // Disable multiline-html-element-content-newline to avoid formatting churn
      'vue/multiline-html-element-content-newline': 'off',

      // Disable html-indent to avoid formatting churn (not using Prettier)
      'vue/html-indent': 'off',

      // Disable html-closing-bracket-newline to avoid formatting churn
      'vue/html-closing-bracket-newline': 'off',

      // Disable first-attribute-linebreak to avoid formatting churn
      'vue/first-attribute-linebreak': 'off',

      // Allow TypeScript non-null assertions (used in this codebase)
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Allow explicit any in limited cases (existing codebase pattern)
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'e2e/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
]

// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The tests install fake Nuxt and browser objects and reach into them
    // with casts; the module itself must not.
    files: ['test/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Single-file components are Vue's business, and `vue-tsc` — not
    // `typescript-eslint` — is what typechecks them here.
    ignores: ['**/*.vue'],
  },
  {
    files: ['**/*.mjs', '*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
)

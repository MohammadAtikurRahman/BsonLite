# Contributing

Work from `main`, which defaults to engine 9.0.4 and driver 7.7.0.

```sh
npm ci
npm test
npm run build:preview
npm run test:packaging
node native/modern/console-compat/verify.cjs
npm --prefix native/modern/console-compat ci --ignore-scripts
npm run build:modern:preview
npm run test:modern
```

Source previews do not include a database engine. Changes to storage, migration, lifecycle, dependencies or bundling require the actual Windows engine workflow, including source/native, runtime/migration/CLI and final embedded gates. Do not manufacture validation flags or replace the custom engine with a stock binary.

Use the explicit legacy build commands for backward-compatibility checks. Preserve old stores, protected vaults and encrypted backups. Review [SECURITY.md](SECURITY.md), [native build instructions](native/modern/README.md) and component licenses before distributing an engine.

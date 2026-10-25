# Getting started

The current core defaults to SDK 0.7.0-alpha.0, engine 9.0.4 and driver 7.7.0. Use Windows x64 build 20348+ and Node.js 20.19+.

## Ready-to-use application SDK

Use `BsonLite.cjs` from a successful native Windows workflow artifact. The validated CJS includes its custom engine and JavaScript dependencies. Put it in a new application folder and use the example in [README.md](README.md). Installing or importing it does not start a database; call `await BsonLite.connect()` during application startup.

Data defaults to `./Database`. The engine, protected vault and temporary TLS files use private OS application data. These locations belong together; keep matching encrypted backups.

## Source checkout

```sh
git pull --ff-only origin main
npm ci
npm test
npm run build:preview
npm run test:packaging
```

The output `dist/BsonLite.cjs` reports engine 9.0.4 and source-preview mode. That preview does not contain a native engine and cannot run a customer database. Use a validated artifact or the full [native build/test workflow](native/modern/README.md) for an executable SDK.

`npm run build` is the full modern build and requires the validated engine assets and source. `npm run build:legacy:preview` is an explicit old-engine compatibility build; it does not select the current default.

## Existing data

An encrypted 4.0.28 store needs a [logical upgrade](native/modern/UPGRADE.md) through the previous SDK into a new directory. Keep the original directory, protected vault and encrypted backup. A missing/wrong key is an error, never a reason to reset a database.

For Console/CLI access, follow [CONSOLE.md](CONSOLE.md). For publishing an npm prerelease, use the [SDK publishing guide](https://github.com/MohammadAtikurRahman/Bsonlite-SDK/blob/main/MODERN_ENGINE.md).

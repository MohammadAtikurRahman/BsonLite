# BsonLite Console and CLI

Start your application using the integrated SDK:

```js
const BsonLite = require('./BsonLite.cjs');
await BsonLite.connect();
```

Open BsonLite Console 0.2.0. The running local application appears automatically; select it and click Connect. No project-folder scan or separate helper package is required. Multiple apps are listed separately. The SDK does not open the GUI itself.

Use the [software and CLI page](https://bsonlite.com/console.html) for downloads. The GUI and CLI use the same connection layer.

## Terminal queries

From a Console source checkout with its dependencies installed:

```sh
node bin/bsonlite.cjs --eval 'db.users.find({})'
node bin/bsonlite.cjs --write --eval 'db.users.insertOne({name:"Atik"})'
```

No URI argument discovers the running SDK. You can also supply `--uri`, or set `BSONLITE_URI`. Treat generated `bsonlite://127.0.0.1:...#...` URLs as private bearer credentials.

The viewer starts read-only. Writes require the GUI's explicit write setting or CLI `--write`. Supported query syntax includes collections, CRUD, indexes and aggregation; this console is not an unrestricted JavaScript interpreter. Use `--help` for supported commands.

The modern SDK's BSON 7 values and Console's BSON 6 client are converted at the authenticated EJSON boundary. Use the modern SDK's own BSON exports in application code.

Set `console: false` on initial connection, or `BSONLITE_CONSOLE=0`, to disable automatic viewer access. Disconnecting the viewer leaves the application running; `await BsonLite.disconnect()` stops the application connection and removes its session.

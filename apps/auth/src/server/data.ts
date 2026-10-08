import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import { Config, Effect, FileSystem, Layer, Path } from "effect";

/** Local development only; the Worker supplies its Durable Object SQL client. */
export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const directory = yield* Config.String("AUTH_DATA_DIR").pipe(
      Config.withDefault(new URL("../../.data/", import.meta.url).pathname),
    );

    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });

    return SqliteClient.layer({ filename: path.join(directory, "auth.sqlite") });
  }),
);

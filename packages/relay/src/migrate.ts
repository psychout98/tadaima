import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMigrationsFolder(): string {
  // In development: ../../packages/shared/drizzle (from packages/relay/src/)
  // In Docker build: ../shared/drizzle (from packages/relay/dist/)
  const candidates = [
    resolve(__dirname, "../shared/drizzle"),
    resolve(__dirname, "../../shared/drizzle"),
    resolve(__dirname, "../../packages/shared/drizzle"),
    resolve(process.cwd(), "packages/shared/drizzle"),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  throw new Error(
    `Could not find migrations folder. Tried: ${candidates.join(", ")}`,
  );
}

export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  const migrationsFolder = findMigrationsFolder();
  console.log(`Running migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations complete.");

  await client.end();
}

// Run directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("migrate.js") ||
  process.argv[1]?.endsWith("migrate.ts");

if (isMainModule) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ── Admin ──────────────────────────────────────────────────────

export const admin = pgTable("admin", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Instance Settings ──────────────────────────────────────────

export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Profiles ───────────────────────────────────────────────────

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  pinHash: text("pin_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Refresh Tokens ─────────────────────────────────────────────

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => admin.id, {
      onDelete: "cascade",
    }),
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("refresh_tokens_admin_id_idx").on(table.adminId)],
);

// ── Devices ────────────────────────────────────────────────────

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    tokenHash: text("token_hash").notNull(),
    isOnline: boolean("is_online").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("devices_profile_id_idx").on(table.profileId)],
);

// ── Pairing Codes ──────────────────────────────────────────────

export const pairingCodes = pgTable("pairing_codes", {
  code: text("code").primaryKey(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimed: boolean("claimed").notNull().default(false),
  deviceId: uuid("device_id").references(() => devices.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Download Queue ─────────────────────────────────────────────

export const downloadQueue = pgTable(
  "download_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("download_queue_profile_id_idx").on(table.profileId),
    index("download_queue_device_id_idx").on(table.deviceId),
  ],
);

// ── Download History ───────────────────────────────────────────

export const downloadHistory = pgTable(
  "download_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id").notNull(),
    imdbId: text("imdb_id").notNull(),
    title: text("title").notNull(),
    year: integer("year").notNull(),
    mediaType: text("media_type").notNull(),
    season: integer("season"),
    episode: integer("episode"),
    episodeTitle: text("episode_title"),
    magnet: text("magnet").notNull(),
    torrentName: text("torrent_name").notNull(),
    expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: text("status").notNull(),
    error: text("error"),
    retryable: boolean("retryable"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("download_history_profile_id_idx").on(table.profileId),
    index("download_history_device_id_idx").on(table.deviceId),
  ],
);

// ── Recently Viewed ────────────────────────────────────────────

export const recentlyViewed = pgTable(
  "recently_viewed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id").notNull(),
    mediaType: text("media_type").notNull(),
    title: text("title").notNull(),
    year: integer("year").notNull(),
    posterPath: text("poster_path"),
    imdbId: text("imdb_id"),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("recently_viewed_profile_id_idx").on(table.profileId),
    index("recently_viewed_profile_tmdb_idx").on(
      table.profileId,
      table.tmdbId,
      table.mediaType,
    ),
  ],
);

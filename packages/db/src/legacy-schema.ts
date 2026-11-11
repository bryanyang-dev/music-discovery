import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const feeds = pgTable("feeds", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull().unique(),
  title: text("title").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const articles = pgTable("articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  feedId: uuid("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  guid: text("guid"), url: text("url"), title: text("title").notNull(),
  author: text("author"), summary: text("summary"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("articles_feed_source_unique").on(table.feedId, table.sourceKey),
  index("articles_published_at_idx").on(table.publishedAt),
]).enableRLS();


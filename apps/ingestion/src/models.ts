/** Payload for direct invocation of the ingestion Lambda. */
export interface IngestionEvent {
  /** Registered source key; the feed URL is loaded from the database. */
  sourceKey: string;
}

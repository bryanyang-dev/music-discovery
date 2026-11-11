# Stereogum source evaluation

Evaluated 2026-11-11 at 23:00 UTC. This is a feed/page inspection, not an implemented
adapter or a source registration. No database, dependency or deployment changes.

## Observed feed

The [main RSS feed](https://stereogum.com/feed) returned RSS 2.0 with 40 items and
48,828 response bytes. Its lastBuildDate was 2026-11-11 22:31:01 UTC. This is a
snapshot, not a guaranteed item count or feed window. ETag was present;
Last-Modified was absent in this response.

- 33 items carried the `New Music` category. The other seven were five news posts,
  one column and one album review. Categories can overlap: one of those 33 music
  items also carried `News`, so these are classification buckets, not disjoint tags.
- Every item had a title, link, GUID, writer, publication date, categories and a
  Media RSS image. Categories mix sections, artists and other mentioned people;
  they are not a credited-artist list or genre taxonomy.
- All 40 descriptions contained only the post attribution/link. None included
  `content:encoded`. The feed supplies discovery metadata, not full article text.
- `dc:creator` identifies the journalist. GUIDs identify articles, not recordings.

## Linked page findings

Four feed-linked pages were fetched directly: a single, an EP announcement with a
lead single, a collaboration, and an album stream. Their JSON-LD described
`Article` objects with headlines, dates, authors and images. None exposed a
`MusicRecording` or the Pitchfork `Review.itemReviewed` structure in that sample.
Article URLs redirected to versions without a trailing slash.

Examples and extraction implications:

| Article | Interpretation |
| --- | --- |
| [Index single](https://stereogum.com/2517667/index-heartbeat-glitch/music) | A clear single-track candidate; validate its primary headline/body and credits. |
| [Parent Teacher EP announcement](https://stereogum.com/2517665/parent-teacher-announces-new-ep-celestial-mom-hear-eight-cents/music) | Promotes a lead single but also lists unreleased EP tracks. Extracting every quoted title would overcount recommendations. |
| [DJ Seinfeld / Peter Xan collaboration](https://stereogum.com/2517660/dj-seinfeld-peter-xan-modern-dystopia/music) | Artist credits require explicit evidence; do not split every ampersand or treat all tags as performers. |
| [2hollis album stream](https://stereogum.com/2517631/stream-2hollis-genre-bending-new-album-pirouette-featuring-writing-and-production-from-mk-gee/music) | Tagged New Music, but describes an album and several tracks/producers rather than a single recommendation. |

The site also publishes [weekly song lists](https://stereogum.com/2516820/the-5-best-songs-of-the-week-651/lists/the-5-best-songs-of-the-week)
with multiple explicitly selected tracks in one article. That example was inspected
separately; it was not among the 40 items in the fetched feed snapshot. Its headings
and embeds identify picks, while navigation/related links also mention other songs.
Extraction must remain scoped to the main article content.

## Recommended initial scope

Treat a feed item as a **post**, yielding zero or more candidate tracks. For a first
implementation, accept only posts with one explicitly identified promoted track:

1. Parse discovery metadata and classify eligibility before fetching pages when
   possible. `New Music` is a useful filter, not proof that an item is a track.
2. Fetch eligible article pages using a Stereogum-specific URL policy; the feed URL
   remains database-configured. Verify artist/title evidence in the primary
   article, preserving credited artist punctuation and collaborations.
3. Support explicit single-track headlines first. Add announcement/lead-single
   patterns only with fixtures proving the promoted song is distinct from an
   album tracklist, previously released songs and unrelated mentions.
4. Intentionally skip news, album streams/reviews, roundups and ambiguous posts in
   the initial scope. Non-track posts are normal skips, not malformed tracks or
   partial-run failures. Distinguish those from HTTP failures and broken extraction
   of an otherwise supported track post.
5. Keep release dates/genres/labels unknown unless explicitly supported; article
   publication dates are not release dates.

The current `SourceAdapter.extractTrack` requires exactly one track for each
entry. It needs an explicit skip outcome (with a reason and skipped-entry count)
before this feed can be ingested cleanly. Successful runs with intentional skips
should still retain HTTP validators.

The database's unique `(source_id, source_url)` identity supports a first phase of
zero-or-one track per post without a migration. Supporting multiple tracks from
one post later requires a deliberate track identity/provenance change and a new
migration; fabricating URL fragments or guessing titles into identity is unsafe.
Keep applied migrations unchanged.

Store the feed URL in the source row, select the adapter with `name: stereogum`,
and use a category describing the chosen ingestion scope rather than treating all
New Music items as singles. Registration must wait until that adapter is implemented
and validated; this evaluation alone does not make `sources:add` accept Stereogum.

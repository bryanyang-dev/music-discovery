# Fixture provenance

pitchfork.xml and review.html are synthetic minimal structural examples.
Their shape follows the public Best New Tracks RSS and two review pages inspected
on 2026-11-10. Names, title, summary, and body text are invented. They contain no
full Pitchfork review text, downloaded imagery, or real credentials.

Observed pages:
- https://pitchfork.com/feed/reviews/best/tracks/rss
- https://pitchfork.com/reviews/tracks/kelela-idea-1/
- https://pitchfork.com/reviews/olivia-rodrigo-chappell-roan-expectations/

The feed's dc:creator is a review author. It does not identify the musician.
Review JSON-LD has a MusicRecording itemReviewed; credited header artist links
supply artists when the structured recording lacks byArtist. CSS hash suffixes
are not treated as stable identifiers. Parser tests deliberately include an
unrelated body artist link so it cannot leak into the credited artist list.


const MAX_TEXT_CHARACTERS = 4_000;
const MAX_UNICODE_CODE_POINT = 0x10ffff;
const FIRST_SURROGATE_CODE_POINT = 0xd800;
const LAST_SURROGATE_CODE_POINT = 0xdfff;

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, entity: string) => {
      if (!entity.startsWith("#")) {
        return entities[entity.toLowerCase()] ?? whole;
      }
      const point =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      const isSurrogate =
        point >= FIRST_SURROGATE_CODE_POINT &&
        point <= LAST_SURROGATE_CODE_POINT;
      if (point <= 0 || point > MAX_UNICODE_CODE_POINT || isSurrogate) {
        return "�";
      }
      return String.fromCodePoint(point);
    },
  );
}

export function plainText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const stripped = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ");
  return (
    decodeEntities(stripped)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_CHARACTERS) || null
  );
}

export function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"),
  );
  return match ? decodeEntities(match[1] ?? match[2] ?? "") : null;
}

export function unquoteTitle(value: string): string {
  const text = value.trim();
  if (
    (text.startsWith("“") && text.endsWith("”")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function validDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// The Mailman owns every mail @-command. Pure parsing, shared by the composer
// (to route a sent draft) and the tests.

export const MAIL_ALIASES = ['mail', 'email', 'mailman', 'inbox'] as const;
export type MailAlias = (typeof MAIL_ALIASES)[number];

const ALIAS = /(^|[\s([{"'“‘«])@(mailman|email|inbox|mail)(?=$|[\s)\]}"'”’»]|[.,:!?]+(?=$|[\s)\]}"'”’»]))/i;
const ALIAS_ALL = new RegExp(ALIAS.source, 'gi');

export interface MailRequest {
  alias: MailAlias;
  /** Whatever the user wrote besides the alias, e.g. "summarize my unread". */
  request: string;
}

/** `@mail`, `@email`, `@mailman`, `@inbox` anywhere in a draft (never inside an
 *  address like bob@mail.com). Returns null for ordinary messages. */
export function parseMailRequest(text: string): MailRequest | null {
  if (typeof text !== 'string') return null;
  const m = ALIAS.exec(text);
  if (!m) return null;
  const request = text.replace(ALIAS_ALL, (_a, prefix: string) => prefix).replace(/\s+/g, ' ').trim();
  return { alias: m[2].toLowerCase() as MailAlias, request };
}

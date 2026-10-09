// Shared (type-only) shapes for Jargon Mail: what main may hand the renderer.
// Nothing here ever carries a password or a token.

export type MailProviderId = 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'zoho' | 'fastmail' | 'generic';

/** Public provider info for the sign-in screen (hosts are not secrets). */
export interface MailProviderInfo {
  id: MailProviderId;
  name: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** One line of provider-specific help. */
  help: string;
  /** True when a fixed https help page exists (opened via mail:openHelp). */
  hasHelpPage: boolean;
  /** How the provider was recognised. */
  via: 'domain' | 'mx' | 'guess';
}

export interface MailSummaryLite {
  uid: number;
  from: string;
  subject: string;
  date: string | null;
  seen: boolean;
}

/** A draft the Mailman produced. It is NEVER sent automatically — the panel
 *  shows it in the composer and the user must press Send and confirm. */
export interface MailDraft {
  to: string;
  cc: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  replyToUid: number | null;
  /** Things the user should double-check (e.g. a recipient the AI chose). */
  warnings: string[];
}

export type MailAskItem =
  | { kind: 'list'; title: string; messages: MailSummaryLite[] }
  | { kind: 'open'; uid: number; subject: string }
  | { kind: 'text'; title: string; text: string; uid: number | null }
  | { kind: 'draft'; title: string; draft: MailDraft }
  | { kind: 'error'; title: string; text: string };

export interface MailAskInput {
  request: string;
  selectedUid?: number | null;
  /** 'compose': skip the planner and write one new mail from `request` (needs an address in it). */
  mode?: 'compose';
  draft?: { to?: string; cc?: string; subject?: string; text?: string } | null;
}

export type MailAskResult =
  | {
    ok: true;
    note: string;
    /** Human labels of the steps that ran, in order. */
    steps: string[];
    items: MailAskItem[];
    /** True when the AI planner was unavailable and a simple built-in plan ran. */
    usedFallback: boolean;
    warnings: string[];
  }
  | { ok: false; error: string };

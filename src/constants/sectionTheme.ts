/**
 * Accent colours for the Sample and Return sections, and for each mailbox within them.
 *
 * **Sample is Acme green throughout and must stay that way.** A violet palette for the whole
 * Return section shipped briefly in round 13 and was reverted the same day — one flat colour across
 * every Return mailbox made them indistinguishable from each other, which was the objection.
 *
 * So the Return section is coloured *per mailbox* instead: Inbox teal, Pending amber, Approved
 * indigo. Each Return mailbox is then distinguishable from its siblings and from Sample, while
 * nothing in Sample Ordering changes.
 *
 * Tailwind cannot build class names at runtime, so every palette is written out as complete literal
 * class strings.
 */

/**
 * Sections that have their own accent. `all` (the combined Submitted-requests list) is not a
 * section and has no accent of its own — it uses the house green.
 */
export type RequestSectionScope = 'sample' | 'return'

/** The three in-app mailboxes each section provides. */
export type MailboxKind = 'inbox' | 'pending' | 'approved'

export type SectionTheme = {
  /** Gradient for the small vertical bar beside a section heading. */
  accentBar: string
  /** Solid text colour for figures and links. */
  text: string
  /** Tint + border for the "total amount" tile. */
  tile: string
  /** Chevron circle on a collapsed card. */
  chevron: string
  /** Header band behind a page title. */
  headerBand: string
  /** Primary button. */
  button: string
}

/** Acme green — the house colour, and everything Sample uses. */
const GREEN: SectionTheme = {
  accentBar: 'from-[#00A651] to-[#008a42]',
  text: 'text-[#00A651]',
  tile: 'bg-gradient-to-br from-[#00A651]/10 to-[#00A651]/5 border border-[#00A651]/20',
  chevron: 'bg-[#00A651]/10 text-[#00A651]',
  headerBand: 'bg-gradient-to-r from-[#00A651] to-[#008A44]',
  button: 'bg-[#00A651] hover:bg-[#008a42]',
}

/** Return → Inbox. */
const TEAL: SectionTheme = {
  accentBar: 'from-[#0E7490] to-[#155E75]',
  text: 'text-[#0E7490]',
  tile: 'bg-gradient-to-br from-[#0E7490]/10 to-[#0E7490]/5 border border-[#0E7490]/20',
  chevron: 'bg-[#0E7490]/10 text-[#0E7490]',
  headerBand: 'bg-gradient-to-r from-[#0E7490] to-[#155E75]',
  button: 'bg-[#0E7490] hover:bg-[#155E75]',
}

/** Return → Pending. */
const AMBER: SectionTheme = {
  accentBar: 'from-[#B45309] to-[#92400E]',
  text: 'text-[#B45309]',
  tile: 'bg-gradient-to-br from-[#B45309]/10 to-[#B45309]/5 border border-[#B45309]/20',
  chevron: 'bg-[#B45309]/10 text-[#B45309]',
  headerBand: 'bg-gradient-to-r from-[#B45309] to-[#92400E]',
  button: 'bg-[#B45309] hover:bg-[#92400E]',
}

/**
 * Return → Approved. Indigo, not a green: emerald was tried first and sat so close to Acme green
 * that the Return and Sample approved pages were indistinguishable, which defeats the point. The
 * per-row APPROVED status pill stays green, so the meaning is not carried by this accent alone.
 */
const INDIGO: SectionTheme = {
  accentBar: 'from-[#4338CA] to-[#3730A3]',
  text: 'text-[#4338CA]',
  tile: 'bg-gradient-to-br from-[#4338CA]/10 to-[#4338CA]/5 border border-[#4338CA]/20',
  chevron: 'bg-[#4338CA]/10 text-[#4338CA]',
  headerBand: 'bg-gradient-to-r from-[#4338CA] to-[#3730A3]',
  button: 'bg-[#4338CA] hover:bg-[#3730A3]',
}

const RETURN_BY_MAILBOX: Record<MailboxKind, SectionTheme> = {
  inbox: TEAL,
  pending: AMBER,
  approved: INDIGO,
}

/**
 * The section's own accent, for anything not tied to a single mailbox.
 *
 * Both sections are green here. Return's per-mailbox colours come from `mailboxTheme`; a page that
 * asks only for its section keeps the house colour.
 */
export function sectionTheme(_scope: RequestSectionScope): SectionTheme {
  return GREEN
}

/**
 * The accent for one mailbox in one section.
 *
 * Sample returns green for every mailbox, unchanged. Return returns its per-mailbox colour.
 */
export function mailboxTheme(scope: RequestSectionScope, kind: MailboxKind): SectionTheme {
  return scope === 'return' ? RETURN_BY_MAILBOX[kind] : GREEN
}

/**
 * The Return section's "start a new request" tile.
 *
 * Rose, because the Sample and Return call-to-action tiles were both Acme green and sat side by
 * side in the nav. Deliberately not `#7C3AED` — that violet was the round-13 palette and was
 * rejected. Distinct from the three mailbox accents (teal / amber / indigo) too, so all four Return
 * tiles read apart at a glance.
 */
export const RETURN_CTA_TILE = { from: '#BE123C', to: '#9F1239' }

/** Return mailbox accents as plain hex, for the home tiles which are gradients not utility classes. */
export const RETURN_MAILBOX_TILE: Record<MailboxKind, { from: string; to: string }> = {
  inbox: { from: '#0E7490', to: '#155E75' },
  pending: { from: '#B45309', to: '#92400E' },
  approved: { from: '#4338CA', to: '#3730A3' },
}

/**
 * The service review queue's accent. Deliberately not a fourth MailboxKind: that union drives
 * mailboxTheme and the section chooser, and review is a queue for one team rather than a mailbox
 * every section has.
 *
 * Purple, chosen for separation rather than taste. The four accents already in play are teal
 * (inbox), amber (pending), indigo (approved) and crimson (the CTA); this sat on amber at first and
 * was indistinguishable from the Pending tile beside it. Purple is the widest gap left that does
 * not stray into the green the Sample section owns.
 */
export const RETURN_REVIEW_TILE = { from: '#9333EA', to: '#6B21A8' }

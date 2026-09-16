/**
 * Enum mirrors of the Prisma schema. The web app imports these so it never has
 * to depend on the generated Prisma client (which is server-only).
 * `packages/database/src/__tests__/enum-parity.spec.ts` keeps them in sync.
 */

export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const DOCUMENT_TYPES = ['PDF', 'DOCX', 'TXT', 'MARKDOWN', 'WEB', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SOURCE_KINDS = ['DOCUMENT', 'MEETING', 'MESSAGE', 'ANNOUNCEMENT'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const PROCESSING_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export const CHAT_ROLES = ['USER', 'ASSISTANT', 'SYSTEM'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const QUESTION_STATUSES = ['OPEN', 'ANSWERED', 'IGNORED'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const IMPORTANCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];

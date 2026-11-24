export type FormAttachmentKind = 'pdf' | 'jpeg' | 'png' | 'gif' | 'webp';

export interface FormAttachmentMeta {
  id: string;
  formId: string;
  clientFilename: string;
  fileKind: FormAttachmentKind;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

export const MAX_ATTACHMENTS_PER_FORM = 3;
export const MAX_ATTACHMENT_SIZE_MB = 10;

export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp';

export function isImageAttachmentKind(kind: FormAttachmentKind): boolean {
  return kind !== 'pdf';
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

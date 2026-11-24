import React from 'react';
import apiClient from '../services/api.service';
import {
  FormAttachmentMeta,
  formatAttachmentSize,
  isImageAttachmentKind,
} from '../utils/form-attachments.util';

type Props = {
  formId: string;
  formType?: string;
  readOnly?: boolean;
  /** Approval token for email approvers (no login). */
  approvalToken?: string | null;
  /** Pre-loaded attachments (e.g. from token approval payload). */
  initialAttachments?: FormAttachmentMeta[];
  className?: string;
  id?: string;
  onAttachmentsChange?: (attachments: FormAttachmentMeta[]) => void;
};

function buildDownloadPath(attachmentId: string, token?: string | null): string {
  if (token) {
    return `/public/approvals/attachments/${attachmentId}?token=${encodeURIComponent(token)}`;
  }
  return '';
}

async function fetchBlobUrl(path: string): Promise<string> {
  const response = await apiClient.get(path, { responseType: 'blob' });
  return URL.createObjectURL(response.data);
}

export default function FormAttachmentsGallery({
  formId,
  formType,
  readOnly = true,
  approvalToken,
  initialAttachments,
  className = '',
  id,
  onAttachmentsChange,
}: Props) {
  const [attachments, setAttachments] = React.useState<FormAttachmentMeta[]>(initialAttachments ?? []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = React.useState<Record<string, string>>({});
  const [lightboxId, setLightboxId] = React.useState<string | null>(null);

  const showSection = formType ? formType === 'ZNCCLAIM' : true;

  React.useEffect(() => {
    if (initialAttachments) {
      setAttachments(initialAttachments);
    }
  }, [initialAttachments]);

  React.useEffect(() => {
    if (!showSection || !formId) return;
    if (initialAttachments) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const listUrl = approvalToken
      ? `/public/approvals/attachments?token=${encodeURIComponent(approvalToken)}`
      : `/forms/${formId}/attachments`;

    void apiClient
      .get(listUrl)
      .then((res) => {
        if (cancelled) return;
        const list = (res.data?.attachments ?? []) as FormAttachmentMeta[];
        setAttachments(list);
        onAttachmentsChange?.(list);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load attachments');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [formId, approvalToken, showSection, initialAttachments, onAttachmentsChange]);

  React.useEffect(() => {
    if (!showSection) return;
    const imageAttachments = attachments.filter((a) => isImageAttachmentKind(a.fileKind));
    let cancelled = false;

    void (async () => {
      const next: Record<string, string> = {};
      for (const att of imageAttachments) {
        try {
          const path = approvalToken
            ? buildDownloadPath(att.id, approvalToken)
            : `/forms/${formId}/attachments/${att.id}`;
          next[att.id] = await fetchBlobUrl(path);
        } catch {
          /* skip preview */
        }
      }
      if (!cancelled) setPreviewUrls(next);
    })();

    return () => {
      cancelled = true;
      Object.values(previewUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, formId, approvalToken, showSection]);

  React.useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [previewUrls]);

  if (!showSection) return null;
  if (loading && attachments.length === 0) {
    return (
      <div className={`text-sm text-gray-500 ${className}`} id={id}>
        Loading attachments…
      </div>
    );
  }
  if (error && attachments.length === 0) return null;
  if (attachments.length === 0) return null;

  async function openAttachment(att: FormAttachmentMeta) {
    const path = approvalToken
      ? buildDownloadPath(att.id, approvalToken)
      : `/forms/${formId}/attachments/${att.id}`;
    try {
      const blobUrl = await fetchBlobUrl(path);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch {
      setError('Could not open attachment');
    }
  }

  return (
    <div className={className} id={id}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 bg-gradient-to-b from-[#00A651] to-[#008a42] rounded-full" />
        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
          Supporting documents
        </h4>
        <span className="text-xs text-gray-500">({attachments.length})</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="border border-gray-200 rounded-lg p-3 bg-gray-50 flex gap-3 items-start"
          >
            {isImageAttachmentKind(att.fileKind) && previewUrls[att.id] ? (
              <button
                type="button"
                onClick={() => setLightboxId(att.id)}
                className="shrink-0 rounded overflow-hidden border border-gray-200 bg-white"
              >
                <img
                  src={previewUrls[att.id]}
                  alt={att.clientFilename}
                  className="w-20 h-20 object-cover"
                />
              </button>
            ) : (
              <div className="w-20 h-20 shrink-0 flex items-center justify-center rounded border border-gray-200 bg-white text-xs font-bold text-red-700 uppercase">
                {att.fileKind === 'pdf' ? 'PDF' : att.fileKind}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate" title={att.clientFilename}>
                {att.clientFilename}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{formatAttachmentSize(att.sizeBytes)}</p>
              <button
                type="button"
                onClick={() => void openAttachment(att)}
                className="mt-2 text-xs font-semibold text-[#00A651] hover:underline"
              >
                {att.fileKind === 'pdf' ? 'View PDF' : 'View full size'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {lightboxId && previewUrls[lightboxId] && (
        <div
          className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setLightboxId(null)}
          role="presentation"
        >
          <img
            src={previewUrls[lightboxId]}
            alt=""
            className="max-w-full max-h-[90vh] rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {!readOnly && error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

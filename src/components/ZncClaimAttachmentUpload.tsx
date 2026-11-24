import React from 'react';
import apiClient from '../services/api.service';
import FormAttachmentsGallery from './FormAttachmentsGallery';
import {
  ATTACHMENT_ACCEPT,
  FormAttachmentMeta,
  MAX_ATTACHMENT_SIZE_MB,
  MAX_ATTACHMENTS_PER_FORM,
} from '../utils/form-attachments.util';

type Props = {
  formId: string | undefined;
  onNeedDraft: () => Promise<string | null>;
  disabled?: boolean;
};

export default function ZncClaimAttachmentUpload({ formId, onNeedDraft, disabled }: Props) {
  const [attachments, setAttachments] = React.useState<FormAttachmentMeta[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resolvedFormId, setResolvedFormId] = React.useState<string | undefined>(formId);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setResolvedFormId(formId);
  }, [formId]);

  React.useEffect(() => {
    if (!resolvedFormId) return;
    void apiClient.get(`/forms/${resolvedFormId}/attachments`).then((res) => {
      setAttachments(res.data?.attachments ?? []);
    }).catch(() => {
      /* ignore */
    });
  }, [resolvedFormId]);

  async function ensureFormId(): Promise<string | null> {
    if (resolvedFormId) return resolvedFormId;
    const id = await onNeedDraft();
    if (id) setResolvedFormId(id);
    return id;
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError(null);

    if (file.size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024) {
      setError(`File must be ${MAX_ATTACHMENT_SIZE_MB} MB or smaller`);
      return;
    }

    if (attachments.length >= MAX_ATTACHMENTS_PER_FORM) {
      setError(`Maximum ${MAX_ATTACHMENTS_PER_FORM} files allowed`);
      return;
    }

    setUploading(true);
    try {
      const targetFormId = await ensureFormId();
      if (!targetFormId) {
        setError('Save draft on server first, then upload');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post(`/forms/${targetFormId}/attachments`, formData);
      const att = res.data?.attachment as FormAttachmentMeta;
      if (att) setAttachments((prev) => [...prev, att]);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Upload failed';
      setError(msg);
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(attachmentId: string) {
    if (!resolvedFormId) return;
    setError(null);
    try {
      await apiClient.delete(`/forms/${resolvedFormId}/attachments/${attachmentId}`);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch {
      setError('Could not remove file');
    }
  }

  return (
    <div className="bg-white border-2 border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-start gap-2 mb-3">
        <svg className="w-5 h-5 text-[#00A651] shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4z" clipRule="evenodd" />
        </svg>
        <div>
          <label className="block text-base font-semibold text-gray-800">
            Upload photo or screenshot
          </label>
          <p className="text-xs text-gray-500 mt-1">
            PDF, JPG, PNG, GIF, or WebP — up to {MAX_ATTACHMENT_SIZE_MB} MB each, max{' '}
            {MAX_ATTACHMENTS_PER_FORM} files
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS_PER_FORM}
        onChange={(e) => void onFileSelected(e)}
      />

      <button
        type="button"
        disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS_PER_FORM}
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:border-[#00A651] hover:text-[#00A651] disabled:opacity-50 disabled:cursor-not-allowed w-full"
      >
        {uploading ? 'Uploading…' : '+ Choose file'}
      </button>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {attachments.length > 0 && (
        <ul className="mt-4 space-y-2">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center justify-between gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"
            >
              <span className="truncate">{att.clientFilename}</span>
              <button
                type="button"
                onClick={() => void onDelete(att.id)}
                className="text-red-600 text-xs font-semibold shrink-0 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {resolvedFormId && attachments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <FormAttachmentsGallery
            formId={resolvedFormId}
            formType="ZNCCLAIM"
            readOnly
            initialAttachments={attachments}
          />
        </div>
      )}
    </div>
  );
}

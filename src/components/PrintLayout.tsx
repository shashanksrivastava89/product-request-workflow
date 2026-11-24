import React from 'react';
import { useAuth } from '../providers/AuthContext';

interface PrintLayoutProps {
  children: React.ReactNode;
  title: string;
  referenceNumber?: string;
  status?: string;
  showWatermark?: boolean;
  watermarkText?: string;
  className?: string;
}

export default function PrintLayout({
  children,
  title,
  referenceNumber,
  status,
  showWatermark = false,
  watermarkText = 'DRAFT',
  className = '',
}: PrintLayoutProps) {
  const { user } = useAuth();
  const printDate = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`print-container ${className}`}>
      {showWatermark && (
        <div
          className="draft-watermark no-print"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) rotate(-45deg)',
            fontSize: '72pt',
            color: 'rgba(0, 0, 0, 0.1)',
            zIndex: -1,
            pointerEvents: 'none',
            fontWeight: 'bold',
          }}
        >
          {watermarkText}
        </div>
      )}

      <div className="print-header print-header--compact print-section print-section--keep">
        <div className="print-header-top mb-4">
          <div className="print-header-inner">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="print-logo shrink-0">
                <img
                  src="/acme-logo.svg"
                  alt="Acme"
                  className="h-10 print:h-8"
                  style={{ maxHeight: '48px' }}
                />
              </div>
              <div className="print-title min-w-0">
                <h1 className="text-xl print:text-base font-bold text-gray-900 mb-0.5 leading-tight">
                  {title}
                </h1>
                {referenceNumber && (
                  <p className="reference-number text-sm print:text-xs text-gray-600 font-mono leading-tight">
                    Reference: <span className="font-bold">{referenceNumber}</span>
                  </p>
                )}
                {status && (
                  <p className="status text-sm print:text-xs text-gray-600 leading-tight">
                    Status: <span className="font-semibold">{status}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="print-header-meta text-xs print:text-[10px] text-gray-500 border-t pt-1 print:pt-0.5">
          <span>Printed: {printDate}</span>
          {user && <span> | Printed by: {user.name}</span>}
        </div>
      </div>

      <div className="print-content">{children}</div>

      <div
        className="print-footer no-print"
        style={{
          marginTop: '40px',
          paddingTop: '20px',
          borderTop: '1px solid #ccc',
          fontSize: '10pt',
          textAlign: 'center',
          color: '#666',
        }}
      >
        <p>
          Acme Life Sciences | Product Request | Confidential
        </p>
      </div>
    </div>
  );
}

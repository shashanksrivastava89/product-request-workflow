import React from 'react';

interface PrintButtonProps {
  targetId?: string;
  className?: string;
  label?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
}

export default function PrintButton({
  targetId,
  className = '',
  label = 'Print',
  icon,
  disabled = false,
  variant = 'secondary',
}: PrintButtonProps) {
  const handlePrint = () => {
    if (disabled) return;

    if (targetId) {
      // Print specific element
      const element = document.getElementById(targetId);
      if (element) {
        // Create a new window for printing
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          // Get the print styles
          const printStyles = Array.from(document.styleSheets)
            .map(sheet => {
              try {
                return Array.from(sheet.cssRules)
                  .map(rule => rule.cssText)
                  .join('\n');
              } catch (e) {
                return '';
              }
            })
            .join('\n');

          // Get all style tags
          const styleTags = Array.from(document.querySelectorAll('style'))
            .map(tag => tag.innerHTML)
            .join('\n');

          // Empty title so browser print headers/footers do not show "Print - …" (user can still disable headers in the print dialog).
          printWindow.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title></title>
                <style>
                  ${printStyles}
                  ${styleTags}
                  @media print {
                    .no-print {
                      display: none !important;
                    }
                  }
                </style>
              </head>
              <body>
                ${element.innerHTML}
              </body>
            </html>
          `);
          printWindow.document.close();
          
          // Wait for content to load, then print
          setTimeout(() => {
            printWindow.print();
            // Close window after printing (optional)
            // printWindow.close();
          }, 250);
        }
      }
    } else {
      // Print entire page
      window.print();
    }
  };

  const variantClasses = {
    primary: 'bg-[#00A651] text-white hover:bg-[#008A44]',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
  };

  return (
    <button
      onClick={handlePrint}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      aria-label={label}
      title={label}
    >
      {icon || (
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}

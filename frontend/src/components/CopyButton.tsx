import { useCallback } from "react";
import { useToast } from "@/components/Toast";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const { showToast } = useToast();

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      showToast({ variant: 'success', message: 'Copied to clipboard' });
    }).catch(() => {
      showToast({ variant: 'error', message: 'Failed to copy', action: 'Try selecting and copying manually.' });
    });
  }, [text, showToast]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`${label} to clipboard`}
      title={`${label} to clipboard`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium
                 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300
                 hover:text-white transition-colors duration-150 shrink-0
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-3.5 w-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
      </svg>
      {label}
    </button>
  );
}

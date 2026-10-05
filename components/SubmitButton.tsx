"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button for a server-action form. Disables itself while the action is
 * pending, which also blocks Enter-key resubmission, so a double click cannot
 * create two calls. Must be rendered inside the <form>.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}

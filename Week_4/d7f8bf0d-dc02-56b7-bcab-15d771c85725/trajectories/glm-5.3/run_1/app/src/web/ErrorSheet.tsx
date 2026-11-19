import React from 'react';

export function ErrorSheet({ message, onDismiss }: {
  message: string | null;
  onDismiss: () => void;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <div className="error-sheet" role="alert" data-testid="error-sheet">
      <span>{message}</span>
      <button className="lipped pale" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

'use client';
import { useState } from 'react';

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    setText('');
    onSend(t);
  }

  return (
    <div className="input-row">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="Type a message (Enter to send, Shift+Enter for newline)"
        disabled={disabled}
      />
      <button onClick={submit} disabled={disabled}>Send</button>
    </div>
  );
}
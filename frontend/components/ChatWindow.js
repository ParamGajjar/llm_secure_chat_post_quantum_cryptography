'use client';
import { useEffect, useRef } from 'react';

export default function ChatWindow({ messages, loading }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  return (
    <div className="messages">
      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.role}`}>{m.content}</div>
      ))}
      {loading && <div className="loading">AI is thinking…</div>}
      <div ref={endRef} />
    </div>
  );
}
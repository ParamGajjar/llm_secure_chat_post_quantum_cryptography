'use client';
import { useState, useRef, useEffect } from 'react';
import ChatWindow from '../components/ChatWindow';
import MessageInput from '../components/MessageInput';
import SecurityPanel from '../components/SecurityPanel';
import { ChatClient } from '../lib/chatClient';

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ established: false, sessionId: null, error: null });
  const [metrics, setMetrics] = useState({ log: [] });
  const clientRef = useRef(null);

  const log = (step, detail) =>
    setMetrics((m) => ({ ...m, log: [...m.log.slice(-40), { t: new Date().toLocaleTimeString(), step, detail }] }));

  async function startSession() {
    setStatus({ established: false, sessionId: null, error: null });
    setMessages([]);
    setMetrics({ log: [] });
    const client = new ChatClient({ onLog: log });
    clientRef.current = client;
    try {
      const info = await client.handshake();
      setStatus({ established: true, sessionId: info.sessionId, error: null });
    } catch (err) {
      setStatus({ established: false, sessionId: null, error: err.message });
    }
  }

  useEffect(() => { startSession(); }, []);

  async function send(text) {
    if (!clientRef.current?.established) {
      setMessages((m) => [...m, { role: 'error', content: 'No secure session. Start a new chat.' }]);
      return;
    }
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const { reply, timings } = await clientRef.current.sendMessage(text);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
      setMetrics((m) => ({ ...m, last: timings }));
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', content: err.message }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="layout">
      <div className="chat">
        <div className="header">
          <strong>PQC Secure Chat</strong>
          <span className={`badge ${status.established ? '' : 'off'}`}>
            {status.established ? '🔒 ML-KEM session active' : status.error ? '⚠ Session failed' : 'Establishing…'}
          </span>
          <button className="btn-new" onClick={startSession}>New chat</button>
        </div>
        <ChatWindow messages={messages} loading={loading} />
        <MessageInput onSend={send} disabled={loading || !status.established} />
      </div>
      <SecurityPanel status={status} metrics={metrics} />
    </div>
  );
}
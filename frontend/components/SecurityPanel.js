'use client';

export default function SecurityPanel({ status, metrics }) {
  const t = metrics.last;
  return (
    <aside className="panel">
      <h3>Security / Debug</h3>
      <dl>
        <dt>PQC algorithm</dt><dd>ML-KEM-768 (FIPS 203)</dd>
        <dt>Symmetric</dt><dd>AES-256-GCM</dd>
        <dt>KDF</dt><dd>HKDF-SHA256</dd>
        <dt>Session</dt><dd>{status.established ? 'Established' : 'Not established'}</dd>
        <dt>Session ID</dt><dd>{status.sessionId ? status.sessionId.slice(0, 8) + '…' : '—'}</dd>
        <dt>Encrypt</dt><dd>{t ? `${t.encryptMs} ms` : '—'}</dd>
        <dt>Decrypt (reply)</dt><dd>{t ? `${t.decryptMs} ms` : '—'}</dd>
        <dt>Round trip</dt><dd>{t ? `${t.roundTripMs} ms` : '—'}</dd>
        <dt>Ciphertext out</dt><dd>{t ? `${t.outBytes} bytes` : '—'}</dd>
        <dt>Ciphertext in</dt><dd>{t ? `${t.inBytes} bytes` : '—'}</dd>
      </dl>
      <div className="log">
        <strong>Event log</strong>
        {metrics.log.slice().reverse().map((e, i) => (
          <div key={i}><span style={{ color: '#888' }}>{e.t}</span> {e.step}{e.detail ? ` — ${e.detail}` : ''}</div>
        ))}
      </div>
    </aside>
  );
}
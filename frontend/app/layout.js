import './globals.css';

export const metadata = {
  title: 'Post-Quantum Secure AI Chat',
  description: 'AI chat protected by ML-KEM + AES-256-GCM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
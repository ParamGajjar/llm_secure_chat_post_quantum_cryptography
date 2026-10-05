# Post-Quantum Secure AI Chat

An educational demo in which chat messages are protected with **post-quantum cryptography** on the way from the browser to an Express backend, which then forwards plaintext to an LLM via OpenRouter.

## Setup and Run

```bash
# Install Dependencies
cd backend && npm install
cd ../frontend && npm install

# Setup environment
cp .env.example .env

# Run Backend (Terminal 1)
cd backend && npm run dev

# Run Frontend (Terminal 2)
cd frontend && npm run dev
```
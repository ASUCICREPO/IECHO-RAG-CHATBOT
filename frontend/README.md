# Echo Knowledge Base Frontend

This is the Next.js (React + TypeScript + Tailwind CSS) frontend for the IECHO RAG Chatbot project.

## Features
- Chat with AI (integrated with backend RAG chatbot API)
- Submit feedback on AI responses
- View backend health/status
- Browse available knowledge base documents

---

## Getting Started

### 1. **Install dependencies**

```
cd frontend
npm install
```

### 2. **Set up environment variables**

Create a `.env.local` file in the `frontend` directory with the following content:

```
NEXT_PUBLIC_API_BASE_URL=https://<your-backend-api-url>
```
- Replace `<your-backend-api-url>` with the actual API Gateway URL (e.g., `https://nl40r7jl44.execute-api.us-west-2.amazonaws.com/prod`)

### 3. **Run the development server**

```
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000) (or another port if 3000 is in use).

---

## Project Structure

```
frontend/
  app/                # Next.js app directory
  components/         # UI components
  hooks/              # Custom React hooks
  public/             # Static assets
  styles/             # CSS
  .env.local          # Environment variables (not committed)
  package.json        # Project dependencies/scripts
  ...
```

---

## Requirements
- Node.js 18+
- npm 9+

---

## Troubleshooting
- If you see CORS errors in the browser, ensure the backend API has CORS enabled for your frontend's origin.
- After changing `.env.local`, always restart the dev server.

---

## Contributing
Pull requests are welcome! Please follow the project coding guidelines in `rules.md`.

---

## License
[MIT](../LICENSE)

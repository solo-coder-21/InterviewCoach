import { aiStatus } from "./server/ai.js";
import "dotenv/config";
import express from "express";
import path from "path";
import { mountWebhook, mountBilling } from "./server/billing.js";
import { mountAccounts, entitled } from "./server/accounts.js";
import { HttpError } from "./server/database.js";

export function createExpressApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  mountWebhook(app);
  app.use(express.json({ limit: '512kb' }));
  mountBilling(app);
  mountAccounts(app);
  app.get('/api/ai-status', (_req, res) => res.json(aiStatus()));

  // /api/scrape-questions
  app.post("/api/scrape-questions", ...entitled("scrape", 2), async (req, res) => {
    try {
      const { role, company } = req.body || {};
      console.log(`[API REQUEST LOG] /api/scrape-questions | Role: "${role}", Company: "${company || 'N/A'}"`);
      
      const fallbackQuestions = [
        `Tell me about yourself and your background for the ${role} role.`,
        `Why do you want to work at ${company || "our company"}?`,
        `Describe a challenging project you've worked on recently.`,
        "How do you handle tight deadlines and high-pressure situations?",
        `What relevant technical and soft skills do you bring to the ${role} position?`,
      ];

      res.json({ questions: fallbackQuestions });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to scrape questions";
      console.error(`[API ERROR LOG] /api/scrape-questions:`, message);
      res.status(500).json({ error: message });
    }
  });

  // /api/speechmatics-token
  app.post("/api/speechmatics-token", ...entitled("speech", 30), async (_req, res) => {
    try {
      console.log(`\n==================================================`);
      console.log(`[API REQUEST LOG] /api/speechmatics-token - Speechmatics Temporary RT Token requested`);
      console.log(`==================================================`);

      const apiKey = process.env.SPEECHMATICS_API_KEY;
      if (!apiKey) {
        console.warn(`[Speechmatics API Log] WARNING: SPEECHMATICS_API_KEY environment variable is NOT set in .env!`);
        res.status(530).json({
          error: "SPEECHMATICS_API_KEY environment variable is missing. Please add SPEECHMATICS_API_KEY to your .env file.",
        });
        return;
      }

      console.log(`[Speechmatics API Log] Requesting temporary RT token from Speechmatics API (ttl: 60s)...`);
      const smRes = await fetch("https://mp.speechmatics.com/v1/api_keys?type=rt", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 60 }),
        signal: AbortSignal.timeout(15000),
      });

      if (!smRes.ok) {
        const text = await smRes.text();
        console.error(`[Speechmatics API Log] ERROR ${smRes.status} from Speechmatics:`, text);
        res.status(500).json({ error: `Speechmatics API error ${smRes.status}: ${text}` });
        return;
      }

      const data = await smRes.json();
      const token = data.key_value || data.key || data.token || data.jwt || data.api_key || data.apiKey;

      if (!token) {
        console.error(`[Speechmatics API Log] ERROR: No token field returned in response:`, data);
        res.status(500).json({ error: "No token returned from Speechmatics" });
        return;
      }

      console.log(`[Speechmatics API Log] SUCCESS: Temporary JWT Token generated for Speechmatics WebSocket connection.`);
      res.json({
        token,
        expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to get Speechmatics token";
      console.error(`[Speechmatics API Log] EXCEPTION:`, message);
      res.status(500).json({ error: message });
    }
  });

  // /api/tts endpoint for Speechmatics low-latency natural Text-To-Speech
  app.post("/api/tts", ...entitled("tts", 100), async (req, res) => {
    try {
      const { text, voice = "jack" } = req.body || {};
      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "Text is required" });
        return;
      }

      const apiKey = process.env.SPEECHMATICS_API_KEY;
      if (!apiKey) {
        console.warn("[Speechmatics TTS] SPEECHMATICS_API_KEY is not configured.");
        res.status(503).json({ error: "Speechmatics API key not configured" });
        return;
      }

      // Fixed natural single male voice: "jack" (or "theo")
      const voiceId = voice === "theo" ? "theo" : "jack";
      console.log(`[Speechmatics TTS Request] Speechmatics voice '${voiceId}' | Text length: ${text.length} chars`);

      const ttsResponse = await fetch(`https://preview.tts.speechmatics.com/generate/${voiceId}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: text.substring(0, 1000) }),
        signal: AbortSignal.timeout(15000),
      });

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text().catch(() => "");
        console.warn(`[Speechmatics TTS Warning] HTTP ${ttsResponse.status}: ${errText}`);
        res.status(ttsResponse.status).json({ error: `Speechmatics TTS service returned ${ttsResponse.status}` });
        return;
      }

      const arrayBuffer = await ttsResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Audio = buffer.toString("base64");
      const mimeType = ttsResponse.headers.get("content-type") || "audio/wav";

      console.log(`[Speechmatics TTS Success] Low-latency male audio generated (${buffer.length} bytes)`);
      res.json({
        audio: base64Audio,
        mimeType,
        voiceUsed: voiceId,
      });
    } catch (err: any) {
      console.error("[Speechmatics TTS Exception]:", err);
      res.status(500).json({ error: "Failed to process Speechmatics TTS request" });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError) { res.status(400).json({ error: 'Invalid JSON request.' }); return; }
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

async function startServer() {
  const app = createExpressApp();
  const PORT = Number(process.env.PORT || 3000);

  // Vite middleware in dev mode
  if (process.env.NODE_ENV !== "production" && !process.argv[1]?.endsWith("server.cjs")) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  startServer();
}

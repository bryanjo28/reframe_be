const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');

const apiRoutes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const { globalApiLimiter } = require('./middlewares/rateLimiters');
const inputSafetyMiddleware = require('./middlewares/inputSafetyMiddleware');

const app = express();

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Keep diagnostics outside auth/CORS so rejected requests are visible too.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/auth/')) return next();

  const startedAt = Date.now();
  const label = `${req.method} ${req.path}`;
  console.log(`[auth-request] ${new Date().toISOString()} pid=${process.pid} ${label} started`);
  res.once('finish', () => {
    console.log(`[auth-request] ${new Date().toISOString()} pid=${process.pid} ${label} status=${res.statusCode} durationMs=${Date.now() - startedAt}`);
  });
  res.once('close', () => {
    if (!res.writableFinished) {
      console.warn(`[auth-request] ${new Date().toISOString()} pid=${process.pid} ${label} connection closed before response durationMs=${Date.now() - startedAt}`);
    }
  });
  next();
});

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  process.env.APP_BASE_URL || "http://localhost:3000",
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://127.0.0.1:5173"]),
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.get('/', (req, res) => {
  res.json({
    message: 'Threads API is running',
  });
});

app.use('/api', globalApiLimiter, inputSafetyMiddleware, apiRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: 'Route not found',
  });
});

app.use(errorHandler);

module.exports = app;

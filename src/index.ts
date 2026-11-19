import express from 'express';
import cors from 'cors';
import { enachRouter } from './routes/enach.routes.js';

const app = express();
const PORT = process.env.PORT || 4100;
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check
app.get('/health', (_req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'enach-mandate-service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use(API_PREFIX, enachRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🏛️  NPCI eNACH & e-Mandate Engine Started`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔗 API Base: http://localhost:${PORT}${API_PREFIX}`);
    console.log(`🧪 Interactive Auth Portal: http://localhost:${PORT}${API_PREFIX}/mock-portal/:mandateId`);
    console.log(`=======================================================`);
  });
}

export default app;

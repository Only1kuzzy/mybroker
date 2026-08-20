import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.get('/price', async (req, res) => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'ethereum',
        vs_currencies: 'usd'
      }
    });

    const usd = response.data?.ethereum?.usd;
    if (usd == null) {
      return res.status(502).json({ error: 'Price response missing' });
    }

    res.json({ usd });
  } catch (error) {
    console.error('Price fetch failed', error);
    res.status(502).json({ error: 'Unable to fetch price' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: 'testnet-demo' });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});

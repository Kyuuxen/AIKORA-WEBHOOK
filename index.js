const express = require('express');
const app = express();

app.use(express.json());

// ✅ VERIFY WEBHOOK
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = 'mybotverify123';

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ✅ RECEIVE EVENTS
app.post('/webhook', (req, res) => {
  console.log('Webhook event:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// ✅ IMPORTANT: Render uses PORT env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook running on port ${PORT}`);
});

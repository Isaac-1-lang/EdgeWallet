const express = require('express');
const mqtt = require('mqtt');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const PORT = 8690;
const TEAM_ID = "quantum_bitflip_0xDEAD";
const MQTT_BROKER = "mqtt://157.173.101.159:1883";
const MONGO_URI = process.env.MONGODB_URI;

// MongoDB Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Card Schema
// Align with required "cards" collection shape while keeping backwards compatibility.
const cardSchema = new mongoose.Schema({
  // card_uid is the externally visible field; keep uid as an internal alias for existing code.
  card_uid: { type: String, required: true, unique: true },
  uid: { type: String, required: true, unique: true },
  holderName: { type: String, required: true },
  balance: { type: Number, default: 0 },
  lastTopup: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Ensure we always keep card_uid and uid in sync.
cardSchema.pre('validate', function (next) {
  if (this.uid && !this.card_uid) {
    this.card_uid = this.uid;
  }
  if (this.card_uid && !this.uid) {
    this.uid = this.card_uid;
  }
  next();
});

const Card = mongoose.model('Card', cardSchema, 'cards');

// Transaction Schema
// Unified transactions collection for TOPUP and PAYMENT.
const transactionSchema = new mongoose.Schema({
  card_uid: { type: String, required: true, index: true },
  uid: { type: String, required: true, index: true }, // backwards-compatible alias
  amount: { type: Number, required: true },
  type: { type: String, enum: ['TOPUP', 'PAYMENT'], required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  description: { type: String },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String },
  timestamp: { type: Date, default: Date.now }
});

const Transaction = mongoose.model('Transaction', transactionSchema, 'transactions');

// Product Schema (demo products for payment pricing only)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  active: { type: Boolean, default: true }
});

const Product = mongoose.model('Product', productSchema, 'products');

// Topics
const TOPIC_STATUS = `rfid/${TEAM_ID}/card/status`;
const TOPIC_BALANCE = `rfid/${TEAM_ID}/card/balance`;
const TOPIC_TOPUP = `rfid/${TEAM_ID}/card/topup`;
const TOPIC_PAYMENT_REQUEST = `rfid/${TEAM_ID}/payment/request`;
const TOPIC_PAYMENT_RESPONSE = `rfid/${TEAM_ID}/payment/response`;

// MQTT Client Setup
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('Connected to MQTT Broker');
  mqttClient.subscribe(TOPIC_STATUS);
  mqttClient.subscribe(TOPIC_BALANCE);
  mqttClient.subscribe(TOPIC_PAYMENT_REQUEST);
});

mqttClient.on('message', async (topic, message) => {
  console.log(`Received message on ${topic}: ${message.toString()}`);
  try {
    const payload = JSON.parse(message.toString());

    if (topic === TOPIC_STATUS) {
      // Auto-create card if it doesn't exist
      const { uid, balance } = payload;
      let card = await Card.findOne({ uid });

      if (!card) {
        console.log(`New card detected: ${uid}, creating record...`);
        card = new Card({
          uid,
          holderName: 'New User',
          balance: balance || 0,
          lastTopup: 0
        });
        await card.save();
        console.log(`Card created: ${uid}`);
      }

      // Send the latest card data to the frontend
      io.emit('card-status', {
        uid: card.uid,
        balance: card.balance,
        holderName: card.holderName,
        status: 'detected'
      });

    } else if (topic === TOPIC_BALANCE) {
      io.emit('card-balance', payload);
    } else if (topic === TOPIC_PAYMENT_REQUEST) {
      // Handle payment requests coming from MQTT
      const { card_uid, product_id, amount } = payload;
      // Re-use the same core payment logic as the HTTP endpoint via a helper
      const result = await handlePayment({
        cardUid: card_uid,
        productId: product_id,
        directAmount: amount
      });

      // Publish response on dedicated topic
      mqttClient.publish(
        TOPIC_PAYMENT_RESPONSE,
        JSON.stringify({
          card_uid,
          product_id,
          amount: result.amount,
          product_name: result.productName || null,
          status: result.status,
          new_balance: result.newBalance ?? null,
          message: result.message
        })
      );
    }
  } catch (err) {
    console.error('Failed to parse MQTT message or save card:', err);
  }
});

// Seed demo products on first run (simple best-effort seeding)
async function seedProducts() {
  try {
    const count = await Product.estimatedDocumentCount();
    if (count > 0) {
      return;
    }

    const demoProducts = [
      { name: 'Water', price: 500, active: true },
      { name: 'Bread', price: 800, active: true },
      { name: 'Notebook', price: 1500, active: true }
    ];

    await Product.insertMany(demoProducts);
    console.log('Seeded demo products collection');
  } catch (err) {
    console.error('Failed to seed products:', err);
  }
}

// Core payment handler used by both HTTP and MQTT flows
async function handlePayment({ cardUid, productId, directAmount }) {
  if (!cardUid) {
    return {
      status: 'rejected',
      message: 'card_uid is required'
    };
  }

  let amountToCharge = directAmount;
  let product = null;

  if (productId) {
    product = await Product.findOne({ _id: productId, active: true });
    if (!product) {
      return {
        status: 'rejected',
        message: 'Product not found or inactive'
      };
    }
    amountToCharge = product.price;
  }

  if (amountToCharge === undefined || amountToCharge === null || amountToCharge <= 0) {
    return {
      status: 'rejected',
      message: 'Invalid amount'
    };
  }

  const card = await Card.findOne({ uid: cardUid });
  if (!card) {
    return {
      status: 'rejected',
      message: 'Card not found'
    };
  }

  const balanceBefore = card.balance;

  if (balanceBefore < amountToCharge) {
    // Emit WebSocket event for rejected payment
    io.emit('transaction-update', {
      card_uid: card.uid,
      operation_type: 'PAYMENT',
      product_name: product ? product.name : null,
      amount: amountToCharge,
      new_balance: null,
      status: 'rejected'
    });

    return {
      status: 'rejected',
      message: 'Insufficient balance'
    };
  }

  card.balance -= amountToCharge;
  card.updatedAt = Date.now();
  await card.save();

  const transaction = new Transaction({
    card_uid: card.uid,
    uid: card.uid,
    amount: amountToCharge,
    type: 'PAYMENT',
    balanceBefore,
    balanceAfter: card.balance,
    productId: product ? product._id : undefined,
    productName: product ? product.name : undefined,
    description: product ? `Payment for ${product.name}` : 'Payment'
  });
  await transaction.save();

  // Emit WebSocket event for successful payment
  io.emit('transaction-update', {
    card_uid: card.uid,
    operation_type: 'PAYMENT',
    product_name: product ? product.name : null,
    amount: amountToCharge,
    new_balance: card.balance,
    status: 'success'
  });

  return {
    status: 'success',
    message: 'Payment successful',
    amount: amountToCharge,
    productName: product ? product.name : null,
    newBalance: card.balance,
    transactionId: transaction._id
  };
}

// HTTP Endpoints
app.post('/topup', async (req, res) => {
  const { uid, amount, holderName } = req.body;

  if (!uid || amount === undefined) {
    return res.status(400).json({ error: 'UID and amount are required' });
  }

  try {
    // Find or create card
    let card = await Card.findOne({ uid });
    const balanceBefore = card ? card.balance : 0;

    if (!card) {
      if (!holderName) {
        return res.status(400).json({ error: 'Holder name is required for new cards' });
      }
      card = new Card({ uid, holderName, balance: amount, lastTopup: amount });
    } else {
      // Cumulative topup: add to existing balance
      card.balance += amount;
      card.lastTopup = amount;
      card.updatedAt = Date.now();

      // Allow updating holder name if provided (e.g. renaming "New User")
      if (holderName && holderName.trim() !== '' && holderName !== card.holderName) {
        card.holderName = holderName;
      }
    }

    await card.save();

    // Create transaction record
    const transaction = new Transaction({
      card_uid: card.uid,
      uid: card.uid,
      amount: amount,
      type: 'TOPUP',
      balanceBefore: balanceBefore,
      balanceAfter: card.balance,
      description: `Top-up of ${amount}`
    });
    await transaction.save();

    // Publish to MQTT with updated balance
    const payload = JSON.stringify({ uid, amount: card.balance });
    mqttClient.publish(TOPIC_TOPUP, payload, (err) => {
      if (err) {
        console.error('Failed to publish topup:', err);
        return res.status(500).json({ error: 'Failed to publish topup command' });
      }
      console.log(`Published topup for ${uid} (${card.holderName}): ${card.balance}`);
    });

    // WebSocket broadcast for successful top-up
    io.emit('transaction-update', {
      card_uid: card.uid,
      operation_type: 'TOPUP',
      product_name: null,
      amount: amount,
      new_balance: card.balance,
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Topup successful',
      card: {
        uid: card.uid,
        holderName: card.holderName,
        balance: card.balance,
        lastTopup: card.lastTopup
      },
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        balanceAfter: transaction.balanceAfter,
        timestamp: transaction.timestamp
      }
    });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Payment endpoint
app.post('/pay', async (req, res) => {
  const { uid, card_uid, product_id, amount } = req.body;

  const cardUid = card_uid || uid;

  if (!cardUid) {
    return res.status(400).json({ error: 'card_uid (or uid) is required' });
  }

  if (!product_id && (amount === undefined || amount === null)) {
    return res.status(400).json({ error: 'Either product_id or amount is required' });
  }

  try {
    const result = await handlePayment({
      cardUid,
      productId: product_id,
      directAmount: product_id ? undefined : amount
    });

    if (result.status === 'rejected') {
      return res.status(400).json({
        success: false,
        status: 'rejected',
        message: result.message
      });
    }

    return res.json({
      success: true,
      status: 'success',
      message: result.message,
      card_uid: cardUid,
      amount: result.amount,
      product_name: result.productName,
      new_balance: result.newBalance,
      transactionId: result.transactionId
    });
  } catch (err) {
    console.error('Payment error:', err);
    return res.status(500).json({ error: 'Payment failed' });
  }
});

// Get card details
app.get('/card/:uid', async (req, res) => {
  try {
    const card = await Card.findOne({ uid: req.params.uid });
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    res.json(card);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Get all cards
app.get('/cards', async (req, res) => {
  try {
    const cards = await Card.find().sort({ updatedAt: -1 });
    res.json(cards);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Get transaction history for a specific card
app.get('/transactions/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const transactions = await Transaction.find({
      $or: [{ uid }, { card_uid: uid }]
    })
      .sort({ timestamp: -1 })
      .limit(50); // Limit to last 50 transactions
    res.json(transactions);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Get all transactions 
app.get('/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const transactions = await Transaction.find()
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json(transactions);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Get active products (for demo frontend or testing tools)
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find({ active: true }).sort({ price: 1 });
    res.json(products);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Socket connectivity
io.on('connection', (socket) => {
  console.log('A user connected to the dashboard');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from: http://157.173.101.159:${PORT}`);
  await seedProducts();
});

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
// In Mongoose 9+, document middleware is promise-based, so we don't use `next`.
cardSchema.pre('validate', function () {
  if (this.uid && !this.card_uid) {
    this.card_uid = this.uid;
  }
  if (this.card_uid && !this.uid) {
    this.uid = this.card_uid;
  }
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

// Strict MQTT topic set (no wildcards, no extra topics)
const TOPIC_STATUS = `rfid/${TEAM_ID}/card/status`;
const TOPIC_BALANCE = `rfid/${TEAM_ID}/card/balance`;
const TOPIC_TOPUP = `rfid/${TEAM_ID}/card/topup`;
const TOPIC_PAY = `rfid/${TEAM_ID}/card/pay`;

// MQTT Client Setup
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('Connected to MQTT Broker');
  mqttClient.subscribe(TOPIC_STATUS);
  mqttClient.subscribe(TOPIC_BALANCE);
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
      // Card reports back the new balance after applying a command.
      // We primarily use this as a device confirmation + UI update;
      // the database remains the single source of truth via safe wallet updates.
      io.emit('card-balance', payload);
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

// ---------------- Wallet service with safe update pattern ----------------

/**
 * Runs a wallet operation (TOPUP or PAYMENT) inside a MongoDB transaction
 * when available. If transactions are not supported (e.g. no replica set),
 * the operation is aborted without partial writes to keep the wallet safe.
 */
async function runWalletTransaction(operationName, fn) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    console.error(`Wallet ${operationName} transaction failed:`, err.message || err);

    // Business-rule errors (e.g. insufficient funds, missing product/card)
    // should propagate so the HTTP layer can return a proper 4xx with message.
    if (
      err.code === 'INSUFFICIENT_FUNDS' ||
      err.code === 'PRODUCT_NOT_FOUND' ||
      err.code === 'CARD_NOT_FOUND'
    ) {
      throw err;
    }

    // For infrastructure/transaction issues, we fail the request instead of
    // performing any partial updates across collections.
    throw new Error(
      `Wallet ${operationName} failed. Ensure MongoDB transactions are supported (replica set).`
    );
  } finally {
    await session.endSession();
  }
}

/**
 * Top-up operation used only by HTTP controller.
 * Ensures card balance update and TOPUP ledger insert are all-or-nothing.
 */
async function performTopup({ cardUid, amount, holderName }) {
  return runWalletTransaction('TOPUP', async (session) => {
    // Find or create card within the transaction
    let card = await Card.findOne({ uid: cardUid }).session(session);
    const balanceBefore = card ? card.balance : 0;

    if (!card) {
      if (!holderName) {
        throw new Error('Holder name is required for new cards');
      }
      card = new Card({
        uid: cardUid,
        holderName,
        balance: amount,
        lastTopup: amount
      });
    } else {
      card.balance += amount;
      card.lastTopup = amount;
      card.updatedAt = Date.now();

      if (holderName && holderName.trim() !== '' && holderName !== card.holderName) {
        card.holderName = holderName;
      }
    }

    await card.save({ session });

    const transaction = await new Transaction({
      card_uid: card.uid,
      uid: card.uid,
      amount,
      type: 'TOPUP',
      balanceBefore,
      balanceAfter: card.balance,
      description: `Top-up of ${amount}`
    }).save({ session });

    return { card, transaction, balanceBefore };
  });
}

/**
 * Payment operation used by HTTP /pay endpoint.
 * Implements the required product/quantity flow and safe wallet update.
 */
async function performPayment({ cardUid, productId, quantity }) {
  return runWalletTransaction('PAYMENT', async (session) => {
    if (!cardUid) {
      throw new Error('card_uid is required');
    }

    if (!productId) {
      throw new Error('product_id is required for payments');
    }

    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;

    const product = await Product.findOne({ _id: productId, active: true }).session(session);
    if (!product) {
      const error = new Error('Product not found or inactive');
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }

    const totalAmount = product.price * safeQuantity;

    const card = await Card.findOne({ uid: cardUid }).session(session);
    if (!card) {
      const error = new Error('Card not found');
      error.code = 'CARD_NOT_FOUND';
      throw error;
    }

    const balanceBefore = card.balance;

    if (balanceBefore < totalAmount) {
      const error = new Error('Insufficient balance');
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    card.balance -= totalAmount;
    card.updatedAt = Date.now();
    await card.save({ session });

    const transaction = await new Transaction({
      card_uid: card.uid,
      uid: card.uid,
      amount: totalAmount,
      type: 'PAYMENT',
      balanceBefore,
      balanceAfter: card.balance,
      productId: product._id,
      productName: product.name,
      description: `Payment for ${product.name} x${safeQuantity}`
    }).save({ session });

    return {
      card,
      transaction,
      product,
      quantity: safeQuantity,
      totalAmount
    };
  });
}

// HTTP Endpoints
app.post('/topup', async (req, res) => {
  const { uid, amount, holderName } = req.body;

  if (!uid || amount === undefined) {
    return res.status(400).json({ error: 'UID and amount are required' });
  }

  try {
    const { card, transaction } = await performTopup({
      cardUid: uid,
      amount,
      holderName
    });

    // Publish to MQTT with updated balance
    const payload = JSON.stringify({
      uid: card.uid,
      amount,
      newBalance: card.balance
    });
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
      quantity: 1,
      amount: amount,
      new_balance: card.balance,
      status: 'success',
      message: 'Topup successful'
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
    console.error('Topup error:', err);
    if (err.message && err.message.includes('Holder name is required for new cards')) {
      return res.status(400).json({ error: 'Holder name is required for new cards' });
    }
    res.status(500).json({ error: 'Topup failed. Please try again.' });
  }
});

// Payment endpoint
app.post('/pay', async (req, res) => {
  const { uid, card_uid, product_id, quantity } = req.body;

  const cardUid = card_uid || uid;

  if (!cardUid) {
    return res.status(400).json({ error: 'card_uid (or uid) is required' });
  }

  if (!product_id) {
    return res.status(400).json({ error: 'product_id is required' });
  }

  try {
    const {
      card,
      transaction,
      product,
      quantity: safeQuantity,
      totalAmount
    } = await performPayment({
      cardUid,
      productId: product_id,
      quantity
    });

    // Publish payment command to device
    const payload = JSON.stringify({
      card_uid: card.uid,
      product_id,
      quantity: safeQuantity,
      amount: totalAmount,
      newBalance: card.balance
    });
    mqttClient.publish(TOPIC_PAY, payload, (err) => {
      if (err) {
        console.error('Failed to publish payment command:', err);
      } else {
        console.log(`Published pay for ${card.uid}: -${totalAmount} (x${safeQuantity} ${product.name})`);
      }
    });

    // Emit WebSocket event for successful payment
    io.emit('transaction-update', {
      card_uid: card.uid,
      operation_type: 'PAYMENT',
      product_name: product.name,
      quantity: safeQuantity,
      amount: totalAmount,
      new_balance: card.balance,
      status: 'success',
      message: 'Payment successful'
    });

    return res.json({
      success: true,
      status: 'success',
      message: 'Payment successful',
      card_uid: card.uid,
      product_name: product.name,
      quantity: safeQuantity,
      amount: totalAmount,
      new_balance: card.balance,
      transactionId: transaction._id
    });
  } catch (err) {
    console.error('Payment error:', err);
    // Map known error codes to user-facing messages
    if (err.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        status: 'rejected',
        message: 'Product not found or inactive'
      });
    }
    if (err.code === 'CARD_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        status: 'rejected',
        message: 'Card not found'
      });
    }
    if (err.code === 'INSUFFICIENT_FUNDS') {
      // Emit WebSocket event for rejected payment
      io.emit('transaction-update', {
        card_uid: cardUid,
        operation_type: 'PAYMENT',
        product_name: null,
        quantity: quantity || 1,
        amount: null,
        new_balance: null,
        status: 'rejected',
        message: 'Insufficient balance'
      });

      return res.status(400).json({
        success: false,
        status: 'rejected',
        message: 'Insufficient balance'
      });
    }

    return res.status(500).json({ error: 'Payment failed. Please try again.' });
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

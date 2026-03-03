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

// Use 8690 for local dev, 9256 in production (VPS nginx/firewall already expect 9256).
const PORT = process.env.PORT || 8690;
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
  category: { type: String, default: 'General' },
  emoji: { type: String, default: '📦' },
  active: { type: Boolean, default: true }
});

const Product = mongoose.model('Product', productSchema, 'products');

// Service Schema (demo services for salesperson payments)
const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: 'Services' },
  emoji: { type: String, default: '🧾' },
  active: { type: Boolean, default: true }
});

const Service = mongoose.model('Service', serviceSchema, 'services');

// Receipt Schema (generated for payments; downloadable)
const receiptSchema = new mongoose.Schema({
  receiptNo: { type: String, required: true, unique: true, index: true },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  card_uid: { type: String, required: true, index: true },
  operator: { type: String }, // demo cashier/sales username
  itemType: { type: String, enum: ['PRODUCT', 'SERVICE'], required: true },
  itemName: { type: String, required: true },
  unitPrice: { type: Number, required: true },
  quantity: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Receipt = mongoose.model('Receipt', receiptSchema, 'receipts');

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
      // Food & Drinks
      { name: 'Water Bottle', price: 500, category: 'Food & Drinks', emoji: '💧', active: true },
      { name: 'Orange Juice', price: 800, category: 'Food & Drinks', emoji: '🍊', active: true },
      { name: 'Sandwich', price: 1200, category: 'Food & Drinks', emoji: '🥪', active: true },
      { name: 'Coffee', price: 700, category: 'Food & Drinks', emoji: '☕', active: true },
      { name: 'Energy Drink', price: 1000, category: 'Food & Drinks', emoji: '⚡', active: true },
      { name: 'Fruit Salad', price: 900, category: 'Food & Drinks', emoji: '🥗', active: true },
      // Snacks
      { name: 'Chocolate Bar', price: 400, category: 'Snacks', emoji: '🍫', active: true },
      { name: 'Cookies Pack', price: 600, category: 'Snacks', emoji: '🍪', active: true },
      { name: 'Popcorn', price: 500, category: 'Snacks', emoji: '🍿', active: true },
      { name: 'Granola Bar', price: 450, category: 'Snacks', emoji: '🥜', active: true },
      { name: 'Chips', price: 550, category: 'Snacks', emoji: '🥔', active: true },
      // Stationery
      { name: 'Notebook', price: 1500, category: 'Stationery', emoji: '📓', active: true },
      { name: 'Pen Set', price: 800, category: 'Stationery', emoji: '🖊️', active: true },
      { name: 'Highlighters', price: 650, category: 'Stationery', emoji: '🖍️', active: true },
      { name: 'Ruler', price: 300, category: 'Stationery', emoji: '📏', active: true },
      // Electronics
      { name: 'USB Cable', price: 2000, category: 'Electronics', emoji: '🔌', active: true },
      { name: 'Earbuds', price: 3500, category: 'Electronics', emoji: '🎧', active: true },
      { name: 'Phone Charger', price: 2500, category: 'Electronics', emoji: '🔋', active: true },
      // Personal Care
      { name: 'Hand Sanitizer', price: 600, category: 'Personal Care', emoji: '🧴', active: true },
      { name: 'Tissues', price: 350, category: 'Personal Care', emoji: '🧻', active: true },
      { name: 'Lip Balm', price: 400, category: 'Personal Care', emoji: '💄', active: true }
    ];

    await Product.insertMany(demoProducts);
    console.log('Seeded demo products collection');
  } catch (err) {
    console.error('Failed to seed products:', err);
  }
}

// Seed demo services on first run
async function seedServices() {
  try {
    const count = await Service.estimatedDocumentCount();
    if (count > 0) {
      return;
    }

    const demoServices = [
      { name: 'Printing (10 pages)', price: 1500, category: 'Services', emoji: '🖨️', active: true },
      { name: 'Photocopy', price: 300, category: 'Services', emoji: '📄', active: true },
      { name: 'Internet Access (1 hour)', price: 1000, category: 'Services', emoji: '🌐', active: true },
      { name: 'Laundry Service', price: 2500, category: 'Services', emoji: '🧺', active: true },
      { name: 'Transport Ticket', price: 800, category: 'Services', emoji: '🚌', active: true }
    ];

    await Service.insertMany(demoServices);
    console.log('Seeded demo services collection');
  } catch (err) {
    console.error('Failed to seed services:', err);
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

    // If this MongoDB deployment doesn't support transactions (e.g. standalone),
    // gracefully fall back to a non-transactional execution so local development
    // still works. For full all-or-nothing guarantees, a replica set is required.
    if (
      typeof err.message === 'string' &&
      err.message.includes('Transaction numbers are only allowed on a replica set member or mongos')
    ) {
      console.warn(
        `MongoDB deployment does not support transactions. Running wallet ${operationName} without a transaction. ` +
          'For strict all-or-nothing guarantees, use a replica set (e.g. MongoDB Atlas cluster).'
      );
      // Run the operation without a session; individual operations will still be
      // consistent, but cross-collection atomicity is not guaranteed.
      return await fn(null);
    }

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
    let query = Card.findOne({ uid: cardUid });
    if (session) {
      query = query.session(session);
    }
    let card = await query;
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

    const saveOptions = session ? { session } : undefined;
    await card.save(saveOptions);

    const transaction = await new Transaction({
      card_uid: card.uid,
      uid: card.uid,
      amount,
      type: 'TOPUP',
      balanceBefore,
      balanceAfter: card.balance,
      description: `Top-up of ${amount}`
    }).save(saveOptions);

    return { card, transaction, balanceBefore };
  });
}

/**
 * Payment operation used by HTTP /pay endpoint.
 * Implements the required product/quantity flow and safe wallet update.
 */
async function performPayment({ cardUid, productId, serviceId, quantity, operator }) {
  return runWalletTransaction('PAYMENT', async (session) => {
    if (!cardUid) {
      throw new Error('card_uid is required');
    }

    const hasProduct = Boolean(productId);
    const hasService = Boolean(serviceId);
    if (!hasProduct && !hasService) {
      throw new Error('product_id or service_id is required for payments');
    }
    if (hasProduct && hasService) {
      throw new Error('Provide only one of product_id or service_id');
    }

    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;

    let itemType = 'PRODUCT';
    let item;
    if (hasService) {
      itemType = 'SERVICE';
      let serviceQuery = Service.findOne({ _id: serviceId, active: true });
      if (session) {
        serviceQuery = serviceQuery.session(session);
      }
      item = await serviceQuery;
      if (!item) {
        const error = new Error('Service not found or inactive');
        error.code = 'PRODUCT_NOT_FOUND';
        throw error;
      }
    } else {
      let productQuery = Product.findOne({ _id: productId, active: true });
      if (session) {
        productQuery = productQuery.session(session);
      }
      item = await productQuery;
      if (!item) {
        const error = new Error('Product not found or inactive');
        error.code = 'PRODUCT_NOT_FOUND';
        throw error;
      }
    }

    const totalAmount = item.price * safeQuantity;

    let cardQuery = Card.findOne({ uid: cardUid });
    if (session) {
      cardQuery = cardQuery.session(session);
    }
    const card = await cardQuery;
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
    const saveOptions = session ? { session } : undefined;
    await card.save(saveOptions);

    const transaction = await new Transaction({
      card_uid: card.uid,
      uid: card.uid,
      amount: totalAmount,
      type: 'PAYMENT',
      balanceBefore,
      balanceAfter: card.balance,
      productId: hasProduct ? item._id : undefined,
      productName: hasProduct ? item.name : undefined,
      description: `Payment for ${item.name} x${safeQuantity}`
    }).save(saveOptions);

    // Create receipt for download
    const receiptNo = `EW-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    const receipt = await new Receipt({
      receiptNo,
      transactionId: transaction._id,
      card_uid: card.uid,
      operator: operator ? String(operator) : undefined,
      itemType,
      itemName: item.name,
      unitPrice: item.price,
      quantity: safeQuantity,
      totalAmount,
      balanceBefore,
      balanceAfter: card.balance
    }).save(saveOptions);

    return {
      card,
      transaction,
      item,
      itemType,
      quantity: safeQuantity,
      totalAmount,
      receipt
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
  const { uid, card_uid, product_id, service_id, quantity, operator } = req.body;

  const cardUid = card_uid || uid;

  if (!cardUid) {
    return res.status(400).json({ error: 'card_uid (or uid) is required' });
  }

  if (!product_id && !service_id) {
    return res.status(400).json({ error: 'product_id or service_id is required' });
  }

  try {
    const {
      card,
      transaction,
      item,
      itemType,
      quantity: safeQuantity,
      totalAmount,
      receipt
    } = await performPayment({
      cardUid,
      productId: product_id,
      serviceId: service_id,
      quantity,
      operator
    });

    // Publish payment command to device
    const payload = JSON.stringify({
      card_uid: card.uid,
      product_id: product_id || service_id, // keep field for device compatibility
      service_id: service_id || null,
      item_type: itemType,
      quantity: safeQuantity,
      amount: totalAmount,
      newBalance: card.balance
    });
    mqttClient.publish(TOPIC_PAY, payload, (err) => {
      if (err) {
        console.error('Failed to publish payment command:', err);
      } else {
        console.log(`Published pay for ${card.uid}: -${totalAmount} (x${safeQuantity} ${item.name})`);
      }
    });

    // Emit WebSocket event for successful payment
    io.emit('transaction-update', {
      card_uid: card.uid,
      operation_type: 'PAYMENT',
      product_name: item.name,
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
      product_name: item.name,
      item_type: itemType,
      quantity: safeQuantity,
      amount: totalAmount,
      new_balance: card.balance,
      transactionId: transaction._id,
      receiptId: receipt?._id,
      receiptNo: receipt?.receiptNo
    });
  } catch (err) {
    console.error('Payment error:', err);
    // Map known error codes to user-facing messages
    if (err.code === 'PRODUCT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        status: 'rejected',
        message: 'Item not found or inactive'
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

// Get active services (for demo frontend or testing tools)
app.get('/services', async (req, res) => {
  try {
    const services = await Service.find({ active: true }).sort({ price: 1 });
    res.json(services);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Receipt JSON
app.get('/receipts/:id', async (req, res) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    res.json(receipt);
  } catch (err) {
    console.error('Receipt fetch error:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
});

// Receipt download (HTML attachment)
app.get('/receipts/:id/download', async (req, res) => {
  try {
    const receipt = await Receipt.findById(req.params.id);
    if (!receipt) {
      return res.status(404).send('Receipt not found');
    }

    const created = new Date(receipt.createdAt);
    const dateStr = created.toLocaleString();
    const filename = `receipt-${receipt.receiptNo}.html`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Receipt ${receipt.receiptNo}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; background: #f6f7fb; }
    .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    h1 { margin: 0 0 6px; font-size: 18px; }
    .muted { color: #6b7280; font-size: 12px; }
    .row { display:flex; justify-content: space-between; gap: 12px; margin: 10px 0; }
    .label { color:#6b7280; font-size: 12px; }
    .value { font-weight: 600; }
    .hr { height: 1px; background: #e5e7eb; margin: 14px 0; }
    .total { font-size: 16px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
  </style>
</head>
<body>
  <div class="card">
    <h1>EdgeWallet Receipt</h1>
    <div class="muted">Receipt No: <span class="mono">${receipt.receiptNo}</span></div>
    <div class="muted">Date: ${dateStr}</div>
    <div class="muted">Operator: ${receipt.operator || '—'}</div>
    <div class="hr"></div>

    <div class="row"><div class="label">Card UID</div><div class="value mono">${receipt.card_uid}</div></div>
    <div class="row"><div class="label">Type</div><div class="value">${receipt.itemType}</div></div>
    <div class="row"><div class="label">Item</div><div class="value">${receipt.itemName}</div></div>
    <div class="row"><div class="label">Unit Price</div><div class="value">$${Number(receipt.unitPrice).toFixed(2)}</div></div>
    <div class="row"><div class="label">Quantity</div><div class="value">${receipt.quantity}</div></div>
    <div class="hr"></div>

    <div class="row total"><div class="label">Total Paid</div><div class="value">$${Number(receipt.totalAmount).toFixed(2)}</div></div>
    <div class="row"><div class="label">Balance Before</div><div class="value">$${Number(receipt.balanceBefore).toFixed(2)}</div></div>
    <div class="row"><div class="label">Balance After</div><div class="value">$${Number(receipt.balanceAfter).toFixed(2)}</div></div>
    <div class="hr"></div>
    <div class="muted">Thank you for using EdgeWallet.</div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(html);
  } catch (err) {
    console.error('Receipt download error:', err);
    res.status(500).send('Failed to generate receipt');
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
  await seedServices();
});

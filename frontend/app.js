const socket = io(BACKEND_URL);

// ── Admin (Top-Up) view elements ──
const statusDisplay = document.getElementById('status-display');
const uidInput = document.getElementById('uid');
const holderNameInput = document.getElementById('holderName');
const amountInput = document.getElementById('amount');
const topupBtn = document.getElementById('topup-btn');
const transactionHistory = document.getElementById('transaction-history');
const cardVisual = document.getElementById('card-visual');
const cardUidDisplay = document.getElementById('card-uid-display');
const cardBalanceDisplay = document.getElementById('card-balance-display');

// ── Cashier (Quick Pay) view elements ──
const cashierView = document.getElementById('cashier-view');
const adminView = document.getElementById('admin-view');
const marketplaceView = document.getElementById('marketplace-view');
const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
const cashierUidInput = document.getElementById('cashier-uid');
const cashierPrevBalance = document.getElementById('cashier-previous-balance');
const cashierProductSelect = document.getElementById('cashier-product');
const cashierQuantityInput = document.getElementById('cashier-quantity');
const cashierTotalDisplay = document.getElementById('cashier-total');
const cashierPayBtn = document.getElementById('cashier-pay-btn');
const cashierResult = document.getElementById('cashier-result');

// ── Marketplace elements ──
const categoryTabsContainer = document.getElementById('category-tabs');
const marketplaceProductsContainer = document.getElementById('marketplace-products');
const cartItemsContainer = document.getElementById('cart-items');
const cartBadge = document.getElementById('cart-badge');
const cartTotal = document.getElementById('cart-total');
const cartPayBtn = document.getElementById('cart-pay-btn');
const cartCardDot = document.getElementById('cart-card-dot');
const cartCardText = document.getElementById('cart-card-text');
const marketplaceResult = document.getElementById('marketplace-result');

// ── System status elements ──
const mqttStatus = document.getElementById('mqtt-status');
const mqttStatusText = document.getElementById('mqtt-status-text');
const backendStatus = document.getElementById('backend-status');
const backendStatusText = document.getElementById('backend-status-text');
const dbStatus = document.getElementById('db-status');
const dbStatusText = document.getElementById('db-status-text');
const connectionIndicator = document.getElementById('connection-indicator');

// ── Stats elements ──
const totalCardsEl = document.getElementById('total-cards');
const todayTransactionsEl = document.getElementById('today-transactions');
const totalVolumeEl = document.getElementById('total-volume');
const avgTransactionEl = document.getElementById('avg-transaction');
const uptimeEl = document.getElementById('uptime');

let lastScannedUid = null;
let currentCardData = null;
let startTime = Date.now();
let productsCache = [];
let cart = []; // { product, quantity }
let activeCategory = 'all';

// ============================================================
// View switching between Admin, Marketplace, and Cashier
// ============================================================
navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const targetView = item.getAttribute('data-view');

    navItems.forEach((n) => n.classList.remove('active'));
    item.classList.add('active');

    adminView.style.display = 'none';
    cashierView.style.display = 'none';
    marketplaceView.classList.remove('active-view');

    if (targetView === 'cashier') {
      cashierView.style.display = 'grid';
    } else if (targetView === 'marketplace') {
      marketplaceView.classList.add('active-view');
    } else {
      adminView.style.display = 'grid';
    }
  });
});

// Load saved amount from localStorage
const savedAmount = localStorage.getItem('topupAmount');
if (savedAmount) {
  amountInput.value = savedAmount;
}

amountInput.addEventListener('input', (e) => {
  if (e.target.value) {
    localStorage.setItem('topupAmount', e.target.value);
  }
});

// Uptime counter
setInterval(() => {
  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  uptimeEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}, 1000);

// ============================================================
// Socket connection events
// ============================================================
socket.on('connect', () => {
  console.log('Connected to backend server');
  updateSystemStatus('backend', true);
  updateSystemStatus('mqtt', true);
  connectionIndicator.classList.add('connected');

  loadStats();
  loadProducts();
});

socket.on('disconnect', () => {
  console.log('Disconnected from backend server');
  updateSystemStatus('backend', false);
  updateSystemStatus('mqtt', false);
  connectionIndicator.classList.remove('connected');
});

socket.on('card-status', async (data) => {
  lastScannedUid = data.uid;
  uidInput.value = data.uid;
  topupBtn.disabled = false;
  cashierUidInput.value = data.uid;
  cashierPayBtn.disabled = false;

  // Update marketplace card info
  updateCartCardInfo();

  try {
    const response = await fetch(`${BACKEND_URL}/card/${data.uid}`);
    if (response.ok) {
      currentCardData = await response.json();
      holderNameInput.value = currentCardData.holderName;

      if (currentCardData.holderName === 'New User') {
        holderNameInput.readOnly = false;
        holderNameInput.focus();
        holderNameInput.select();
      } else {
        holderNameInput.readOnly = true;
      }

      cardVisual.classList.add('active');
      cardUidDisplay.textContent = currentCardData.holderName;
      cardBalanceDisplay.textContent = `$${currentCardData.balance.toFixed(2)}`;
      cashierPrevBalance.textContent = `$${currentCardData.balance.toFixed(2)}`;

      statusDisplay.innerHTML = `
        <div class="data-row">
            <span class="data-label">UID:</span>
            <span class="data-value">${currentCardData.uid}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Holder:</span>
            <span class="data-value">${currentCardData.holderName}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Balance:</span>
            <span class="data-value" style="color: #818cf8;">$${currentCardData.balance.toFixed(2)}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Status:</span>
            <span class="data-value" style="color: #10b981;">Active</span>
        </div>
      `;

      await loadTransactionHistory();
      updateSystemStatus('db', true);
      updateCartCardInfo();
    } else {
      console.log('New card detected (404 expected)');

      currentCardData = null;
      holderNameInput.value = '';
      holderNameInput.readOnly = false;
      holderNameInput.focus();

      const safeBalance = (typeof data.balance === 'number') ? data.balance : 0;

      cardVisual.classList.add('active');
      cardUidDisplay.textContent = data.uid || 'Unknown';
      cardBalanceDisplay.textContent = `$${safeBalance.toFixed(2)}`;
      cashierPrevBalance.textContent = `$${safeBalance.toFixed(2)}`;

      statusDisplay.innerHTML = `
        <div class="data-row">
            <span class="data-label">UID:</span>
            <span class="data-value">${data.uid || 'Unknown'}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Balance:</span>
            <span class="data-value" style="color: #818cf8;">$${safeBalance.toFixed(2)}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Status:</span>
            <span class="data-value" style="color: #f59e0b;">New Card - Enter Name</span>
        </div>
      `;

      transactionHistory.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No transactions yet</p>';
      updateCartCardInfo();
    }
  } catch (err) {
    console.error('Failed to fetch card data:', err);
    updateSystemStatus('db', false);

    currentCardData = null;
    holderNameInput.value = '';
    holderNameInput.readOnly = false;

    cardVisual.classList.add('active');
    cardUidDisplay.textContent = data.uid;
    cardBalanceDisplay.textContent = `$${data.balance.toFixed(2)}`;

    transactionHistory.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 20px;">Failed to load transactions</p>';
  }
});

socket.on('card-balance', (data) => {
  if (data.uid === lastScannedUid) {
    cardBalanceDisplay.textContent = `$${data.new_balance.toFixed(2)}`;

    if (currentCardData) {
      currentCardData.balance = data.new_balance;
    }
    cashierPrevBalance.textContent = `$${data.new_balance.toFixed(2)}`;
    updateCartCardInfo();

    // Glow effect
    cardVisual.style.boxShadow = '0 15px 45px rgba(99, 102, 241, 0.6), 0 0 30px rgba(168, 85, 247, 0.3)';
    setTimeout(() => {
      cardVisual.style.boxShadow = '';
    }, 600);
  }

  statusDisplay.innerHTML += `
    <div class="data-row">
        <span class="data-label">New Balance:</span>
        <span class="data-value" style="color: #818cf8;">$${data.new_balance.toFixed(2)}</span>
    </div>
  `;
});

// Real-time transaction updates
socket.on('transaction-update', (data) => {
  if (data.card_uid && data.card_uid === lastScannedUid) {
    loadTransactionHistory();
  }
  loadStats();

  const op = data.operation_type === 'PAYMENT' ? 'Payment' : 'Top-up';
  const statusLabel = data.status === 'success' ? 'Approved' : 'Rejected';
  const amountLabel = typeof data.amount === 'number' ? `$${data.amount.toFixed(2)}` : 'N/A';
  const balanceLabel = typeof data.new_balance === 'number' ? `$${data.new_balance.toFixed(2)}` : 'Unchanged';
  const productLabel = data.product_name ? ` for ${data.product_name}` : '';
  const qtyLabel = data.quantity && data.quantity > 1 ? ` x${data.quantity}` : '';

  const message = `${op}${productLabel}${qtyLabel} ${statusLabel}. Amount: ${amountLabel}, New balance: ${balanceLabel}. ${data.message || ''}`;

  cashierResult.innerHTML = `
    <div class="data-row">
      <span class="data-label">Status:</span>
      <span class="data-value" style="color:${data.status === 'success' ? '#10b981' : '#ef4444'};">${statusLabel}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Details:</span>
      <span class="data-value">${message}</span>
    </div>
  `;
});

// ============================================================
// Admin Top-Up handler
// ============================================================
topupBtn.addEventListener('click', async () => {
  const amount = parseFloat(amountInput.value);
  const holderName = holderNameInput.value.trim();

  if (isNaN(amount) || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }

  if ((!currentCardData || currentCardData.holderName === 'New User') && !holderName) {
    alert('Please enter a name for this card');
    holderNameInput.focus();
    return;
  }

  try {
    const requestBody = {
      uid: lastScannedUid,
      amount: amount
    };

    if ((!currentCardData || currentCardData.holderName === 'New User') && holderName) {
      requestBody.holderName = holderName;
    }

    const response = await fetch(`${BACKEND_URL}/topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    if (result.success) {
      currentCardData = result.card;
      holderNameInput.value = result.card.holderName;
      holderNameInput.readOnly = true;

      cardUidDisplay.textContent = result.card.holderName;
      cardBalanceDisplay.textContent = `$${result.card.balance.toFixed(2)}`;
      amountInput.value = '';

      await loadTransactionHistory();
      await loadStats();
      updateCartCardInfo();
    } else {
      console.error(`Topup error: ${result.error}`);
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    console.error('Failed to connect to backend for top-up:', err);
    updateSystemStatus('backend', false);
  }
});

// ============================================================
// Cashier payment handler
// ============================================================
const cashierForm = document.getElementById('cashier-form');
cashierForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const cardUid = lastScannedUid;
  const productId = cashierProductSelect.value;
  const quantity = parseInt(cashierQuantityInput.value, 10) || 1;

  if (!cardUid) { alert('Please scan a card first'); return; }
  if (!productId) { alert('Please select a product'); return; }
  if (quantity <= 0) { alert('Quantity must be at least 1'); return; }

  try {
    cashierPayBtn.disabled = true;
    await fetch(`${BACKEND_URL}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_uid: cardUid, product_id: productId, quantity })
    });
  } catch (err) {
    console.error('Failed to connect to backend for payment:', err);
    updateSystemStatus('backend', false);
  } finally {
    cashierPayBtn.disabled = false;
  }
});

// ============================================================
// System status
// ============================================================
function updateSystemStatus(system, isOnline) {
  let statusDot, statusText;

  switch (system) {
    case 'mqtt':
      statusDot = mqttStatus;
      statusText = mqttStatusText;
      statusText.textContent = isOnline ? 'Connected' : 'Disconnected';
      break;
    case 'backend':
      statusDot = backendStatus;
      statusText = backendStatusText;
      statusText.textContent = isOnline ? 'Online' : 'Offline';
      break;
    case 'db':
      statusDot = dbStatus;
      statusText = dbStatusText;
      statusText.textContent = isOnline ? 'Connected' : 'Error';
      break;
  }

  if (statusDot) {
    statusDot.className = 'status-dot ' + (isOnline ? 'online' : 'offline');
  }
}

// ============================================================
// Load statistics
// ============================================================
async function loadStats() {
  try {
    const cardsResponse = await fetch(`${BACKEND_URL}/cards`);
    if (cardsResponse.ok) {
      const cards = await cardsResponse.json();
      totalCardsEl.textContent = cards.length;

      const totalVolume = cards.reduce((sum, card) => sum + card.balance, 0);
      totalVolumeEl.textContent = `$${totalVolume.toFixed(2)}`;
    }

    const transactionsResponse = await fetch(`${BACKEND_URL}/transactions?limit=1000`);
    if (transactionsResponse.ok) {
      const transactions = await transactionsResponse.json();
      const today = new Date().toDateString();
      const todayTransactions = transactions.filter(tx =>
        new Date(tx.timestamp).toDateString() === today
      );
      todayTransactionsEl.textContent = todayTransactions.length;

      if (transactions.length > 0) {
        const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        avgTransactionEl.textContent = `$${(totalAmount / transactions.length).toFixed(2)}`;
      } else {
        avgTransactionEl.textContent = '$0.00';
      }
    }

    updateSystemStatus('db', true);
  } catch (err) {
    console.error('Failed to load stats:', err);
    updateSystemStatus('db', false);
  }
}

// ============================================================
// Load products — populates both Cashier dropdown and Marketplace
// ============================================================
async function loadProducts() {
  try {
    const response = await fetch(`${BACKEND_URL}/products`);
    if (!response.ok) return;

    const products = await response.json();
    productsCache = products;

    // Populate cashier dropdown
    cashierProductSelect.innerHTML = '<option value="">Select a product</option>';
    products.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p._id;
      opt.textContent = `${p.emoji || ''} ${p.name} – $${p.price.toFixed(2)}`;
      opt.dataset.price = p.price;
      cashierProductSelect.appendChild(opt);
    });

    updateCashierTotal();

    // Build category tabs
    const categories = [...new Set(products.map(p => p.category || 'General'))];
    buildCategoryTabs(categories);

    // Render marketplace grid
    renderMarketplaceProducts();
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

function updateCashierTotal() {
  const productId = cashierProductSelect.value;
  const quantity = parseInt(cashierQuantityInput.value, 10) || 1;
  const product = productsCache.find((p) => p._id === productId);

  if (!product || quantity <= 0) {
    cashierTotalDisplay.textContent = '$0.00';
    return;
  }

  cashierTotalDisplay.textContent = `$${(product.price * quantity).toFixed(2)}`;
}

cashierProductSelect.addEventListener('change', updateCashierTotal);
cashierQuantityInput.addEventListener('input', updateCashierTotal);

// ============================================================
// Marketplace — Category Tabs
// ============================================================
function buildCategoryTabs(categories) {
  categoryTabsContainer.innerHTML = '<button class="category-tab active" data-category="all">All</button>';

  const catEmojis = {
    'Food & Drinks': '🍔',
    'Snacks': '🍿',
    'Stationery': '✏️',
    'Electronics': '⚡',
    'Personal Care': '🧴'
  };

  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-tab';
    btn.dataset.category = cat;
    btn.textContent = `${catEmojis[cat] || '📦'} ${cat}`;
    categoryTabsContainer.appendChild(btn);
  });

  // Tab click handlers
  categoryTabsContainer.addEventListener('click', (e) => {
    if (!e.target.classList.contains('category-tab')) return;

    categoryTabsContainer.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    activeCategory = e.target.dataset.category;
    renderMarketplaceProducts();
  });
}

// ============================================================
// Marketplace — Product Grid
// ============================================================
function renderMarketplaceProducts() {
  const filtered = activeCategory === 'all'
    ? productsCache
    : productsCache.filter(p => (p.category || 'General') === activeCategory);

  if (filtered.length === 0) {
    marketplaceProductsContainer.innerHTML = '<div class="status-placeholder">No products in this category</div>';
    return;
  }

  marketplaceProductsContainer.innerHTML = filtered.map(p => `
    <div class="product-card" data-id="${p._id}">
      <span class="product-emoji">${p.emoji || '📦'}</span>
      <div class="product-name">${p.name}</div>
      <div class="product-price">$${p.price.toFixed(2)}</div>
      <button class="product-add-btn" data-id="${p._id}">+ Add</button>
    </div>
  `).join('');

  // Add-to-cart handlers
  marketplaceProductsContainer.querySelectorAll('.product-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(btn.dataset.id);
    });
  });
}

// ============================================================
// Cart Management
// ============================================================
function addToCart(productId) {
  const product = productsCache.find(p => p._id === productId);
  if (!product) return;

  const existing = cart.find(item => item.product._id === productId);
  if (existing) {
    existing.quantity++;
  } else {
    cart.push({ product, quantity: 1 });
  }

  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.product._id !== productId);
  renderCart();
}

function updateCartQuantity(productId, delta) {
  const item = cart.find(i => i.product._id === productId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(productId);
    return;
  }

  renderCart();
}

function renderCart() {
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  cartBadge.textContent = totalItems;
  cartTotal.textContent = `$${totalPrice.toFixed(2)}`;
  cartPayBtn.disabled = cart.length === 0 || !lastScannedUid;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="cart-empty">
        <span class="cart-empty-icon">🛒</span>
        Add products to your cart
      </div>
    `;
    return;
  }

  cartItemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <span class="cart-item-emoji">${item.product.emoji || '📦'}</span>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.product.name}</div>
        <div class="cart-item-price">$${(item.product.price * item.quantity).toFixed(2)}</div>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" data-id="${item.product._id}" data-delta="-1">−</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" data-id="${item.product._id}" data-delta="1">+</button>
      </div>
    </div>
  `).join('');

  // Quantity button handlers
  cartItemsContainer.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      updateCartQuantity(btn.dataset.id, parseInt(btn.dataset.delta));
    });
  });
}

function updateCartCardInfo() {
  if (lastScannedUid && currentCardData) {
    cartCardDot.classList.add('active');
    cartCardText.innerHTML = `<strong>${currentCardData.holderName}</strong> — $${currentCardData.balance.toFixed(2)}`;
  } else if (lastScannedUid) {
    cartCardDot.classList.add('active');
    cartCardText.innerHTML = `Card: <strong>${lastScannedUid}</strong>`;
  } else {
    cartCardDot.classList.remove('active');
    cartCardText.textContent = 'No card scanned';
  }

  // Re-evaluate pay button
  cartPayBtn.disabled = cart.length === 0 || !lastScannedUid;
}

// ============================================================
// Marketplace — Pay from Cart
// ============================================================
cartPayBtn.addEventListener('click', async () => {
  if (!lastScannedUid) {
    alert('Please scan a card first');
    return;
  }

  if (cart.length === 0) return;

  cartPayBtn.disabled = true;
  marketplaceResult.innerHTML = '';

  let allSuccess = true;
  let lastResult = null;

  // Process each cart item as a separate payment
  for (const item of cart) {
    try {
      const res = await fetch(`${BACKEND_URL}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_uid: lastScannedUid,
          product_id: item.product._id,
          quantity: item.quantity
        })
      });

      const result = await res.json();
      lastResult = result;
      if (!result.success) {
        allSuccess = false;
        marketplaceResult.innerHTML = `<div class="marketplace-result error">❌ ${result.message || 'Payment failed'}</div>`;
        break;
      }
    } catch (err) {
      allSuccess = false;
      marketplaceResult.innerHTML = `<div class="marketplace-result error">❌ Connection error</div>`;
      break;
    }
  }

  if (allSuccess && lastResult) {
    const remaining = typeof lastResult.new_balance === 'number' ? `$${lastResult.new_balance.toFixed(2)}` : '';
    marketplaceResult.innerHTML = `<div class="marketplace-result success">✅ Payment successful! ${remaining ? 'Remaining balance: <strong>' + remaining + '</strong>' : ''}</div>`;
    cart = [];
    renderCart();
    // Refresh transaction history
    loadTransactionHistory();
  }

  cartPayBtn.disabled = false;

  // Clear result after a few seconds
  setTimeout(() => {
    marketplaceResult.innerHTML = '';
  }, 5000);
});

// ============================================================
// Transaction History — loads ALL transactions
// ============================================================
async function loadTransactionHistory() {
  try {
    const response = await fetch(`${BACKEND_URL}/transactions?limit=50`);
    if (!response.ok) {
      throw new Error('Failed to fetch transactions');
    }

    const transactions = await response.json();

    if (transactions.length === 0) {
      transactionHistory.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No transactions yet</p>';
      return;
    }

    let html = '<div class="transaction-items">';
    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      const isTopup = tx.type === 'TOPUP' || tx.type === 'topup';
      const typeClass = isTopup ? 'topup' : 'debit';
      const typeIcon = isTopup ? '↑' : '↓';
      const cardLabel = tx.card_uid || tx.uid || '—';

      html += `
        <div class="transaction-item ${typeClass}">
          <div class="transaction-icon">${typeIcon}</div>
          <div class="transaction-details">
            <div class="transaction-desc">${tx.description || tx.type}</div>
            <div class="transaction-time">${dateStr} ${timeStr} · Card: ${cardLabel}</div>
          </div>
          <div class="transaction-amount">
            <div class="amount-value ${isTopup ? 'positive' : 'negative'}">
              ${isTopup ? '+' : '-'}$${tx.amount.toFixed(2)}
            </div>
            <div class="balance-after">Balance: $${tx.balanceAfter.toFixed(2)}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';

    transactionHistory.innerHTML = html;
  } catch (err) {
    console.error('Failed to load transaction history:', err);
    transactionHistory.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 20px;">Failed to load transactions</p>';
  }
}

// Initial load
loadStats();
loadTransactionHistory();

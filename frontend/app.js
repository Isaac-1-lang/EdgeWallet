const socket = io(BACKEND_URL);

const statusDisplay = document.getElementById('status-display');
const uidInput = document.getElementById('uid');
const holderNameInput = document.getElementById('holderName');
const amountInput = document.getElementById('amount');
const topupBtn = document.getElementById('topup-btn');
const transactionHistory = document.getElementById('transaction-history');
const cardVisual = document.getElementById('card-visual');
const cardUidDisplay = document.getElementById('card-uid-display');
const cardBalanceDisplay = document.getElementById('card-balance-display');

// System status elements
const mqttStatus = document.getElementById('mqtt-status');
const mqttStatusText = document.getElementById('mqtt-status-text');
const backendStatus = document.getElementById('backend-status');
const backendStatusText = document.getElementById('backend-status-text');
const dbStatus = document.getElementById('db-status');
const dbStatusText = document.getElementById('db-status-text');
const connectionIndicator = document.getElementById('connection-indicator');

// Stats elements
const totalCardsEl = document.getElementById('total-cards');
const todayTransactionsEl = document.getElementById('today-transactions');
const totalVolumeEl = document.getElementById('total-volume');
const avgTransactionEl = document.getElementById('avg-transaction');
const uptimeEl = document.getElementById('uptime');

let lastScannedUid = null;
let currentCardData = null;
let startTime = Date.now();

// Load saved amount from localStorage
const savedAmount = localStorage.getItem('topupAmount');
if (savedAmount) {
  amountInput.value = savedAmount;
}

// Save amount to localStorage whenever it changes
amountInput.addEventListener('input', (e) => {
  if (e.target.value) {
    localStorage.setItem('topupAmount', e.target.value);
  }
});

// Update uptime counter
setInterval(() => {
  const elapsed = Date.now() - startTime;
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  uptimeEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}, 1000);

// Socket connection events
socket.on('connect', () => {
  console.log('Connected to backend server');
  updateSystemStatus('backend', true);
  updateSystemStatus('mqtt', true);
  connectionIndicator.classList.add('connected');

  // Load initial stats
  loadStats();
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

  // Fetch card data from backend
  try {
    const response = await fetch(`${BACKEND_URL}/card/${data.uid}`);
    if (response.ok) {
      currentCardData = await response.json();
      holderNameInput.value = currentCardData.holderName;

      // Allow editing if it's a "New User" placeholder
      if (currentCardData.holderName === 'New User') {
        holderNameInput.readOnly = false;
        holderNameInput.focus();
        holderNameInput.select(); // Select all text for easy replacement
      } else {
        holderNameInput.readOnly = true;
      }

      // Update Visual Card with stored data
      cardVisual.classList.add('active');
      cardUidDisplay.textContent = currentCardData.holderName;
      cardBalanceDisplay.textContent = `$${currentCardData.balance.toFixed(2)}`;

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
            <span class="data-value" style="color: #6366f1;">$${currentCardData.balance.toFixed(2)}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Status:</span>
            <span class="data-value" style="color: #10b981;">Active</span>
        </div>
      `;

      // Load transaction history
      await loadTransactionHistory(data.uid);
      updateSystemStatus('db', true);
    } else {
      // New card - allow entering holder name
      // Note: A 404 from the backend is EXPECTED here for new cards. It just means the card isn't in our database yet.
      console.log('New card detected (404 expected)');

      currentCardData = null;
      holderNameInput.value = '';
      holderNameInput.readOnly = false;
      holderNameInput.focus();
      holderNameInput.focus();

      const safeBalance = (typeof data.balance === 'number') ? data.balance : 0;

      cardVisual.classList.add('active');
      cardUidDisplay.textContent = data.uid || 'Unknown';
      cardBalanceDisplay.textContent = `$${safeBalance.toFixed(2)}`;

      statusDisplay.innerHTML = `
        <div class="data-row">
            <span class="data-label">UID:</span>
            <span class="data-value">${data.uid || 'Unknown'}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Balance:</span>
            <span class="data-value" style="color: #6366f1;">$${safeBalance.toFixed(2)}</span>
        </div>
        <div class="data-row">
            <span class="data-label">Status:</span>
            <span class="data-value" style="color: #d97706;">New Card - Enter Name</span>
        </div>
      `;

      // Clear transaction history for new cards
      transactionHistory.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No transactions yet</p>';
    }
  } catch (err) {
    console.error('Failed to fetch card data:', err);
    updateSystemStatus('db', false);

    // Fallback to basic display
    currentCardData = null;
    holderNameInput.value = '';
    holderNameInput.readOnly = false;

    cardVisual.classList.add('active');
    cardUidDisplay.textContent = data.uid;
    cardBalanceDisplay.textContent = `$${data.balance.toFixed(2)}`;

    transactionHistory.innerHTML = '<p style="text-align: center; color: #dc2626; padding: 20px;">Failed to load transactions</p>';
  }
});

socket.on('card-balance', (data) => {
  // Update Visual Card if this card is still active
  if (data.uid === lastScannedUid) {
    cardBalanceDisplay.textContent = `$${data.new_balance.toFixed(2)}`;

    // Update current card data
    if (currentCardData) {
      currentCardData.balance = data.new_balance;
    }

    // Brief glow effect
    cardVisual.style.boxShadow = '0 15px 45px 0 rgba(99, 102, 241, 0.8), inset 0 0 0 1px rgba(255, 255, 255, 0.3)';
    setTimeout(() => {
      cardVisual.style.boxShadow = '';
    }, 500);
  }

  statusDisplay.innerHTML += `
        <div class="data-row">
            <span class="data-label">New Balance:</span>
            <span class="data-value" style="color: #6366f1;">$${data.new_balance.toFixed(2)}</span>
        </div>
    `;
});

topupBtn.addEventListener('click', async () => {
  const amount = parseFloat(amountInput.value);
  const holderName = holderNameInput.value.trim();

  if (isNaN(amount) || amount <= 0) {
    alert('Please enter a valid amount');
    return;
  }

  // Check if holder name is required (new card or "New User" update)
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

    // Include holder name for new cards OR renaming "New User"
    if ((!currentCardData || currentCardData.holderName === 'New User') && holderName) {
      requestBody.holderName = holderName;
    }

    const response = await fetch(`${BACKEND_URL}/topup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();
    if (result.success) {
      // Update current card data
      currentCardData = result.card;
      holderNameInput.value = result.card.holderName;
      holderNameInput.readOnly = true;

      // Update display
      cardUidDisplay.textContent = result.card.holderName;
      cardBalanceDisplay.textContent = `$${result.card.balance.toFixed(2)}`;

      amountInput.value = '';

      // Reload transaction history and stats
      await loadTransactionHistory(lastScannedUid);
      await loadStats();
    } else {
      console.error(`Topup error: ${result.error}`);
      alert(`Error: ${result.error}`);
    }
  } catch (err) {
    console.error('Failed to connect to backend for top-up:', err);
    // Suppress aggressive alert for connection errors, just log it
    // alert('Failed to connect to backend');
    updateSystemStatus('backend', false);
  }
});

// System status update function
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

// Load statistics
async function loadStats() {
  try {
    // Get total cards
    const cardsResponse = await fetch(`${BACKEND_URL}/cards`);
    if (cardsResponse.ok) {
      const cards = await cardsResponse.json();
      totalCardsEl.textContent = cards.length;

      // Calculate total volume
      const totalVolume = cards.reduce((sum, card) => sum + card.balance, 0);
      totalVolumeEl.textContent = `$${totalVolume.toFixed(2)}`;
    }

    // Get today's transactions
    const transactionsResponse = await fetch(`${BACKEND_URL}/transactions?limit=1000`);
    if (transactionsResponse.ok) {
      const transactions = await transactionsResponse.json();
      const today = new Date().toDateString();
      const todayTransactions = transactions.filter(tx =>
        new Date(tx.timestamp).toDateString() === today
      );
      todayTransactionsEl.textContent = todayTransactions.length;

      // Calculate average transaction
      if (transactions.length > 0) {
        const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const avgAmount = totalAmount / transactions.length;
        avgTransactionEl.textContent = `$${avgAmount.toFixed(2)}`;
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

// Load transaction history
async function loadTransactionHistory(uid) {
  try {
    const response = await fetch(`${BACKEND_URL}/transactions/${uid}`);
    if (!response.ok) {
      throw new Error('Failed to fetch transactions');
    }

    const transactions = await response.json();

    if (transactions.length === 0) {
      transactionHistory.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">No transactions yet</p>';
      return;
    }

    // Build transaction list HTML
    let html = '<div class="transaction-items">';
    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const dateStr = date.toLocaleDateString();
      const timeStr = date.toLocaleTimeString();
      const typeClass = tx.type === 'topup' ? 'topup' : 'debit';
      const typeIcon = tx.type === 'topup' ? '↑' : '↓';

      html += `
        <div class="transaction-item ${typeClass}">
          <div class="transaction-icon">${typeIcon}</div>
          <div class="transaction-details">
            <div class="transaction-desc">${tx.description || tx.type}</div>
            <div class="transaction-time">${dateStr} ${timeStr}</div>
          </div>
          <div class="transaction-amount">
            <div class="amount-value ${tx.type === 'topup' ? 'positive' : 'negative'}">
              ${tx.type === 'topup' ? '+' : '-'}$${tx.amount.toFixed(2)}
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

// Initial stats load
loadStats();

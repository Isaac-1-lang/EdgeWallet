
Copy

// Initialize Socket.IO connection
const socket = io('http://157.173.101.159:5000');

// DOM elements
const uidElement = document.getElementById('uid');
const balanceElement = document.getElementById('balance');
const amountInput = document.getElementById('amount');
const logList = document.getElementById('log-list');
const statusCard = document.getElementById('status-card');

// Add log entry with type-based styling
function addLog(message, type = 'info') {
    const li = document.createElement('li');
    const timestamp = new Date().toLocaleTimeString();
    li.textContent = `[${timestamp}] ${message}`;
    li.classList.add(`log-${type}`);
    
    // Add to top of list
    logList.insertBefore(li, logList.firstChild);
    
    // Keep only last 50 logs
    if (logList.children.length > 50) {
        logList.removeChild(logList.lastChild);
    }
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-RW', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(amount);
}

// Socket event listeners
socket.on('connect', () => {
    addLog('Connected to the RFID server', 'success');
    console.log('Socket connected');
});

socket.on('disconnect', () => {
    addLog('Disconnected from RFID server', 'error');
    uidElement.textContent = 'Connection lost...';
    uidElement.classList.add('waiting-animation');
});

socket.on('card_detected', (data) => {
    console.log('Card detected:', data);
    uidElement.textContent = data.uid || 'Unknown';
    uidElement.classList.remove('waiting-animation');
    balanceElement.textContent = formatCurrency(data.balance || 0);
    
    // Add animation to status card
    statusCard.classList.add('card-detected');
    setTimeout(() => statusCard.classList.remove('card-detected'), 500);
    
    addLog(`Card detected: ${data.uid}`, 'info');
});

socket.on('card_removed', () => {
    console.log('Card removed');
    uidElement.textContent = 'Waiting for tap...';
    uidElement.classList.add('waiting-animation');
    balanceElement.textContent = '0';
    addLog('Card removed from  RFID reader', 'warning');
});

socket.on('topup_success', (data) => {
    console.log('Top-up successful:', data);
    balanceElement.textContent = formatCurrency(data.new_balance || 0);
    addLog(`Top-up successful: ${formatCurrency(data.amount)} RWF added. New balance: ${formatCurrency(data.new_balance)} RWF`, 'success');
    
    // Clear input
    amountInput.value = '';
    
    // Show success animation
    statusCard.classList.add('card-detected');
    setTimeout(() => statusCard.classList.remove('card-detected'), 500);
});

socket.on('topup_error', (data) => {
    console.error('Top-up error:', data);
    addLog(`Error: ${data.message || 'Top-up failed'}`, 'error');
    alert(`Top-up failed: ${data.message || 'Unknown error'}`);
});

socket.on('error', (data) => {
    console.error('Server error:', data);
    addLog(`System error: ${data.message || 'Unknown error'}`, 'error');
});

// Send top-up request
function sendTopUp() {
    const amount = parseFloat(amountInput.value);
    
    // Validation
    if (!amount || amount <= 0) {
        addLog('Please enter a valid amount', 'error');
        alert('Please enter a valid amount greater than 0');
        return;
    }
    
    if (uidElement.textContent === 'Waiting for tap...' || uidElement.textContent === 'Connection lost...') {
        addLog('No card detected. Please tap a card first', 'warning');
        alert('Please tap your card first');
        return;
    }
    
    // Send top-up request
    addLog(`Requesting top-up of ${formatCurrency(amount)} RWF...`, 'info');
    socket.emit('topup_request', { amount: amount });
}

// Allow Enter key to submit
amountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendTopUp();
    }
});

// Initial log
addLog('EdgeWallet initialized', 'success')
# EdgeWallet RFID Payment System

Live URL: http://157.173.101.159:8256/



A complete RFID-based payment system featuring real-time card management, transaction tracking, and a modern dashboard interface built with ESP8266, MQTT, and MongoDB.

---

## 📋 Table of Contents

- [Features](#-features)
- [System Architecture](#-system-architecture)
- [Quick Start](#-quick-start)
- [Hardware Setup](#-hardware-setup)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [Dashboard](#-dashboard)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Features

### Core Functionality
- **Real-time RFID Detection** - Instant card recognition via MQTT
- **Balance Management** - Cumulative top-ups with persistent storage
- **Transaction History** - Complete audit trail of all operations
- **Cardholder Management** - Store and display cardholder names

### Technical Features
- MongoDB Atlas integration for data persistence
- WebSocket support for real-time updates
- Modern glass-morphism UI design
- Live system health monitoring
- RESTful API for card operations

---

## 🏗️ System Architecture

### Team Information
| Component | Value |
|-----------|-------|
| **Team ID** | `quantum_bitflip_0xDEAD` |
| **VPS Server** | 157.173.101.159 |
| **Backend Port** | 8208 |
| **Frontend Port** | 9208 |
| **MQTT Broker** | 157.173.101.159:1883 |

### Technology Stack
- **Frontend**: HTML5, CSS3, JavaScript, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO, Mongoose, MQTT.js
- **Database**: MongoDB Atlas
- **Hardware**: ESP8266 (NodeMCU), MFRC522 RFID Reader
- **Process Manager**: PM2 (production)

---

## 🚀 Quick Start

### Local Development

#### Option 1: Automated Scripts

**Windows:**
```bash
start-local.bat
```

**Linux/Mac:**
```bash
chmod +x start-local.sh
./start-local.sh
```

#### Option 2: Manual Start

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm start
```

### Access Points

**Local Development:**
- Frontend: http://localhost:9208
- Backend API: http://localhost:8208

**Production (VPS):**
- Frontend: http://157.173.101.159:9208
- Backend API: http://157.173.101.159:8208

---

## 🔌 Hardware Setup

### Pin Connections

Wire the RC522 RFID reader to your ESP8266 (NodeMCU) as follows:

| RC522 Pin | ESP8266 Pin | NodeMCU Label | Function |
|-----------|-------------|---------------|----------|
| 3.3V | 3V3 | 3V3 | Power (+3.3V) |
| RST | GPIO0 | D3 | Reset |
| GND | GND | GND | Ground |
| MISO | GPIO12 | D6 | SPI MISO |
| MOSI | GPIO13 | D7 | SPI MOSI |
| SCK | GPIO14 | D5 | SPI Clock |
| SDA (SS) | GPIO2 | D4 | SPI Slave Select |

### Firmware Installation

1. **Open Arduino IDE**
   - Load `/firmware/iot_rfid_project.ino`

2. **Install Required Libraries**
   - MFRC522 (by GithubCommunity)
   - PubSubClient (by Nick O'Leary)
   - ArduinoJson (by Benoit Blanchon)

3. **Configure WiFi Credentials**
   ```cpp
   const char* ssid = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```

4. **Upload to ESP8266**
   - Select board: NodeMCU 1.0 (ESP-12E Module)
   - Select correct COM port
   - Click Upload

5. **Verify Connection**
   - Open Serial Monitor (115200 baud)
   - Look for "MQTT Connected" message
   - Test by scanning an RFID card

---

## ⚙️ Configuration

### Backend Configuration

Create a `.env` file in the `backend/` directory:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/edgewallet
PORT=8208
```

### Frontend Configuration

The frontend **automatically detects** the environment:

- **Development**: Uses `http://localhost:8208`
- **Production**: Uses `http://157.173.101.159:8208`

No manual configuration required! The system detects whether you're running locally or on the VPS.

---

## 📡 API Reference

### REST Endpoints

#### Get All Cards
```http
GET /cards
```
Returns all registered cards with their balances and holder information.

#### Get Card Details
```http
GET /card/:uid
```
Returns details for a specific card by UID.

**Example:**
```bash
curl http://localhost:8208/card/A1B2C3D4
```

#### Top Up Card
```http
POST /topup
Content-Type: application/json

{
  "uid": "A1B2C3D4",
  "amount": 100,
  "holderName": "John Doe"
}
```

**Parameters:**
- `uid` (string, required): Card UID
- `amount` (number, required): Amount to add
- `holderName` (string, required for new cards): Cardholder name

#### Get All Transactions
```http
GET /transactions?limit=100
```

Query parameters:
- `limit` (optional): Number of transactions to return (default: all)

#### Get Card Transaction History
```http
GET /transactions/:uid
```

Returns all transactions for a specific card.

### WebSocket Events

#### Client → Server
No events are sent from client to server.

#### Server → Client

**card-status**
```javascript
{
  uid: "A1B2C3D4",
  balance: 500,
  holderName: "NIYOBYOSE Isaac Precieux",
  timestamp: "2026-02-12T10:30:00Z"
}
```
Emitted when a card is detected by the RFID reader.

**card-balance**
```javascript
{
  uid: "A1B2C3D4",
  balance: 600,
  success: true
}
```
Emitted when a card balance is successfully updated.

### MQTT Topics

#### Published by ESP8266

**rfid/team_rdf/card/status**
```json
{
  "uid": "A1B2C3D4",
  "balance": 500
}
```
Published when a card is detected.

**rfid/team_rdf/card/balance**
```json
{
  "uid": "A1B2C3D4",
  "balance": 600,
  "success": true
}
```
Confirmation after balance update.

**rfid/team_rdf/device/status**
```
online
```
Last Will message (online/offline).

**rfid/team_rdf/device/health**
```json
{
  "ip": "192.168.1.100",
  "rssi": -65,
  "freeMemory": 32000,
  "uptime": 3600
}
```
Periodic health metrics every 30 seconds.

#### Published by Backend

**rfid/team_rdf/card/topup**
```json
{
  "uid": "A1B2C3D4",
  "amount": 100,
  "newBalance": 600
}
```
Sent to ESP8266 to update card balance.

---

## 🎨 Dashboard

### Main Features

#### Quick Stats Cards
Real-time statistics displayed at the top of the dashboard:
- **Total Cards**: Number of registered cards
- **Today's Transactions**: Count of transactions in the last 24 hours
- **Total Volume**: Sum of all transaction amounts today
- **Average Transaction**: Mean transaction value

#### Active Card Display
Glass-morphism card design showing:
- Card UID
- Current balance
- Cardholder name
- Last activity timestamp

#### Top-Up Form
Simple interface to add funds:
- Amount input with validation
- Cardholder name (auto-filled for existing cards)
- Submit button triggers real-time update

#### Transaction History
Scrollable list showing:
- Transaction type (top-up/debit)
- Amount with visual indicators
- Before/after balance
- Timestamp
- Description

#### Sidebar Features

**Navigation Menu**
- Cards overview
- Analytics (future feature)
- Settings (future feature)

**System Status**
Real-time monitoring of:
- MQTT broker connection
- Backend server status
- Database connectivity

**Team Information**
- Team ID display
- System uptime counter

---

## 🚀 Deployment

### VPS Deployment Guide

#### 1. Upload Files to VPS
```bash
scp -r tap-to-pay root@157.173.101.159:/root/
```

#### 2. SSH into VPS
```bash
ssh root@157.173.101.159
```

#### 3. Navigate to Project
```bash
cd /root/tap-to-pay
```

#### 4. Make Deploy Script Executable
```bash
chmod +x deploy.sh
```

#### 5. Run Deployment
```bash
./deploy.sh
```

The script will:
- Install Node.js and dependencies
- Set up PM2 process manager
- Configure firewall rules
- Start backend and frontend services
- Display service status

#### 6. Verify Deployment
```bash
pm2 status
```

You should see:
```
┌────┬───────────────────────┬─────────┬─────────┐
│ id │ name                  │ status  │ cpu     │
├────┼───────────────────────┼─────────┼─────────┤
│ 0  │ tap-to-pay-backend    │ online  │ 0%      │
│ 1  │ tap-to-pay-frontend   │ online  │ 0%      │
└────┴───────────────────────┴─────────┴─────────┘
```

### PM2 Management Commands

```bash
# View all running processes
pm2 status

# View logs
pm2 logs tap-to-pay-backend
pm2 logs tap-to-pay-frontend

# Restart services
pm2 restart tap-to-pay-backend
pm2 restart tap-to-pay-frontend

# Stop services
pm2 stop tap-to-pay-backend
pm2 stop tap-to-pay-frontend

# Monitor resource usage
pm2 monit

# Save PM2 configuration
pm2 save

# Set PM2 to start on system boot
pm2 startup
```

### Firewall Configuration

The deployment script automatically configures these ports:

| Port | Service | Description |
|------|---------|-------------|
| 8208 | Backend API | REST API and WebSocket |
| 9208 | Frontend | Web dashboard |
| 1883 | MQTT Broker | Device communication |
| 22 | SSH | Remote access |

For detailed deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🗄️ Database Schema

### Card Collection

```javascript
{
  uid: String (unique),           // Card UID (e.g., "A1B2C3D4")
  holderName: String,              // Cardholder name
  balance: Number,                 // Current balance in currency units
  lastTopup: Number,               // Amount of last top-up
  createdAt: Date,                 // Auto-generated
  updatedAt: Date                  // Auto-updated
}
```

**Indexes:**
- `uid`: unique index for fast lookups

### Transaction Collection

```javascript
{
  uid: String,                     // Card UID
  holderName: String,              // Cardholder name at time of transaction
  type: String,                    // "topup" or "debit"
  amount: Number,                  // Transaction amount
  balanceBefore: Number,           // Balance before transaction
  balanceAfter: Number,            // Balance after transaction
  description: String,             // Transaction description
  timestamp: Date                  // Transaction date/time
}
```

**Indexes:**
- `uid`: for filtering by card
- `timestamp`: for time-based queries

---

## 🛠️ Troubleshooting

### Backend Issues

**Problem: Backend won't start**
```bash
# Check if port is already in use
lsof -i :8208

# Kill process using the port
kill -9 <PID>
```

**Problem: MongoDB connection failed**
- Verify `.env` file exists in `backend/` directory
- Check MongoDB URI is correct
- Ensure MongoDB Atlas allows connections from your IP
- Test connection string in MongoDB Compass

**Problem: MQTT broker not connecting**
```bash
# Test MQTT broker
telnet 157.173.101.159 1883

# Check mosquitto service (if running locally)
sudo systemctl status mosquitto
```

### Frontend Issues

**Problem: Can't connect to backend**
- Verify backend is running: `curl http://localhost:8256/cards`
- Check browser console for errors (F12)
- Ensure ports 8208 and 9208 are not blocked

**Problem: WebSocket connection failed**
- Backend must be running for WebSocket
- Check browser console for connection errors
- Verify no proxy/firewall blocking WebSocket

### Hardware Issues

**Problem: RFID reader not detecting cards**
1. Check wiring connections
2. Verify power (3.3V, NOT 5V)
3. Open Arduino Serial Monitor (115200 baud)
4. Look for initialization messages

**Problem: ESP8266 not connecting to WiFi**
1. Verify WiFi credentials in firmware
2. Check WiFi network is 2.4GHz (ESP8266 doesn't support 5GHz)
3. Ensure WiFi password is correct

**Problem: ESP8266 not connecting to MQTT**
1. Verify MQTT broker IP and port
2. Check firewall allows port 1883
3. Test MQTT broker: `mosquitto_pub -h 157.173.101.159 -t test -m "hello"`

### Common PM2 Issues

**Problem: PM2 processes not starting**
```bash
# View detailed logs
pm2 logs

# Delete and restart
pm2 delete all
pm2 start backend/server.js --name tap-to-pay-backend
pm2 start frontend/server.js --name tap-to-pay-frontend
```

**Problem: PM2 doesn't restart on reboot**
```bash
# Set up startup script
pm2 startup
pm2 save
```

---

## 📦 Project Structure

```
tap-to-pay/
│
├── backend/
│   ├── server.js              # Express + Socket.IO + MQTT server
│   ├── package.json           # Node.js dependencies
│   └── .env                   # MongoDB connection (not in git)
│
├── frontend/
│   ├── index.html             # Dashboard UI
│   ├── app.js                 # Frontend logic and WebSocket
│   ├── style.css              # Glass-morphism styling
│   ├── config.js              # Auto environment detection
│   ├── server.js              # Static file server
│   └── package.json           # Node.js dependencies
│
├── firmware/
│   └── iot_rfid_project.ino   # ESP8266 Arduino code
│
├── DEPLOYMENT.md              # Detailed deployment guide
├── deploy.sh                  # Automated VPS deployment
├── start-local.sh             # Local startup (Linux/Mac)
├── start-local.bat            # Local startup (Windows)
└── README.md                  # This file
```

---

## 🔐 Security Notes

### Development
- CORS enabled for `http://localhost:9208`
- MongoDB credentials in `.env` (excluded from git)
- WebSocket connections from any origin allowed

### Production Recommendations
1. **Use HTTPS**: Set up Nginx reverse proxy with SSL
2. **Restrict CORS**: Limit to production domain only
3. **Secure MongoDB**: Use strong passwords and IP whitelist
4. **Firewall**: Allow only necessary ports (22, 8208, 9208, 1883)
5. **Environment Variables**: Never commit `.env` to version control
6. **MQTT Authentication**: Add username/password to MQTT broker

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🤝 Support

For issues or questions:
1. Check the [Troubleshooting](#-troubleshooting) section
2. Review logs: `pm2 logs`
3. Contact team: **quantum_bitflip_0xDEAD**

---

**Built with ❤️ for IoT Education**

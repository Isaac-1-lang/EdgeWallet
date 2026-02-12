const express = require('express');
const path = require('path');
const app = express();

const PORT = 8256;

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
  console.log(`Access locally: http://localhost:${PORT}`);
  console.log(`Access from VPS: http://157.173.101.159:${PORT}`);
});

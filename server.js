const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Route for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index-improved.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Local Whisper Transcriber running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}`);
});

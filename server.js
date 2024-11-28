const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const User = require('./models/User'); // Import the User model
const path = require('path');
const { google } = require('googleapis');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
}));
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 }) // 30 seconds timeout
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// WhatsApp client setup
const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp client is ready!');
});

client.on('auth_failure', (msg) => {
  console.error('WhatsApp auth failure:', msg);
});

client.initialize();

// Google Sheets credentials loading
let sheetsCredentials;
try {
  sheetsCredentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
} catch (error) {
  console.error('Error parsing Google Sheets credentials:', error);
  process.exit(1);
}

const sheetsClient = new google.auth.JWT(
  sheetsCredentials.client_email,
  null,
  sheetsCredentials.private_key.replace(/\\n/g, '\n'), // Ensure private key is correctly formatted
  ['https://www.googleapis.com/auth/spreadsheets']
);

// Function to write data to Google Sheets
async function writeToGoogleSheets(data) {
  const sheets = google.sheets({ version: 'v4', auth: sheetsClient });
  const spreadsheetId = process.env.SPREADSHEET_ID; // Use the correct Google Sheets ID
  const range = 'Sheet1!A:E'; // Adjust the range as needed

  // Check if headers exist, if not, add them
  const headers = ['Name', 'Email', 'Phone', 'Message', 'Timestamp'];
  const headerRange = 'Sheet1!A1:E1';
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });

  if (!headerResponse.data.values || headerResponse.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: headerRange,
      valueInputOption: 'RAW',
      resource: {
        values: [headers],
      },
    });
  }

  const request = {
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    resource: {
      values: [
        [data.name, data.email, data.phone, data.message, new Date().toLocaleString()],
      ],
    },
  };

  try {
    await sheets.spreadsheets.values.append(request);
    console.log('Data written to Google Sheets');
  } catch (error) {
    console.error('Error writing to Google Sheets:', error);
    throw error;
  }
}

// API endpoint to handle form submissions
app.post('/api/send-whatsapp', async (req, res) => {
  const { name, email, phone, message } = req.body;

  try {
    // Save user details to the database
    const user = new User({ name, email, phone, message });
    await user.save();

    // Write data to Google Sheets
    await writeToGoogleSheets({ name, email, phone, message });

    // Send WhatsApp message
    const chatId = `${process.env.MY_WHATSAPP_NUMBER}@c.us`; // Your WhatsApp number
    const userMessage = `New message from ${name} (${phone}, ${email}): ${message}`;
    await client.sendMessage(chatId, userMessage);

    res.status(200).json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve static files from the React app (if deployed)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/build')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build/index.html'));
  });
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

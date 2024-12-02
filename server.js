const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const User = require('./models/User'); // Import the User model
const path = require('path');
const { google } = require('googleapis');
const compression = require('compression');
const apicache = require('apicache');
const helmet = require('helmet');
const { SitemapStream, streamToPromise } = require('sitemap');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173', // Your frontend URL
}));
app.use(express.json());
app.use(compression());
app.use(helmet());

let cache = apicache.middleware;

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
  const range = 'Sheet1!A:D'; // Adjust the range as needed

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
app.post('/api/send-whatsapp', cache('5 minutes'), async (req, res) => {
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

// Serve robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Disallow: /admin/
Disallow: /login/
Disallow: /register/
Allow: /

Sitemap: https://www.lovosistech.com/sitemap.xml`);
});

// Sitemap generation
const sitemapUrls = [
  { url: '/', changefreq: 'daily', priority: 1.0 },
  { url: '/audiovideo', changefreq: 'weekly', priority: 0.8 },
  { url: '/service', changefreq: 'weekly', priority: 0.8 },
  { url: '/client', changefreq: 'weekly', priority: 0.8 },
  { url: '/about', changefreq: 'monthly', priority: 0.5 },
  { url: '/contact', changefreq: 'monthly', priority: 0.5 },
];

app.get('/sitemap.xml', async (req, res) => {
  try {
    const smStream = new SitemapStream({ hostname: 'https://www.lovosistech.com' });
    sitemapUrls.forEach(url => smStream.write(url));
    smStream.end();

    const sitemap = await streamToPromise(smStream).then(data => data.toString());
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
  } catch (error) {
    console.error('Error generating sitemap:', error);
    res.status(500).end();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

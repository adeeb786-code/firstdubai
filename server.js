const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const User = require('./models/User'); // Import the User model
const { google } = require('googleapis');
const dbConnect = require('./config/db');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL_DEV,  // For development (localhost)
  process.env.FRONTEND_URL_PROD  // For production (Vercel frontend)
];

app.use(cors({
  origin: allowedOrigins,  // Allow the specified origins
  methods: ["POST", "GET"], // Allowed methods
}));

app.use(express.json());

// MongoDB connection
dbConnect();

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
    res.status(500).json({ success: false, error: error.message, details: error });
  }
});

// Serve robots.txt (Optional if you want to serve from backend)
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Disallow: /admin/
Disallow: /login/
Disallow: /register/
Allow: /

Sitemap: https://www.lovosistech.com/sitemap.xml`);
});

// Sitemap generation (Optional if frontend is generating this file)
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
  console.log(`Server running on port ${PORT}`);
});

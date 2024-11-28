// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  company: String,
  email: String,
  phone: String,
  message: String
});

module.exports = mongoose.model('User', userSchema);
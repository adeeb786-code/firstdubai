const mongoose = require("mongoose")

const dbConnect = async () => {
  const maxRetries = 5;
  const retryInterval = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mongoose.connect(process.env.MONGO_URL, {
        dbName: "saudi",
      });
      console.log("✅ MongoDB connected successfully");
      break;
    } catch (error) {
      console.error(
        `❌ MongoDB connection attempt ${attempt} failed: ${error.message}`
      );
      if (attempt === maxRetries) {
        console.error("🚨 Max retry attempts reached. Exiting...");
        process.exit(1);
      }
      console.log(`🔄 Retrying in ${retryInterval / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }
};

module.exports = dbConnect
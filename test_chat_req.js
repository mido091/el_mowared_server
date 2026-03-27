import pool from './src/config/db.js';
import { generateToken } from './src/utils/generateToken.js';
import axios from 'axios';

async function run() {
  try {
    // 1. Get an active user to act as sender
    const [users] = await pool.execute("SELECT id FROM users LIMIT 1");
    if (!users.length) return console.log('No users found');
    const token = generateToken(users[0].id);

    // 2. Mock 'handleStartNewChat' payload from frontend
    // vendor.id = 1
    const payload = { vendorId: 1, messageText: "Test inquiry" };

    // 3. Make request
    console.log('Sending Payload:', payload);
    const res = await axios.post('http://localhost:5000/api/v1/chats/start', payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Success:', res.data);
  } catch (err) {
    if (err.response) {
      console.error('API Error:', err.response.data);
    } else {
      console.error('Network Error:', err.message);
    }
  } finally {
    process.exit();
  }
}

run();


import ChatService from './src/services/ChatService.js';
import pool from './src/config/db.js';

async function testReply() {
  try {
    // Simulate Owner (User ID 6) replying to Conversation ID 3
    const result = await ChatService.sendConversationMessage(6, 3, 'Test reply from script', {}, 'OWNER');
    console.log('Success:', result);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit();
  }
}

testReply();

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store connected users
const users = new Map();

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User joins
  socket.on('joinChat', (username) => {
    users.set(socket.id, username);
    socket.username = username;
    
    // Notify all users
    io.emit('userJoined', {
      username: username,
      userCount: users.size,
      message: `${username} joined the chatroom`
    });
    
    console.log(`${username} joined. Total users: ${users.size}`);
  });

  // Receive message
  socket.on('sendMessage', (message) => {
    if (message.trim()) {
      io.emit('messageReceived', {
        username: socket.username,
        message: message,
        timestamp: new Date().toLocaleTimeString()
      });
      
      console.log(`${socket.username}: ${message}`);
    }
  });

  // User typing
  socket.on('typing', () => {
    socket.broadcast.emit('userTyping', {
      username: socket.username
    });
  });

  // User stops typing
  socket.on('stopTyping', () => {
    socket.broadcast.emit('userStopTyping', {
      username: socket.username
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      users.delete(socket.id);
      io.emit('userLeft', {
        username: username,
        userCount: users.size,
        message: `${username} left the chatroom`
      });
      console.log(`${username} left. Total users: ${users.size}`);
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`💬 Chatroom server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

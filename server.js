const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
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

// Game data structures
const races = new Map();
const players = new Map();

// Race manager
class Race {
  constructor(id, raceType) {
    this.id = id;
    this.raceType = raceType;
    this.players = new Map();
    this.maxPlayers = 4;
    this.playerCount = 0;
    this.status = 'waiting'; // waiting, active, finished
    this.startTime = null;
    this.laps = raceType === 'laps' ? 3 : 1;
    this.timeLimit = raceType === 'timeLimit' ? 180000 : null; // 3 minutes for time trial
  }

  canJoin() {
    return this.status === 'waiting' && this.playerCount < this.maxPlayers;
  }

  addPlayer(playerId, playerName) {
    if (!this.canJoin()) return false;

    this.players.set(playerId, {
      id: playerId,
      name: playerName,
      position: { x: 400, y: 300 },
      velocity: { x: 0, y: 0 },
      angle: 0,
      speed: 0,
      lapCount: 0,
      checkpointsHit: [],
      finished: false,
      finishTime: null
    });

    this.playerCount++;

    // Start race when 2+ players join
    if (this.playerCount >= 2 && this.status === 'waiting') {
      setTimeout(() => {
        this.status = 'active';
        this.startTime = Date.now();
      }, 5000); // 5 second countdown
    }

    return true;
  }

  removePlayer(playerId) {
    if (this.players.has(playerId)) {
      this.players.delete(playerId);
      this.playerCount--;

      if (this.playerCount === 0) {
        races.delete(this.id);
      }
    }
  }

  updatePlayer(playerId, data) {
    if (this.players.has(playerId)) {
      const player = this.players.get(playerId);
      Object.assign(player, data);

      // Check lap/checkpoint logic
      if (data.checkpoint) {
        if (data.checkpoint === 'finish' && !player.finished) {
          player.lapCount++;
          if (player.lapCount >= this.laps) {
            player.finished = true;
            player.finishTime = Date.now() - this.startTime;
          }
        }
        player.checkpointsHit.push(data.checkpoint);
      }
    }
  }

  getState() {
    const state = {};
    this.players.forEach((player, id) => {
      state[id] = {
        ...player
      };
    });
    return state;
  }

  isFinished() {
    if (this.raceType === 'timeLimit') {
      return this.timeLimit && (Date.now() - this.startTime) > this.timeLimit;
    }
    return this.players.size > 0 && Array.from(this.players.values()).every(p => p.finished);
  }
}

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.emit('playerId', socket.id);

  // Join game
  socket.on('joinGame', (playerName) => {
    players.set(socket.id, {
      id: socket.id,
      name: playerName,
      socket: socket
    });
    console.log(`${playerName} joined the game`);
  });

  // Get available races
  socket.on('getAvailableRaces', () => {
    const availableRaces = Array.from(races.values()).map(race => ({
      id: race.id,
      type: race.raceType,
      playerCount: race.playerCount,
      maxPlayers: race.maxPlayers,
      status: race.status
    }));

    socket.emit('availableRaces', availableRaces);
  });

  // Create new race
  socket.on('createRace', (raceType) => {
    const raceId = uuidv4();
    const race = new Race(raceId, raceType);
    races.set(raceId, race);

    socket.emit('raceCreated', { raceId });
    console.log(`Race created: ${raceId} (${raceType})`);
  });

  // Join race
  socket.on('joinRace', (raceId) => {
    const race = races.get(raceId);
    if (!race) {
      socket.emit('error', 'Race not found');
      return;
    }

    const player = players.get(socket.id);
    if (!player) {
      socket.emit('error', 'Player not found');
      return;
    }

    if (race.addPlayer(socket.id, player.name)) {
      socket.join(raceId);
      const raceState = race.getState();

      // Notify all players in race
      io.to(raceId).emit('playerJoined', {
        playerId: socket.id,
        playerName: player.name,
        players: raceState
      });

      console.log(`${player.name} joined race ${raceId}`);

      // Start race after 5 seconds
      if (race.playerCount >= 2 && race.status === 'waiting') {
        setTimeout(() => {
          race.status = 'active';
          race.startTime = Date.now();
          io.to(raceId).emit('raceStarted', {
            raceType: race.raceType,
            laps: race.laps,
            timeLimit: race.timeLimit
          });
          console.log(`Race ${raceId} started!`);
        }, 5000);
      }
    } else {
      socket.emit('error', 'Cannot join race (full or not waiting)');
    }
  });

  // Update player position
  socket.on('updatePosition', ({ raceId, position, velocity, angle, speed, checkpoint }) => {
    const race = races.get(raceId);
    if (race) {
      race.updatePlayer(socket.id, {
        position,
        velocity,
        angle,
        speed,
        lastCheckpoint: checkpoint
      });

      // Broadcast to all players in race
      const raceState = race.getState();
      io.to(raceId).emit('playersUpdate', raceState);

      // Check if player finished
      if (checkpoint === 'finish') {
        const player = race.players.get(socket.id);
        if (player && player.finished) {
          io.to(raceId).emit('playerFinished', {
            playerId: socket.id,
            playerName: player.name,
            time: player.finishTime,
            lapCount: player.lapCount
          });
        }
      }
    }
  });

  // Send message
  socket.on('sendMessage', ({ raceId, message }) => {
    const player = players.get(socket.id);
    if (player && message.trim()) {
      io.to(raceId).emit('messageReceived', {
        playerName: player.name,
        message: message.substring(0, 100), // Limit message length
        timestamp: Date.now()
      });
    }
  });

  // Finish race
  socket.on('finishRace', (raceId) => {
    const race = races.get(raceId);
    if (race) {
      race.status = 'finished';
      io.to(raceId).emit('raceFinished', {
        winners: Array.from(race.players.values())
          .filter(p => p.finished)
          .map(p => ({ name: p.name, time: p.finishTime }))
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`${player.name} disconnected`);
      players.delete(socket.id);

      // Remove from all races
      races.forEach((race, raceId) => {
        if (race.players.has(socket.id)) {
          race.removePlayer(socket.id);
          io.to(raceId).emit('playerLeft', socket.id);
        }
      });
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏎️ Town Chase server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

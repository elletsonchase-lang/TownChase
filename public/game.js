// Socket.io connection
const socket = io();

// Game variables
let playerId = null;
let playerName = null;
let currentRaceId = null;
let currentRaceType = null;
let gameState = {};
let localPlayer = null;
let gameRunning = false;
let raceStartTime = null;
let raceTimeLimit = null;

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game constants
const TRACK_WIDTH = 800;
const TRACK_HEIGHT = 600;
const CAR_WIDTH = 30;
const CAR_HEIGHT = 20;
const ACCELERATION = 0.5;
const FRICTION = 0.85;
const MAX_SPEED = 8;
const TURN_SPEED = 0.1;

// Checkpoints
const checkpoints = [
  { x: 400, y: 50, type: 'start', radius: 40 },
  { x: 750, y: 300, type: 'checkpoint', radius: 40 },
  { x: 400, y: 550, type: 'checkpoint', radius: 40 },
  { x: 50, y: 300, type: 'checkpoint', radius: 40 },
  { x: 400, y: 50, type: 'finish', radius: 40 }
];

// Obstacles
const obstacles = [
  // Trees (obstacles)
  { x: 150, y: 100, type: 'tree', radius: 20 },
  { x: 650, y: 100, type: 'tree', radius: 20 },
  { x: 100, y: 300, type: 'tree', radius: 20 },
  { x: 700, y: 350, type: 'tree', radius: 20 },
  { x: 200, y: 450, type: 'tree', radius: 20 },
  { x: 600, y: 500, type: 'tree', radius: 20 },
  // Traffic cones
  { x: 400, y: 200, type: 'cone', radius: 15 },
  { x: 300, y: 350, type: 'cone', radius: 15 },
  { x: 500, y: 350, type: 'cone', radius: 15 },
  // Track walls (outer boundary)
  { x: 0, y: 0, type: 'wall', width: 800, height: 30 },
  { x: 0, y: 570, type: 'wall', width: 800, height: 30 },
  { x: 0, y: 0, type: 'wall', width: 30, height: 600 },
  { x: 770, y: 0, type: 'wall', width: 30, height: 600 }
];

// UI Functions
function startGame() {
  playerName = document.getElementById('playerName').value.trim();
  if (!playerName) {
    alert('Please enter your name!');
    return;
  }
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('raceMenu').classList.remove('hidden');
  socket.emit('joinGame', playerName);
}

function selectRaceType(type) {
  currentRaceType = type;
  document.getElementById('raceMenu').classList.add('hidden');
  document.getElementById('lobbyMenu').classList.remove('hidden');
  loadAvailableRaces();
}

function backToMenu() {
  document.getElementById('raceMenu').classList.add('hidden');
  document.getElementById('lobbyMenu').classList.add('hidden');
  document.getElementById('gameScreen').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
}

function createNewRace() {
  socket.emit('createRace', currentRaceType);
}

function loadAvailableRaces() {
  socket.emit('getAvailableRaces');
}

function joinRace(raceId) {
  socket.emit('joinRace', raceId);
}

// Socket.io listeners
socket.on('playerId', (id) => {
  playerId = id;
});

socket.on('availableRaces', (races) => {
  const racesDiv = document.getElementById('availableRaces');
  if (races.length === 0) {
    racesDiv.innerHTML = '<p>No races available. Create one!</p>';
    return;
  }
  
  racesDiv.innerHTML = races.map(race => `
    <div class="race-item">
      <p><strong>${race.type === 'firstToFinish' ? '🏁' : race.type === 'laps' ? '🔄' : '⏱️'} ${race.type}</strong></p>
      <p>Players: ${race.playerCount}/${race.maxPlayers}</p>
      <button onclick="joinRace('${race.id}')" style="width: 100%; margin-top: 10px;">Join Race</button>
    </div>
  `).join('');
});

socket.on('raceCreated', ({ raceId }) => {
  currentRaceId = raceId;
  joinRace(raceId);
});

socket.on('playerJoined', ({ playerId: joinedPlayerId, playerName: joinedName, players }) => {
  if (currentRaceId) {
    gameState = players;
    if (joinedPlayerId === playerId) {
      localPlayer = players[playerId];
      startGameScreen();
    }
  }
});

socket.on('raceStarted', ({ raceType, laps, timeLimit }) => {
  gameRunning = true;
  raceStartTime = Date.now();
  raceTimeLimit = timeLimit;
  
  // Initialize local player
  if (localPlayer) {
    localPlayer.lapCount = 0;
    localPlayer.checkpointsHit = [];
    localPlayer.finished = false;
  }
});

socket.on('playersUpdate', (players) => {
  gameState = players;
});

socket.on('playerFinished', ({ playerId: finishedPlayerId, playerName: finishedName, time, lapCount }) => {
  if (gameState[finishedPlayerId]) {
    gameState[finishedPlayerId].finished = true;
    gameState[finishedPlayerId].finishTime = time;
  }
  addChatMessage('System', `${finishedName} finished in ${(time / 1000).toFixed(2)}s!`);
});

socket.on('messageReceived', ({ playerName: msgPlayerName, message, timestamp }) => {
  addChatMessage(msgPlayerName, message);
});

socket.on('playerLeft', (leftPlayerId) => {
  delete gameState[leftPlayerId];
  updatePlayersList();
});

// Game Screen
function startGameScreen() {
  document.getElementById('lobbyMenu').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('hidden');
  updatePlayersList();
  gameLoop();
}

// Game Loop
function gameLoop() {
  if (!gameRunning) return;

  // Clear canvas
  ctx.fillStyle = 'rgba(135, 206, 235, 0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw track
  drawTrack();

  // Draw obstacles
  drawObstacles();

  // Update and draw local player
  if (localPlayer) {
    handleInput();
    updatePlayer(localPlayer);
    drawPlayer(localPlayer, true);
  }

  // Draw other players
  Object.entries(gameState).forEach(([id, player]) => {
    if (id !== playerId) {
      drawPlayer(player, false);
    }
  });

  // Check collisions
  if (localPlayer) {
    checkCollisions(localPlayer);
    checkCheckpoints(localPlayer);
    
    // Send position to server
    socket.emit('updatePosition', {
      raceId: currentRaceId,
      position: localPlayer.position,
      velocity: localPlayer.velocity,
      angle: localPlayer.angle,
      speed: localPlayer.speed,
      checkpoint: localPlayer.lastCheckpoint
    });
    localPlayer.lastCheckpoint = null;
  }

  // Update UI
  updateGameUI();

  requestAnimationFrame(gameLoop);
}

// Input Handling
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'Enter') {
    const input = document.getElementById('chatInput');
    if (input.value.trim()) {
      socket.emit('sendMessage', {
        raceId: currentRaceId,
        message: input.value
      });
      input.value = '';
    }
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

function handleInput() {
  const player = localPlayer;
  
  // Acceleration
  if (keys['arrowup'] || keys['w']) {
    player.velocity.x += Math.cos(player.angle) * ACCELERATION;
    player.velocity.y += Math.sin(player.angle) * ACCELERATION;
  }
  
  // Reverse
  if (keys['arrowdown'] || keys['s']) {
    player.velocity.x -= Math.cos(player.angle) * ACCELERATION * 0.5;
    player.velocity.y -= Math.sin(player.angle) * ACCELERATION * 0.5;
  }
  
  // Turn left
  if (keys['arrowleft'] || keys['a']) {
    player.angle -= TURN_SPEED;
  }
  
  // Turn right
  if (keys['arrowright'] || keys['d']) {
    player.angle += TURN_SPEED;
  }
  
  // Apply friction
  player.velocity.x *= FRICTION;
  player.velocity.y *= FRICTION;
  
  // Limit max speed
  const speed = Math.sqrt(player.velocity.x ** 2 + player.velocity.y ** 2);
  if (speed > MAX_SPEED) {
    player.velocity.x = (player.velocity.x / speed) * MAX_SPEED;
    player.velocity.y = (player.velocity.y / speed) * MAX_SPEED;
  }
  
  // Update position
  player.position.x += player.velocity.x;
  player.position.y += player.velocity.y;
  
  // Boundary check
  player.position.x = Math.max(0, Math.min(TRACK_WIDTH - CAR_WIDTH, player.position.x));
  player.position.y = Math.max(0, Math.min(TRACK_HEIGHT - CAR_HEIGHT, player.position.y));
  
  player.speed = speed;
}

function updatePlayer(player) {
  // Update position (already done in handleInput)
}

// Drawing Functions
function drawTrack() {
  // Draw road
  ctx.fillStyle = '#333';
  ctx.fillRect(30, 30, TRACK_WIDTH - 60, TRACK_HEIGHT - 60);
  
  // Draw road markings
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(TRACK_WIDTH / 2, 30);
  ctx.lineTo(TRACK_WIDTH / 2, TRACK_HEIGHT - 30);
  ctx.stroke();
  
  ctx.setLineDash([]);
}

function drawCheckpoints() {
  checkpoints.forEach((cp, index) => {
    ctx.fillStyle = cp.type === 'finish' ? '#ff4444' : cp.type === 'start' ? '#44ff44' : '#ffff44';
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, cp.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawObstacles() {
  obstacles.forEach(obs => {
    if (obs.type === 'tree') {
      ctx.fillStyle = '#228B22';
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (obs.type === 'cone') {
      ctx.fillStyle = '#FF6600';
      ctx.beginPath();
      ctx.arc(obs.x, obs.y, obs.radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (obs.type === 'wall') {
      ctx.fillStyle = '#000';
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    }
  });
}

function drawPlayer(player, isLocal) {
  ctx.save();
  ctx.translate(player.position.x, player.position.y);
  ctx.rotate(player.angle);
  
  ctx.fillStyle = isLocal ? '#ff0000' : '#0066ff';
  ctx.fillRect(-CAR_WIDTH / 2, -CAR_HEIGHT / 2, CAR_WIDTH, CAR_HEIGHT);
  
  // Car front indicator
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(CAR_WIDTH / 2 - 5, -CAR_HEIGHT / 4, 5, CAR_HEIGHT / 2);
  
  ctx.restore();
}

function checkCollisions(player) {
  obstacles.forEach(obs => {
    let collides = false;
    
    if (obs.type === 'tree' || obs.type === 'cone') {
      const dist = Math.sqrt(
        Math.pow(player.position.x - obs.x, 2) +
        Math.pow(player.position.y - obs.y, 2)
      );
      collides = dist < (CAR_WIDTH / 2 + obs.radius);
    } else if (obs.type === 'wall') {
      collides = player.position.x < obs.x + obs.width &&
                 player.position.x + CAR_WIDTH > obs.x &&
                 player.position.y < obs.y + obs.height &&
                 player.position.y + CAR_HEIGHT > obs.y;
    }
    
    if (collides) {
      // Bounce back
      player.velocity.x *= -0.5;
      player.velocity.y *= -0.5;
    }
  });
}

function checkCheckpoints(player) {
  checkpoints.forEach(cp => {
    const dist = Math.sqrt(
      Math.pow(player.position.x - cp.x, 2) +
      Math.pow(player.position.y - cp.y, 2)
    );
    
    if (dist < (CAR_WIDTH / 2 + cp.radius)) {
      // Check if already hit this checkpoint
      const lastCheckpoint = player.checkpointsHit[player.checkpointsHit.length - 1];
      if (lastCheckpoint !== cp.type) {
        player.lastCheckpoint = cp.type;
      }
    }
  });
}

// UI Updates
function updateGameUI() {
  if (!localPlayer) return;
  
  // Speed
  document.getElementById('speedometer').textContent = `Speed: ${localPlayer.speed.toFixed(1)}`;
  
  // Lap counter
  const lapCount = localPlayer.lapCount + 1;
  const maxLaps = currentRaceType === 'laps' ? 3 : 1;
  document.getElementById('lapCounter').textContent = `Lap: ${lapCount}/${maxLaps}`;
  
  // Timer
  if (raceStartTime) {
    let elapsed = (Date.now() - raceStartTime) / 1000;
    if (raceTimeLimit) {
      elapsed = Math.max(0, raceTimeLimit / 1000 - elapsed);
      if (elapsed <= 0) {
        gameRunning = false;
        socket.emit('finishRace', currentRaceId);
      }
    }
    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    document.getElementById('timerDisplay').textContent = `Time: ${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  updatePlayersList();
}

function updatePlayersList() {
  const playersList = document.getElementById('playersList');
  let html = '';
  
  Object.values(gameState).forEach(player => {
    const finished = player.finished ? ' finished' : '';
    const status = player.finished ? `✓ ${(player.finishTime / 1000).toFixed(2)}s` : `Lap ${player.lapCount + 1}`;
    html += `<div class="player-item${finished}"><strong>${player.name}</strong>: ${status}</div>`;
  });
  
  playersList.innerHTML = html;
}

function addChatMessage(playerName, message) {
  const chatBox = document.getElementById('chatBox');
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message';
  msgEl.innerHTML = `<strong>${playerName}:</strong> ${message}`;
  chatBox.appendChild(msgEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Start with initial draw of empty track
ctx.fillStyle = 'rgba(135, 206, 235, 0.5)';
ctx.fillRect(0, 0, canvas.width, canvas.height);
drawTrack();
drawCheckpoints();
drawObstacles();

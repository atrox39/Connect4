const game = document.querySelector('#game');
const ctx = game.getContext('2d');

// WebSocket
let ws;
const SERVER_ADDRESS = 'ws://localhost:8080'; // Asegúrate de que coincida con tu server.js

let playerColor = null; // 'red' o 'black' (tu color asignado por el servidor)
let currentTurn = null; // 'red' o 'black' (el turno actual)
let gameId = null; // El ID de la partida actual

const playerColorDisplay = document.getElementById('player-color-display');
const currentTurnDisplay = document.getElementById('current-turn-display');
const gameIdDisplay = document.getElementById('game-id-display');
const statusMessage = document.getElementById('status-message');
const gameIdInput = document.getElementById('game-id-input');
const createGameBtn = document.getElementById('create-game-btn');
const joinGameBtn = document.getElementById('join-game-btn');
const chatArea = document.getElementById('chat-area');
const chatMessageInput = document.getElementById('chat-message-input');
const sendChatBtn = document.getElementById('send-chat-btn');

// --- GameEngine Class (Updated for Multiplayer) ---
class GameEngine {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.numColumns = 7;
    this.numRows = 6;
    this.regionXSize = this.width / this.numColumns;
    this.regionYSize = this.height / this.numRows;
    this.pieceRadius = 28;
    this.lastPieceColumn = -1;
    this.lastPieceRow = -1;
    this.board = this.createEmptyBoard(); // Board is now synchronized with server
    this.winMessage = '';
    this.gameOver = false;
    this.winner = null; // Winner is set by server
    this.allowMoves = false; // Control if current player can make a move
  }

  createEmptyBoard() {
    return Array(this.numRows).fill(0).map(() => Array(this.numColumns).fill(0));
  }

  // The win condition is now primarily handled by the server for security
  // However, it's good to keep a client-side version for immediate feedback
  // or if the game logic were to be fully client-authoritative (not recommended for multi)
  // getBoardValue(r, c) and checkSequence(..) are still useful for drawing.

  getBoardValue(r, c) {
    if (r < 0 || r >= this.numRows || c < 0 || c >= this.numColumns) {
      return -1;
    }
    return this.board[r][c];
  }

  checkSequence(startR, startC, deltaR, deltaC, playerValue) {
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const r = startR + i * deltaR;
      const c = startC + i * deltaC;
      if (this.getBoardValue(r, c) === playerValue) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  checkIfFull() {
    for (let i = 0; i < this.numColumns; i++) {
      if (this.board[0][i] === 0) {
        return false;
      }
    }
    return true;
  }

  // 'update' is mostly for drawing visual states in a multiplayer context
  update() {
    // Game logic is driven by server messages, not by client-side update loop
  }

  drawPiece(column, row, color) {
    let centerX = (column * this.regionXSize) + (this.regionXSize / 2);
    let centerY = (row * this.regionYSize) + (this.regionYSize / 2);

    if (color === 'white') {
      ctx.beginPath();
      ctx.arc(centerX, centerY, this.pieceRadius + 2, 0, 2 * Math.PI);
      ctx.fillStyle = '#315BD3';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(centerX, centerY, this.pieceRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  draw() {
    ctx.fillStyle = '#0082FC';
    ctx.fillRect(0, 0, this.width, this.height);

    for (let i = 0; i < this.numColumns; i++) {
      for (let j = 0; j < this.numRows; j++) {
        const piece = this.board[j][i];
        let color = '';
        if (piece === 1) {
          color = '#FC4136'; // Rojo
        } else if (piece === 2) {
          color = 'black'; // Negro
        } else {
          color = 'white'; // Vacío
        }
        this.drawPiece(i, j, color);
      }
    }
  }

  turnText() {
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (this.gameOver) {
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.winMessage, this.width / 2, this.height / 2);
      ctx.font = '20px Arial';
      ctx.fillText("¡Oponente desconectado! Recarga para jugar de nuevo.", this.width / 2, this.height / 2 + 50); // Mensaje de reinicio si el oponente se desconecta
    } else {
      playerColorDisplay.textContent = `Tu Color: ${playerColor ? playerColor.toUpperCase() : 'Desconocido'}`;
      currentTurnDisplay.textContent = `Turno: ${currentTurn ? currentTurn.toUpperCase() : 'Desconocido'}`;
      gameIdDisplay.textContent = `ID de Partida: ${gameId || 'N/A'}`;
    }
  }

  // This client-side addPiece will now only send the move to the server
  addPiece(column) {
    if (this.gameOver || !this.allowMoves || ws.readyState !== WebSocket.OPEN) {
      console.log('No puedes moverte ahora.');
      return;
    }

    // Check if the column is full on the client side (basic validation)
    let row = this.numRows - 1;
    while (row >= 0 && this.board[row][column] !== 0) {
      row--;
    }
    if (row < 0) {
      statusMessage.textContent = '¡Columna llena!';
      return;
    }
    statusMessage.textContent = 'Esperando al oponente...';
    this.allowMoves = false; // Deshabilitar movimientos hasta la respuesta del servidor

    // Send the move to the server
    ws.send(JSON.stringify({
      type: 'make_move',
      gameId: gameId,
      column: column
    }));
  }

  // Called when the board state is received from the server
  updateBoard(newBoard, lastMove, turn) {
    this.board = newBoard;
    this.lastPieceColumn = lastMove.column;
    this.lastPieceRow = lastMove.row;
    currentTurn = turn; // Update global turn variable

    if (currentTurn === playerColor) {
      this.allowMoves = true;
      statusMessage.textContent = '¡Es tu turno!';
    } else {
      this.allowMoves = false;
      statusMessage.textContent = 'Esperando al oponente...';
    }
  }

  setGameOver(winner, finalBoard) {
    this.gameOver = true;
    this.board = finalBoard; // Ensure final board state is drawn
    if (winner) {
      this.winner = winner;
      this.winMessage = `¡${winner.toUpperCase()} GANA!`;
    } else {
      this.winner = null;
      this.winMessage = '¡EMPATE!';
    }
    this.allowMoves = false; // No more moves allowed
    statusMessage.textContent = 'Juego Terminado.';
  }

  // Resetting game now involves reconnecting or getting new gameId from server
  resetGame() {
    // For multiplayer, simply reloading the page is often easiest for a full reset.
    // Or you could implement a 'new game' button that sends a message to server.
    // For now, we'll just reset client-side display but expect server to handle game state
    this.board = this.createEmptyBoard();
    this.lastPieceColumn = -1;
    this.lastPieceRow = -1;
    this.winMessage = '';
    this.gameOver = false;
    this.winner = null;
    playerColor = null;
    currentTurn = null;
    gameId = null;
    this.allowMoves = false;
    playerColorDisplay.textContent = 'Tu Color: Desconocido';
    currentTurnDisplay.textContent = 'Turno: Desconocido';
    gameIdDisplay.textContent = 'ID de Partida: N/A';
    statusMessage.textContent = 'Conectando al servidor...';
    connectWebSocket(); // Attempt to reconnect/start fresh
  }
}

const gameEngine = new GameEngine(game.width, game.height);

// --- WebSocket Connection and Message Handling ---
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(); // Close existing connection if any
  }
  ws = new WebSocket(SERVER_ADDRESS);

  ws.onopen = () => {
    statusMessage.textContent = 'Conectado al servidor.';
    console.log('Conexión WebSocket abierta.');
  };

  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    console.log('Mensaje del servidor:', data);

    switch (data.type) {
      case 'game_created':
        gameId = data.gameId;
        playerColor = data.playerColor;
        gameIdDisplay.textContent = `ID de Partida: ${gameId}`;
        playerColorDisplay.textContent = `Tu Color: ${playerColor.toUpperCase()}`;
        statusMessage.textContent = `Partida creada. Esperando otro jugador... Comparte el ID: ${gameId}`;
        break;
      case 'game_start':
        gameId = data.gameId;
        playerColor = data.playerColor;
        currentTurn = data.currentTurn;
        gameEngine.updateBoard(data.initialBoard, { row: -1, column: -1 }, data.currentTurn); // Initial board
        gameIdDisplay.textContent = `ID de Partida: ${gameId}`;
        playerColorDisplay.textContent = `Tu Color: ${playerColor.toUpperCase()}`;
        statusMessage.textContent = `Partida iniciada. ¡Es el turno de ${currentTurn.toUpperCase()}!`;
        if (currentTurn === playerColor) {
          gameEngine.allowMoves = true;
        } else {
          gameEngine.allowMoves = false;
        }
        break;
      case 'board_update':
        gameEngine.updateBoard(data.board, data.lastMove, data.currentTurn);
        break;
      case 'game_over':
        gameEngine.setGameOver(data.winner, data.board);
        break;
      case 'error':
        statusMessage.textContent = `Error: ${data.message}`;
        console.error('Error del servidor:', data.message);
        break;
      case 'opponent_disconnected':
        gameEngine.setGameOver(null, gameEngine.board); // Set game over for current player
        gameEngine.winMessage = data.message; // Display disconnection message
        statusMessage.textContent = data.message;
        console.log(data.message);
        break;
      case 'chat_message':
        const p = document.createElement('p');
        p.textContent = `[${data.sender.toUpperCase()}]: ${data.message}`;
        chatArea.appendChild(p);
        chatArea.scrollTop = chatArea.scrollHeight; // Scroll to bottom
        break;
    }
  };

  ws.onclose = () => {
    statusMessage.textContent = 'Desconectado del servidor. Recargando...';
    console.log('Conexión WebSocket cerrada.');
    // Puedes intentar reconectar automáticamente o pedir al usuario que recargue
    setTimeout(() => window.location.reload(), 2000); // Recarga la página después de 2 segundos
  };

  ws.onerror = error => {
    statusMessage.textContent = 'Error de conexión al servidor.';
    console.error('Error WebSocket:', error);
  };
}

// --- Event Listeners ---
game.addEventListener('click', (event) => {
  if (gameEngine.gameOver || !gameEngine.allowMoves) {
    console.log("Juego terminado o no es tu turno.");
    return;
  }
  const rect = game.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const clickedColumn = Math.floor(x / gameEngine.regionXSize);

  if (clickedColumn >= 0 && clickedColumn < gameEngine.numColumns) {
    gameEngine.addPiece(clickedColumn); // Envía el movimiento al servidor
  }
});

createGameBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'join_game' })); // Sin gameId para crear
    statusMessage.textContent = 'Creando partida...';
  } else {
    statusMessage.textContent = 'No conectado al servidor. Intenta de nuevo.';
  }
});

joinGameBtn.addEventListener('click', () => {
  const idToJoin = gameIdInput.value.trim();
  if (idToJoin && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'join_game', gameId: idToJoin }));
    statusMessage.textContent = `Intentando unirse a partida ${idToJoin}...`;
  } else {
    statusMessage.textContent = 'Por favor, ingresa un ID de partida válido o conecta al servidor.';
  }
});

sendChatBtn.addEventListener('click', () => {
  const message = chatMessageInput.value.trim();
  if (message && ws && ws.readyState === WebSocket.OPEN && gameId) {
    ws.send(JSON.stringify({ type: 'chat_message', message: message }));
    chatMessageInput.value = '';
  }
});
chatMessageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatBtn.click();
  }
});


// --- Game Loop ---
function loop() {
  window.requestAnimationFrame(loop);
  gameEngine.draw();
  gameEngine.turnText();
  // No necesitamos gameEngine.update() para la lógica de juego, solo para dibujar
}

// --- Start Connection and Loop ---
connectWebSocket();
loop();
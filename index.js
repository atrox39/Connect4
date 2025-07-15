// server.js
const express = require('express');
const http = require('http'); // Express usa el módulo http de Node.js
const WebSocket = require('ws');
const path = require('path'); // Para servir archivos estáticos

const app = express();
const server = http.createServer(app); // Crea un servidor HTTP con Express
const wss = new WebSocket.Server({ server }); // Atacha WebSocket al servidor HTTP existente

console.log('Iniciando servidor...');

// --- Configuración de Express para servir archivos estáticos ---
// Sirve los archivos de la carpeta actual (donde está server.js y index.html)
app.use(express.static(path.join(__dirname, '/public')));

// Ruta principal para servir tu index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Lógica del Servidor WebSocket (la misma que antes, pero ahora integrada) ---

const games = new Map(); // Mapa para almacenar partidas activas
// Cada entrada del mapa será: gameId -> { players: [ws1, ws2], board: [...], turn: 'red' }

wss.on('connection', ws => {
  console.log('Cliente conectado');

  // Asignar un ID único a cada conexión para identificar a los jugadores
  ws.id = Math.random().toString(36).substring(2, 15);
  ws.gameId = null; // ID de la partida a la que pertenece este jugador

  // Manejar mensajes del cliente
  ws.on('message', message => {
    // Asegúrate de que el mensaje sea un string antes de parsearlo
    let data;
    try {
      data = JSON.parse(message.toString()); // Convertir Buffer a string antes de parsear
    } catch (e) {
      console.error("Error al parsear mensaje JSON:", e);
      return;
    }

    switch (data.type) {
      case 'join_game':
        if (data.gameId && games.has(data.gameId)) {
          // Intentar unirse a una partida existente
          const game = games.get(data.gameId);
          if (game.players.length < 2) {
            game.players.push(ws);
            ws.gameId = data.gameId;
            ws.playerColor = 'black'; // Segundo jugador es negro
            console.log(`Jugador ${ws.id} se unió a la partida ${ws.gameId} como BLACK`);
            // Notificar a ambos jugadores que la partida ha iniciado
            game.players.forEach(player => {
              player.send(JSON.stringify({
                type: 'game_start',
                gameId: ws.gameId,
                playerColor: player.playerColor,
                initialBoard: game.board,
                currentTurn: game.turn // Quien empieza (red)
              }));
            });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'La partida está llena.' }));
          }
        } else {
          // Crear una nueva partida
          const newGameId = Math.random().toString(36).substring(2, 10);
          const initialBoard = Array(6).fill(0).map(() => Array(7).fill(0));
          const newGame = {
            players: [ws],
            board: initialBoard,
            turn: 'red', // Rojo siempre empieza
            lastPiece: { row: -1, col: -1 } // Para la lógica de victoria en el servidor
          };
          games.set(newGameId, newGame);
          ws.gameId = newGameId;
          ws.playerColor = 'red'; // Primer jugador es rojo
          console.log(`Jugador ${ws.id} creó la partida ${newGameId} como RED`);
          ws.send(JSON.stringify({
            type: 'game_created',
            gameId: newGameId,
            playerColor: ws.playerColor
          }));
        }
        break;

      case 'make_move':
        const game = games.get(ws.gameId);
        if (!game) {
          ws.send(JSON.stringify({ type: 'error', message: 'No estás en una partida.' }));
          return;
        }

        // Verificar turno del jugador
        if (ws.playerColor !== game.turn) {
          ws.send(JSON.stringify({ type: 'error', message: 'No es tu turno.' }));
          return;
        }

        const column = data.column;
        let row = -1; // La fila donde caerá la pieza

        // Lógica para añadir la pieza al tablero del servidor (similar a tu addPiece)
        for (let r = 5; r >= 0; r--) {
          if (game.board[r][column] === 0) {
            row = r;
            break;
          }
        }

        if (row === -1) {
          ws.send(JSON.stringify({ type: 'error', message: 'Columna llena.' }));
          return;
        }

        const pieceValue = game.turn === 'red' ? 1 : 2;
        game.board[row][column] = pieceValue;
        game.lastPiece = { row, col: column };

        // Verificar victoria en el servidor
        if (checkWinServer(game.board, row, column, pieceValue)) {
          const winnerColor = game.turn;
          game.players.forEach(player => {
            player.send(JSON.stringify({
              type: 'game_over',
              board: game.board,
              winner: winnerColor
            }));
          });
          console.log(`Partida ${game.gameId}: ${winnerColor} gana.`);
          games.delete(game.gameId); // Eliminar la partida
          return;
        }

        // Verificar empate en el servidor
        if (isBoardFullServer(game.board)) {
          game.players.forEach(player => {
            player.send(JSON.stringify({
              type: 'game_over',
              board: game.board,
              winner: null // Empate
            }));
          });
          console.log(`Partida ${game.gameId}: Empate.`);
          games.delete(game.gameId); // Eliminar la partida
          return;
        }

        // Cambiar el turno
        game.turn = game.turn === 'red' ? 'black' : 'red';

        // Enviar la actualización del tablero y el nuevo turno a ambos jugadores
        game.players.forEach(player => {
          player.send(JSON.stringify({
            type: 'board_update',
            board: game.board,
            lastMove: { row, column, color: ws.playerColor }, // Envía el color de la ficha colocada
            currentTurn: game.turn
          }));
        });
        break;

      case 'chat_message': // Ejemplo para chat básico
        const currentGame = games.get(ws.gameId);
        if (currentGame) {
          currentGame.players.forEach(player => {
            player.send(JSON.stringify({
              type: 'chat_message',
              sender: ws.playerColor, // O ws.id
              message: data.message
            }));
          });
        }
        break;
    }
  });

  // Manejar desconexiones
  ws.on('close', () => {
    console.log('Cliente desconectado:', ws.id);
    if (ws.gameId && games.has(ws.gameId)) {
      const game = games.get(ws.gameId);
      // Si el otro jugador estaba en la partida, notificarle que su oponente se fue
      game.players = game.players.filter(player => player.id !== ws.id);
      if (game.players.length > 0) {
        // Notificar al jugador restante solo si está conectado (readyState === 1 es OPEN)
        if (game.players[0].readyState === WebSocket.OPEN) {
          game.players[0].send(JSON.stringify({ type: 'opponent_disconnected', message: 'Tu oponente se ha desconectado. La partida ha terminado.' }));
        }
        games.delete(ws.gameId); // Eliminar la partida si un jugador se va
        console.log(`Partida ${ws.gameId} eliminada debido a desconexión.`);
      } else {
        games.delete(ws.gameId); // Si era el último jugador, solo eliminar
      }
    }
  });
});

// --- Funciones de Lógica de Juego en el Servidor (Copiadas y adaptadas de tu GameEngine) ---
// Es CRÍTICO que la lógica de victoria esté también en el servidor para evitar trampas.

function getBoardValueServer(board, r, c) {
  const numRows = 6;
  const numColumns = 7;
  if (r < 0 || r >= numRows || c < 0 || c >= numColumns) {
    return -1;
  }
  return board[r][c];
}

function checkSequenceServer(board, startR, startC, deltaR, deltaC, playerValue) {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const r = startR + i * deltaR;
    const c = startC + i * deltaC;
    if (getBoardValueServer(board, r, c) === playerValue) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function checkWinServer(board, lastPieceRow, lastPieceColumn, playerValue) {
  // Check Horizontal
  for (let cOffset = -3; cOffset <= 0; cOffset++) {
    if (checkSequenceServer(board, lastPieceRow, lastPieceColumn + cOffset, 0, 1, playerValue) >= 4) {
      return true;
    }
  }

  // Check Vertical
  for (let rOffset = -3; rOffset <= 0; rOffset++) {
    if (checkSequenceServer(board, lastPieceRow + rOffset, lastPieceColumn, 1, 0, playerValue) >= 4) {
      return true;
    }
  }

  // Check Diagonal (Top-Left to Bottom-Right)
  for (let offset = -3; offset <= 0; offset++) {
    if (checkSequenceServer(board, lastPieceRow + offset, lastPieceColumn + offset, 1, 1, playerValue) >= 4) {
      return true;
    }
  }

  // Check Diagonal (Top-Right to Bottom-Left)
  for (let offset = -3; offset <= 0; offset++) {
    if (checkSequenceServer(board, lastPieceRow + offset, lastPieceColumn - offset, 1, -1, playerValue) >= 4) {
      return true;
    }
  }

  return false;
}

function isBoardFullServer(board) {
  const numColumns = 7;
  for (let c = 0; c < numColumns; c++) {
    if (board[0][c] === 0) {
      return false;
    }
  }
  return true;
}

// --- Iniciar el servidor Express ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Servidor HTTP y WebSocket escuchando en http://localhost:${PORT}`);
  console.log(`Abre http://localhost:${PORT} en tu navegador para jugar.`);
});

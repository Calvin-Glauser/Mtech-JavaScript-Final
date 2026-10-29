import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const elements = {
  setupNotice: document.querySelector("#setupNotice"),
  connectionDot: document.querySelector("#connectionDot"),
  connectionText: document.querySelector("#connectionText"),
  playerName: document.querySelector("#playerName"),
  hostButton: document.querySelector("#hostButton"),
  joinButton: document.querySelector("#joinButton"),
  joinForm: document.querySelector("#joinForm"),
  lobbyCode: document.querySelector("#lobbyCode"),
  joinError: document.querySelector("#joinError"),
  homeError: document.querySelector("#homeError"),
  homeView: document.querySelector("#homeView"),
  lobbyView: document.querySelector("#lobbyView"),
  lobbyRole: document.querySelector("#lobbyRole"),
  lobbyTitle: document.querySelector("#lobbyTitle"),
  lobbySubtitle: document.querySelector("#lobbySubtitle"),
  roomCode: document.querySelector("#roomCode"),
  playerCount: document.querySelector("#playerCount"),
  playerList: document.querySelector("#playerList"),
  emptyPlayers: document.querySelector("#emptyPlayers"),
  statusHeading: document.querySelector("#statusHeading"),
  statusDescription: document.querySelector("#statusDescription"),
  readyButton: document.querySelector("#readyButton"),
  startButton: document.querySelector("#startButton"),
  leaveButton: document.querySelector("#leaveButton"),
  lobbyError: document.querySelector("#lobbyError"),
  copyCodeButton: document.querySelector("#copyCodeButton"),
};

const PLAYER_COLORS = [
  "#f4b183",
  "#9fd3c7",
  "#a9c5eb",
  "#e7a5a5",
  "#c5b3e6",
  "#d9c27e",
  "#8fc7e8",
  "#c2d98c",
];

let database;
let user;
let activeCode = null;
let isHost = false;
let activeLobby = null;
let stopLobbyListener = null;
let redirectingToGame = false;

function assignPlayerColor(players = {}) {
  const assignedColors = new Set(
    Object.values(players).map((player) => player.color).filter(Boolean),
  );
  return (
    PLAYER_COLORS.find((color) => !assignedColors.has(color)) ||
    PLAYER_COLORS[Object.keys(players).length % PLAYER_COLORS.length]
  );
}

function setConnection(connected, label) {
  elements.connectionText.textContent = label;
  elements.connectionDot.className = connected ? "connected" : "disconnected";
}

function setHomeError(message) {
  elements.homeError.textContent = message;
}

function displayError(error, fallback) {
  console.error(error);
  if (error?.code === "auth/admin-restricted-operation") {
    return "Anonymous sign-in is disabled for the mtech-game Firebase project. Enable it in Authentication > Sign-in method.";
  }
  return error?.code === "PERMISSION_DENIED"
    ? "Firebase blocked this action. Check that Anonymous sign-in and the Realtime Database rules are enabled."
    : fallback;
}

function getPlayerName() {
  const name = elements.playerName.value.trim();
  if (!name) {
    elements.playerName.focus();
    setHomeError("Add your name before entering a lobby.");
    return null;
  }
  return name.slice(0, 24);
}

function showLobby(code, host) {
  activeCode = code;
  isHost = host;
  elements.homeView.classList.add("hidden");
  elements.lobbyView.classList.remove("hidden");
  elements.lobbyRole.textContent = host ? "You are hosting" : "You joined";
  elements.lobbySubtitle.textContent = host
    ? "Share this code so your players can join."
    : "You made it in. Let the host know when you are ready.";
  elements.roomCode.textContent = code;
  elements.lobbyError.textContent = "";
  subscribeToLobby(code);
}

function subscribeToLobby(code) {
  if (stopLobbyListener) stopLobbyListener();
  stopLobbyListener = onValue(
    ref(database, `lobbies/${code}`),
    async (snapshot) => {
      activeLobby = snapshot.val();
      if (!activeLobby) {
        resetToHome("This lobby has been closed.");
        return;
      }
      if (
        activeLobby.game &&
        !window.location.pathname.endsWith("/genorator.html") &&
        !redirectingToGame
      ) {
        redirectingToGame = true;
        try {
          const disconnectRef = isHost
            ? ref(database, `lobbies/${code}`)
            : ref(database, `lobbies/${code}/players/${user.uid}`);
          await onDisconnect(disconnectRef).cancel();
          window.location.href = gameUrl(code);
        } catch (error) {
          redirectingToGame = false;
          elements.lobbyError.textContent = displayError(
            error,
            "Could not open the game.",
          );
        }
        return;
      }
      renderLobby();
    },
    (error) => {
      elements.lobbyError.textContent = displayError(
        error,
        "Could not load this lobby.",
      );
    },
  );
}

function renderLobby() {
  const players = Object.entries(activeLobby?.players || {}).sort(
    ([firstId, first], [secondId, second]) => {
      if (firstId === activeLobby.hostId) return -1;
      if (secondId === activeLobby.hostId) return 1;
      return (first.name || "").localeCompare(second.name || "");
    },
  );

  elements.lobbyTitle.textContent = isHost
    ? "Your lobby"
    : "You’re in the lobby";
  elements.playerCount.textContent = players.length;
  elements.playerList.replaceChildren();
  elements.emptyPlayers.classList.toggle("hidden", players.length > 0);

  for (const [playerId, player] of players) {
    const item = document.createElement("li");
    item.className = "player-row";
    const identity = document.createElement("div");
    identity.className = "player-identity";
    const name = document.createElement("span");
    name.textContent = player.name || "Player";
    identity.append(name);

    const badges = document.createElement("div");
    badges.className = "player-badges";
    if (playerId === activeLobby.hostId) {
      const hostBadge = document.createElement("span");
      hostBadge.className = "badge";
      hostBadge.textContent = "Host";
      badges.append(hostBadge);
    }
    if (player.ready) {
      const readyBadge = document.createElement("span");
      readyBadge.className = "badge";
      readyBadge.textContent = "Ready";
      badges.append(readyBadge);
    } else if (playerId !== user.uid) {
      const waitingBadge = document.createElement("span");
      waitingBadge.className = "badge";
      waitingBadge.textContent = "Waiting";
      badges.append(waitingBadge);
    }
    item.append(identity, badges);
    elements.playerList.append(item);
  }

  const myPlayer = activeLobby.players?.[user.uid];
  document.body.style.backgroundColor = myPlayer?.color || "";
  document.body.style.setProperty("--player-color", myPlayer?.color || "#657a65");
  const ready = Boolean(myPlayer?.ready);
  const playersReady =
    players.length >= 2 && players.every(([, player]) => player.ready);
  elements.startButton.classList.toggle("hidden", !isHost);
  elements.startButton.disabled = !playersReady;
  elements.startButton.title =
    players.length < 2
      ? "At least two players are needed."
      : playersReady
        ? ""
        : "Everyone must be ready first.";
  elements.statusHeading.textContent = ready
    ? "You’re ready"
    : "Ready when you are";
  elements.statusDescription.textContent = ready
    ? "The host can see you are set to play."
    : "Let the host know you are set to play.";
  elements.readyButton.textContent = ready ? "Cancel ready" : "I'm ready";
  elements.readyButton.setAttribute("aria-pressed", String(ready));
}

function gameUrl(code) {
  return `genorator.html?lobby=${encodeURIComponent(code)}`;
}

async function startGame() {
  if (!activeCode || !isHost || !activeLobby) return;
  const players = Object.entries(activeLobby.players || {}).sort(
    ([firstId, first], [secondId, second]) => {
      if (firstId === activeLobby.hostId) return -1;
      if (secondId === activeLobby.hostId) return 1;
      return (first.name || "").localeCompare(second.name || "");
    },
  );
  if (players.length < 2 || players.some(([, player]) => !player.ready)) return;
  const scores = Object.fromEntries(players.map(([playerId]) => [playerId, 0]));
  try {
    await set(ref(database, `lobbies/${activeCode}/game`), {
      phase: "pick",
      round: 1,
      pickerId: players[Math.floor(Math.random() * players.length)][0],
      scores,
      matchId: String(Date.now()),
      updatedAt: Date.now(),
    });
  } catch (error) {
    elements.lobbyError.textContent = displayError(
      error,
      "Could not start the game.",
    );
  }
}

async function createLobby() {
  const name = getPlayerName();
  if (!name || !database) return;
  setHomeError("");
  elements.hostButton.disabled = true;
  try {
    let code;
    let committed = false;
    for (let attempt = 0; attempt < 8 && !committed; attempt += 1) {
      code = String(Math.floor(1000 + Math.random() * 9000));
      const roomRef = ref(database, `lobbies/${code}`);
      const result = await runTransaction(roomRef, (current) =>
        current === null
          ? {
              hostId: user.uid,
              createdAt: Date.now(),
              players: {
                [user.uid]: {
                  name,
                  color: assignPlayerColor(),
                  ready: false,
                  joinedAt: Date.now(),
                },
              },
            }
          : undefined,
      );
      committed = result.committed;
    }
    if (!committed)
      throw new Error(
        "Could not find an available lobby code. Please try again.",
      );
    await onDisconnect(ref(database, `lobbies/${code}`)).remove();
    showLobby(code, true);
  } catch (error) {
    setHomeError(
      displayError(error, error.message || "Could not create a lobby."),
    );
  } finally {
    elements.hostButton.disabled = false;
  }
}
async function joinLobby(event) {
  event.preventDefault();
  const name = getPlayerName();
  const code = elements.lobbyCode.value.trim();
  elements.joinError.textContent = "";
  if (!name) return;
  if (!/^\d{4}$/.test(code)) {
    elements.joinError.textContent = "Enter a four-digit lobby code.";
    return;
  }
  elements.joinButton.disabled = true;
  try {
    const roomRef = ref(database, `lobbies/${code}`);
    const snapshot = await new Promise((resolve, reject) =>
      onValue(roomRef, resolve, reject, { onlyOnce: true }),
    );
    const room = snapshot.val();
    if (!room) {
      elements.joinError.textContent =
        "No lobby found with that code. Check it and try again.";
      return;
    }
    if (room.game) {
      elements.joinError.textContent = "That game has already started.";
      return;
    }
    await set(ref(database, `lobbies/${code}/players/${user.uid}`), {
      name,
      color: assignPlayerColor(room.players || {}),
      ready: false,
      joinedAt: Date.now(),
    });
    await onDisconnect(
      ref(database, `lobbies/${code}/players/${user.uid}`),
    ).remove();
    showLobby(code, false);
  } catch (error) {
    elements.joinError.textContent = displayError(
      error,
      "Could not join that lobby. Try again.",
    );
  } finally {
    elements.joinButton.disabled = false;
  }
}

async function toggleReady() {
  if (!activeCode || !activeLobby?.players?.[user.uid]) return;
  const nextReady = !activeLobby.players[user.uid].ready;
  elements.readyButton.disabled = true;
  try {
    await update(ref(database, `lobbies/${activeCode}/players/${user.uid}`), {
      ready: nextReady,
    });
  } catch (error) {
    elements.lobbyError.textContent = displayError(
      error,
      "Could not update your ready status.",
    );
  } finally {
    elements.readyButton.disabled = false;
  }
}

async function leaveLobby() {
  if (!activeCode) return;
  const code = activeCode;
  elements.leaveButton.disabled = true;
  try {
    if (stopLobbyListener) stopLobbyListener();
    await onDisconnect(ref(database, `lobbies/${code}`)).cancel();
    if (isHost) {
      await remove(ref(database, `lobbies/${code}`));
    } else {
      const playerRef = ref(database, `lobbies/${code}/players/${user.uid}`);
      await onDisconnect(playerRef).cancel();
      await remove(playerRef);
    }
    resetToHome(isHost ? "Lobby closed." : "You left the lobby.");
  } catch (error) {
    elements.lobbyError.textContent = displayError(
      error,
      "Could not leave the lobby.",
    );
  } finally {
    elements.leaveButton.disabled = false;
  }
}

function resetToHome(message = "") {
  if (stopLobbyListener) stopLobbyListener();
  stopLobbyListener = null;
  activeCode = null;
  activeLobby = null;
  document.body.style.backgroundColor = "";
  document.body.style.setProperty("--player-color", "#657a65");
  elements.lobbyView.classList.add("hidden");
  elements.homeView.classList.remove("hidden");
  elements.lobbyCode.value = "";
  elements.joinError.textContent = "";
  elements.lobbyError.textContent = "";
  setHomeError(message);
}

elements.hostButton.addEventListener("click", createLobby);
elements.joinForm.addEventListener("submit", joinLobby);
elements.lobbyCode.addEventListener("input", () => {
  elements.lobbyCode.value = elements.lobbyCode.value
    .replace(/\D/g, "")
    .slice(0, 4);
});
elements.readyButton.addEventListener("click", toggleReady);
elements.startButton.addEventListener("click", startGame);
elements.leaveButton.addEventListener("click", leaveLobby);
elements.copyCodeButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(activeCode);
    elements.copyCodeButton.title = "Copied";
    setTimeout(() => {
      elements.copyCodeButton.title = "Copy lobby code";
    }, 1400);
  } catch {
    elements.lobbyError.textContent =
      "Could not copy the code. Select it to copy manually.";
  }
});

try {
  const response = await fetch("/__/firebase/init.json");
  if (!response.ok)
    throw new Error(
      "Firebase Hosting could not provide this site's Firebase config.",
    );
  const firebaseConfig = await response.json();
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error("Firebase Hosting config is missing the web app settings.");
  }
  if (
    !firebaseConfig.databaseURL &&
    firebaseConfig.projectId === "mtech-game"
  ) {
    firebaseConfig.databaseURL =
      "https://mtech-game-default-rtdb.firebaseio.com";
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  database = getDatabase(app);
  const credential = await signInAnonymously(auth);
  user = credential.user;
  elements.hostButton.disabled = false;
  elements.joinButton.disabled = false;
  setConnection(true, "Signed in");
} catch (error) {
  setConnection(false, "Connection error");
  elements.setupNotice.classList.remove("hidden");
  elements.setupNotice.querySelector("p:last-child").textContent = displayError(
    error,
    error.message ||
      "Firebase could not connect. Check Anonymous sign-in and Realtime Database setup.",
  );
}

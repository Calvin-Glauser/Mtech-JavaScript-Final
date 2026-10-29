import { searchGIFs } from "./API.js";
import { createCaptionedGif, downloadGif } from "./GifExport.js";
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
  set,
  update,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js";

const lobbyCode = new URLSearchParams(window.location.search).get("lobby");
if (!lobbyCode) {
  document.querySelector("#gameView").classList.add("hidden");
} else {
  const elements = {
    gameView: document.querySelector("#gameView"),
    heading: document.querySelector("#gameHeading"),
    role: document.querySelector("#gameRole"),
    message: document.querySelector("#gameMessage"),
    score: document.querySelector("#gameScore"),
    lastRound: document.querySelector("#lastRound"),
    gallery: document.querySelector("#gameGallery"),
    galleryItems: document.querySelector("#gameGalleryItems"),
    candidates: document.querySelector("#gameCandidates"),
    rematch: document.querySelector("#rematchButton"),
    leave: document.querySelector("#gameLeaveButton"),
    error: document.querySelector("#gameError"),
    search: document.querySelector("#searchInput"),
    searchButton: document.querySelector("#searchButton"),
    results: document.querySelector("#results"),
    preview: document.querySelector("#memePreview"),
    gif: document.querySelector("#gifPreview"),
    captionBar: document.querySelector("#captionBar"),
    caption: document.querySelector("#topText"),
    submitCaption: document.querySelector("#applyTextBtn"),
    download: document.querySelector("#downloadBtn"),
    generatorStatus: document.querySelector("#status"),
  };
  const generatorElements = [
    elements.search,
    elements.searchButton,
    elements.results,
    elements.preview,
    elements.caption,
    elements.submitCaption,
    elements.download,
    elements.generatorStatus,
  ];
  const playerColors = [
    "#f4b183",
    "#9fd3c7",
    "#a9c5eb",
    "#e7a5a5",
    "#c5b3e6",
    "#d9c27e",
    "#8fc7e8",
    "#c2d98c",
  ];
  for (const element of generatorElements) element.classList.add("hidden");
  elements.gameView.classList.remove("hidden");
  elements.message.textContent = "Connecting to the lobby...";
  let database;
  let user;
  let lobby;
  let game;
  let phaseTimer;
  let phaseTimerKey = "";
  let pickListener;
  let pickListenerKey = "";
  let renderedPhaseKey = "";
  let alreadySubmitted = false;
  let rematchStarting = false;
  let presentationStartingKey = "";
  let finishingRoundKey = "";
  let disconnectCleanupRegistered = false;
  let searchSequence = 0;

  function setVisible(element, visible) {
    element.classList.toggle("hidden", !visible);
  }

  function playerEntries() {
    return Object.entries(lobby?.players || {}).sort(
      ([firstId, first], [secondId, second]) => {
        if (firstId === lobby?.hostId) return -1;
        if (secondId === lobby?.hostId) return 1;
        return (first.name || "").localeCompare(second.name || "");
      },
    );
  }

  function playerName(playerId) {
    return lobby?.players?.[playerId]?.name || "Player";
  }

  function playerColor(playerId) {
    const player = lobby?.players?.[playerId];
    if (player?.color) return player.color;

    const usedColors = new Set(
      Object.values(lobby?.players || {})
        .map((entry) => entry.color)
        .filter(Boolean),
    );
    const availableColors = playerColors.filter(
      (color) => !usedColors.has(color),
    );
    const unassignedPlayers = playerEntries().filter(
      ([, entry]) => !entry.color,
    );
    const colorIndex = Math.max(
      0,
      unassignedPlayers.findIndex(([entryId]) => entryId === playerId),
    );
    return (
      availableColors[colorIndex % availableColors.length] ||
      playerColors[colorIndex % playerColors.length]
    );
  }

  function ownsPhase(phase) {
    return game?.phase === phase;
  }

  function hideGeneratorControls() {
    for (const element of generatorElements) setVisible(element, false);
  }

  function showPlayerScores() {
    elements.score.textContent = playerEntries()
      .map(
        ([playerId, player]) =>
          `${player.name || "Player"}: ${game?.scores?.[playerId] || 0}`,
      )
      .join(" | ");
  }

  function renderLastRound() {
    const summary = game?.lastRound;
    if (!summary) {
      elements.lastRound.textContent = "";
      return;
    }
    const winners = (summary.winnerIds || []).map(playerName).join(", ");
    elements.lastRound.textContent = winners
      ? `Round ${summary.round}: ${winners} scored a point.`
      : `Round ${summary.round}: no points scored.`;
  }

  function renderGameGallery() {
    elements.galleryItems.replaceChildren();
    const rounds = Object.entries(lobby.rounds?.[game.matchId] || {}).sort(
      ([firstRound], [secondRound]) => Number(firstRound) - Number(secondRound),
    );
    const artworks = rounds.flatMap(([roundNumber, roundData]) => {
      const gif = Object.values(roundData.pick || {})[0];
      if (!gif) return [];

      return Object.entries(roundData.submissions || {}).map(
        ([playerId, submission]) => ({
          roundNumber,
          playerId,
          caption: submission.caption || "",
          gif,
        }),
      );
    });

    if (!artworks.length) {
      const emptyState = document.createElement("p");
      emptyState.textContent = "No submitted captions are available to download.";
      elements.galleryItems.append(emptyState);
      return;
    }

    for (const artwork of artworks) {
      const card = document.createElement("article");
      card.className = "game-artwork";

      const heading = document.createElement("h3");
      heading.textContent = `Round ${artwork.roundNumber}: ${playerName(artwork.playerId)}`;

      const image = document.createElement("img");
      image.src = artwork.gif.preview || artwork.gif.original;
      image.alt = `Round ${artwork.roundNumber} GIF caption by ${playerName(artwork.playerId)}`;

      const caption = document.createElement("p");
      caption.className = "game-artwork-caption";
      caption.textContent = artwork.caption || "(No caption)";

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "Download GIF";

      const downloadStatus = document.createElement("p");
      downloadStatus.className = "game-artwork-status";
      downloadStatus.setAttribute("role", "status");

      downloadButton.addEventListener("click", async () => {
        downloadButton.disabled = true;
        downloadButton.textContent = "Generating GIF...";
        downloadStatus.textContent = "Preparing your download.";
        try {
          const blob = await createCaptionedGif(
            artwork.gif.original || artwork.gif.preview,
            artwork.caption,
          );
          const safePlayerName = playerName(artwork.playerId)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          downloadGif(
            blob,
            `${safePlayerName || "player"}-round-${artwork.roundNumber}.gif`,
          );
          downloadStatus.textContent = "Download started.";
        } catch (error) {
          downloadStatus.textContent = `Download failed: ${error.message}`;
        } finally {
          downloadButton.disabled = false;
          downloadButton.textContent = "Download GIF";
        }
      });

      card.append(heading, image, caption, downloadButton, downloadStatus);
      elements.galleryItems.append(card);
    }
  }

  function syncPickListener() {
    const key =
      game?.phase === "pick" && user.uid === lobby?.hostId
        ? `${game.matchId}/${game.round}/${game.pickerId}`
        : "";
    if (key === pickListenerKey) return;
    if (pickListener) pickListener();
    pickListener = null;
    pickListenerKey = key;
    if (!key) return;

    const [matchId, round, pickerId] = key.split("/");
    pickListener = onValue(
      ref(
        database,
        `lobbies/${lobbyCode}/rounds/${matchId}/${round}/pick/${pickerId}`,
      ),
      async (snapshot) => {
        const pickedGIF = snapshot.val();
        if (
          !pickedGIF ||
          game?.phase !== "pick" ||
          game.matchId !== matchId ||
          String(game.round) !== round
        )
          return;
        try {
          await update(ref(database, `lobbies/${lobbyCode}/game`), {
            phase: "caption",
            gif: pickedGIF,
            deadline: Date.now() + 15000,
            updatedAt: Date.now(),
          });
        } catch (error) {
          elements.error.textContent = `Could not start the caption timer: ${error.message}`;
        }
      },
    );
  }

  function scheduleHostTransition() {
    const key = game?.deadline
      ? `${game.phase}/${game.round}/${game.deadline}`
      : "";
    if (key === phaseTimerKey) return;
    if (phaseTimer) clearTimeout(phaseTimer);
    phaseTimer = null;
    phaseTimerKey = key;
    if (
      user.uid !== lobby?.hostId ||
      !game?.deadline ||
      !["caption", "present"].includes(game.phase)
    )
      return;

    phaseTimer = setTimeout(
      () => {
        if (game.phase === "caption") {
          beginPresentations().catch((error) => {
            elements.error.textContent = `Could not begin presentations: ${error.message}`;
          });
        } else if (game.phase === "present") {
          const lastIndex = (game.presentIds || []).length - 1;
          if (game.presentIndex < lastIndex) {
            update(ref(database, `lobbies/${lobbyCode}/game`), {
              presentIndex: game.presentIndex + 1,
              deadline: Date.now() + 5000,
              updatedAt: Date.now(),
            }).catch((error) => {
              elements.error.textContent = error.message;
            });
          } else {
            update(ref(database, `lobbies/${lobbyCode}/game`), {
              phase: "judge",
              updatedAt: Date.now(),
            }).catch((error) => {
              elements.error.textContent = error.message;
            });
          }
        }
      },
      Math.max(0, game.deadline - Date.now()),
    );
  }

  async function beginPresentations() {
    if (user.uid !== lobby?.hostId || game?.phase !== "caption") return;
    const roundKey = `${game.matchId}/${game.round}`;
    if (presentationStartingKey === roundKey) return;
    presentationStartingKey = roundKey;

    const roundRef = ref(
      database,
      `lobbies/${lobbyCode}/rounds/${game.matchId}/${game.round}`,
    );
    try {
      const snapshot = await new Promise((resolve, reject) =>
        onValue(roundRef, resolve, reject, { onlyOnce: true }),
      );
      if (game?.phase !== "caption" || `${game.matchId}/${game.round}` !== roundKey)
        return;

      const submissions = snapshot.val()?.submissions || {};
      const presentIds = Object.keys(submissions).filter(
        (playerId) => playerId !== game.pickerId,
      );
      if (!presentIds.length) {
        await finishRound(null);
        return;
      }
      await update(ref(database, `lobbies/${lobbyCode}/game`), {
        phase: "present",
        presentIds,
        presentIndex: 0,
        deadline: Date.now() + 5000,
        updatedAt: Date.now(),
      });
    } catch (error) {
      presentationStartingKey = "";
      throw error;
    }
  }

  function advanceWhenAllCaptionsSubmitted() {
    if (user.uid !== lobby?.hostId || game?.phase !== "caption") return;

    const contributors = playerEntries().filter(
      ([playerId]) => playerId !== game.pickerId,
    );
    if (!contributors.length) return;

    const submissions =
      lobby.rounds?.[game.matchId]?.[game.round]?.submissions || {};
    if (contributors.every(([playerId]) => submissions[playerId])) {
      beginPresentations().catch((error) => {
        elements.error.textContent = `Could not begin presentations: ${error.message}`;
      });
    }
  }

  async function finishRound(winnerId) {
    const currentGame = game;
    if (!currentGame || (currentGame.phase !== "judge" && winnerId !== null))
      return;
    if (user.uid !== lobby.hostId) return;
    const roundKey = `${currentGame.matchId}/${currentGame.round}`;
    if (finishingRoundKey === roundKey) return;
    finishingRoundKey = roundKey;
    const winnerIds = winnerId && lobby.players?.[winnerId] ? [winnerId] : [];
    const scores = { ...(currentGame.scores || {}) };
    for (const playerId of winnerIds)
      scores[playerId] = (scores[playerId] || 0) + 1;
    const matchWinners = winnerIds.filter((playerId) => scores[playerId] >= 2);
    const players = playerEntries().map(([playerId]) => playerId);
    const nextPickerId = players[Math.floor(Math.random() * players.length)];
    const updateData = {
      scores,
      lastRound: { round: currentGame.round, winnerIds },
      updatedAt: Date.now(),
    };

    if (matchWinners.length) {
      updateData.phase = "finished";
      updateData.winnerIds = matchWinners;
      delete updateData.deadline;
    } else {
      updateData.phase = "pick";
      updateData.round = currentGame.round + 1;
      updateData.pickerId = nextPickerId;
      delete updateData.deadline;
      delete updateData.gif;
      delete updateData.presentIds;
      delete updateData.presentIndex;
    }
    try {
      await update(ref(database, `lobbies/${lobbyCode}/game`), updateData);
    } catch (error) {
      finishingRoundKey = "";
      throw error;
    }
  }

  function updateCountdown() {
    if (!game?.deadline || !["caption", "present"].includes(game.phase)) return;
    const remaining = Math.max(
      0,
      Math.ceil((game.deadline - Date.now()) / 1000),
    );
    if (game.phase === "caption") {
      elements.message.textContent = `Add your caption. ${remaining} seconds left.`;
    } else {
      const playerId = game.presentIds?.[game.presentIndex];
      elements.message.textContent = `${playerName(playerId)}'s caption. ${remaining} seconds.`;
    }
  }

  function showJudgeOptions() {
    elements.candidates.replaceChildren();
    if (user.uid !== game.pickerId) return;
    const submissions =
      lobby?.rounds?.[game.matchId]?.[game.round]?.submissions || {};
    for (const [playerId, submission] of Object.entries(submissions)) {
      const item = document.createElement("div");
      const caption = document.createElement("p");
      caption.textContent = `${playerName(playerId)}: ${submission.caption || "(no caption)"}`;
      item.append(caption);
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = `Choose ${playerName(playerId)}`;
      option.addEventListener("click", async () => {
        option.disabled = true;
        elements.message.textContent = "Submitting your decision...";
        const votePath = `lobbies/${lobbyCode}/rounds/${game.matchId}/${game.round}/votes/${user.uid}`;
        try {
          await set(ref(database, votePath), playerId);
        } catch (error) {
          elements.error.textContent = `Could not submit your decision: ${error.message}`;
          option.disabled = false;
        }
      });
      item.append(option);
      elements.candidates.append(item);
    }
  }

  function showPickedGIF(caption = "") {
    const gif = game.gif || {};
    elements.captionBar.textContent = caption || elements.caption.value;
    elements.gif.alt = "Selected GIF";
    elements.gif.onerror = () => {
      if (gif.original && elements.gif.src !== gif.original) {
        elements.gif.src = gif.original;
      } else {
        elements.gif.alt = "GIF could not be loaded";
        elements.error.textContent =
          "This GIF did not load. The picker can select another GIF next round.";
      }
    };
    elements.gif.src = gif.preview || gif.original || "";
  }

  function render() {
    if (!lobby || !game) return;
    hideGeneratorControls();
    document.documentElement.classList.remove("game-mode");
    setVisible(elements.gameView, true);
    elements.error.textContent = "";
    elements.heading.textContent = `Round ${game.round || 1}`;
    const isPicker = user.uid === game.pickerId;
    const presentingPlayerId =
      game.phase === "present"
        ? game.presentIds?.[game.presentIndex]
        : null;
    const activeColor = playerColor(presentingPlayerId || user.uid);
    document.body.style.backgroundColor = activeColor;
    document.body.style.setProperty("--player-color", activeColor);
    elements.role.textContent = "Role: Judge";
    setVisible(elements.role, isPicker);
    setVisible(elements.score, game.phase === "finished");
    setVisible(elements.lastRound, game.phase === "finished");
    setVisible(elements.gallery, game.phase === "finished");
    if (game.phase === "finished") showPlayerScores();
    if (game.phase === "finished") renderGameGallery();
    renderLastRound();
    setVisible(elements.rematch, game.phase === "finished");
    setVisible(elements.leave, game.phase === "finished");
    elements.leave.textContent = "Return to main menu";
    elements.candidates.replaceChildren();

    const phaseKey = `${game.phase}/${game.round}/${game.presentIndex ?? ""}`;
    if (renderedPhaseKey !== phaseKey) {
      alreadySubmitted = false;
      elements.caption.value = "";
      renderedPhaseKey = phaseKey;
    }

    setVisible(elements.preview, false);
    setVisible(elements.caption, false);
    setVisible(elements.submitCaption, false);
    setVisible(elements.search, false);
    setVisible(elements.searchButton, false);
    setVisible(elements.results, false);

    if (game.phase === "pick") {
      elements.message.textContent = isPicker
        ? "Search for a GIF and select it."
        : `Waiting for ${playerName(game.pickerId)} to pick a GIF.`;
      setVisible(elements.search, isPicker);
      setVisible(elements.searchButton, isPicker);
      setVisible(elements.results, isPicker);
      elements.searchButton.disabled = false;
    } else if (game.phase === "caption") {
      showPickedGIF();
      setVisible(elements.preview, true);
      const hasSubmitted = Boolean(
        lobby.rounds?.[game.matchId]?.[game.round]?.submissions?.[user.uid],
      );
      const canCaption = !isPicker && !hasSubmitted;
      setVisible(elements.caption, canCaption);
      setVisible(elements.submitCaption, canCaption);
      elements.submitCaption.textContent = "Submit caption";
      elements.submitCaption.disabled = alreadySubmitted || !canCaption;
      elements.message.textContent = isPicker
        ? "You picked the GIF. The other players are writing captions."
        : canCaption
          ? ""
          : "Your caption is in. Waiting for presentations.";
      updateCountdown();
    } else if (game.phase === "present") {
      const playerId = game.presentIds?.[game.presentIndex];
      const submission =
        lobby.rounds?.[game.matchId]?.[game.round]?.submissions?.[playerId];
      showPickedGIF(submission?.caption || "");
      setVisible(elements.preview, true);
      elements.message.textContent = `${playerName(playerId)}'s caption.`;
      updateCountdown();
    } else if (game.phase === "judge") {
      elements.message.textContent = isPicker
        ? "Choose the caption that won."
        : `Waiting for ${playerName(game.pickerId)} to choose the winner.`;
      if (isPicker) showJudgeOptions();
    } else if (game.phase === "finished") {
      const winners = (game.winnerIds || []).map(playerName).join(", ");
      elements.message.textContent = `${winners} ${game.winnerIds?.length === 1 ? "wins" : "win"} the game! First to 2 points.`;
      elements.rematch.textContent =
        lobby.rematch?.[user.uid] === game.matchId
          ? "Waiting for everyone..."
          : "Play again";
      elements.rematch.disabled = lobby.rematch?.[user.uid] === game.matchId;
    } else {
      elements.message.textContent = "Waiting for the host to start the game.";
    }

    syncPickListener();
    scheduleHostTransition();
  }

  async function searchAndShowGIFs() {
    const query = elements.search.value.trim();
    if (!query) return;
    const sequence = ++searchSequence;
    elements.message.textContent = "Searching...";
    elements.results.replaceChildren();
    elements.searchButton.disabled = true;
    try {
      const gifs = await searchGIFs(query);
      if (
        sequence !== searchSequence ||
        game?.phase !== "pick" ||
        user.uid !== game.pickerId
      )
        return;
      if (!gifs.length) {
        elements.message.textContent = "No GIFs found. Try another search.";
        return;
      }
      for (const gif of gifs) {
        const image = document.createElement("img");
        image.src = gif.preview || gif.original;
        image.alt = "GIF result";
        image.tabIndex = 0;
        image.onerror = () => {
          if (gif.original && image.src !== gif.original)
            image.src = gif.original;
          else image.alt = "GIF could not be loaded";
        };
        const selectGIF = async () => {
          if (game?.phase !== "pick" || user.uid !== game.pickerId) return;
          elements.searchButton.disabled = true;
          elements.message.textContent =
            "GIF selected. Starting the caption round...";
          try {
            await set(
              ref(
                database,
                `lobbies/${lobbyCode}/rounds/${game.matchId}/${game.round}/pick/${user.uid}`,
              ),
              gif,
            );
          } catch (error) {
            elements.error.textContent = `Could not select that GIF: ${error.message}`;
            elements.searchButton.disabled = false;
          }
        };
        image.addEventListener("click", selectGIF);
        image.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") selectGIF();
        });
        elements.results.append(image);
      }
      elements.message.textContent = `${gifs.length} GIFs found. Select one.`;
    } catch (error) {
      elements.message.textContent = `GIF search failed: ${error.message}`;
    } finally {
      if (game?.phase === "pick") elements.searchButton.disabled = false;
    }
  }

  async function submitCaption() {
    if (
      game?.phase !== "caption" ||
      user.uid === game.pickerId ||
      alreadySubmitted
    )
      return;
    const caption = elements.caption.value.trim().slice(0, 120);
    if (!caption) {
      elements.error.textContent = "Enter a caption first.";
      return;
    }
    elements.submitCaption.disabled = true;
    try {
      await set(
        ref(
          database,
          `lobbies/${lobbyCode}/rounds/${game.matchId}/${game.round}/submissions/${user.uid}`,
        ),
        {
          caption,
          submittedAt: Date.now(),
        },
      );
      alreadySubmitted = true;
      elements.message.textContent =
        "Caption submitted. Waiting for presentations.";
    } catch (error) {
      elements.error.textContent = `Could not submit your caption: ${error.message}`;
      elements.submitCaption.disabled = false;
    }
  }

  async function playAgain() {
    if (game?.phase !== "finished") return;
    try {
      await set(
        ref(database, `lobbies/${lobbyCode}/rematch/${user.uid}`),
        game.matchId,
      );
      elements.rematch.disabled = true;
      elements.rematch.textContent = "Waiting for everyone...";
    } catch (error) {
      elements.error.textContent = `Could not request a rematch: ${error.message}`;
    }
  }

  async function startRematchIfReady() {
    if (
      user.uid !== lobby.hostId ||
      game?.phase !== "finished" ||
      rematchStarting
    )
      return;
    const players = playerEntries();
    if (
      !players.length ||
      players.some(([playerId]) => lobby.rematch?.[playerId] !== game.matchId)
    )
      return;
    const scores = Object.fromEntries(
      players.map(([playerId]) => [playerId, 0]),
    );
    rematchStarting = true;
    try {
      await set(ref(database, `lobbies/${lobbyCode}/game`), {
        phase: "pick",
        round: 1,
        pickerId: players[Math.floor(Math.random() * players.length)][0],
        scores,
        matchId: String(Date.now()),
        updatedAt: Date.now(),
      });
    } catch (error) {
      rematchStarting = false;
      throw error;
    }
  }

  async function leaveLobby() {
    if (!lobby) {
      window.location.href = "index.html";
      return;
    }
    elements.leave.disabled = true;
    try {
      if (user.uid === lobby.hostId) {
        await onDisconnect(ref(database, `lobbies/${lobbyCode}`)).cancel();
        await remove(ref(database, `lobbies/${lobbyCode}`));
      } else {
        const playerRef = ref(
          database,
          `lobbies/${lobbyCode}/players/${user.uid}`,
        );
        await onDisconnect(playerRef).cancel();
        await remove(playerRef);
      }
      window.location.href = "index.html";
    } catch (error) {
      elements.error.textContent = `Could not leave the lobby: ${error.message}`;
      elements.leave.disabled = false;
    }
  }

  elements.searchButton.addEventListener("click", searchAndShowGIFs);
  elements.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchAndShowGIFs();
  });
  elements.submitCaption.addEventListener("click", submitCaption);
  elements.caption.addEventListener("input", () => {
    elements.captionBar.textContent = elements.caption.value;
  });
  elements.rematch.addEventListener("click", playAgain);
  elements.leave.addEventListener("click", leaveLobby);

  try {
    const response = await fetch("/__/firebase/init.json");
    if (!response.ok)
      throw new Error(
        "Firebase Hosting could not provide this site's Firebase config.",
      );
    const firebaseConfig = await response.json();
    if (
      !firebaseConfig.databaseURL &&
      firebaseConfig.projectId === "mtech-game"
    ) {
      firebaseConfig.databaseURL =
        "https://mtech-game-default-rtdb.firebaseio.com";
    }
    const app = initializeApp(firebaseConfig);
    const credential = await signInAnonymously(getAuth(app));
    user = credential.user;
    database = getDatabase(app);
    setVisible(elements.gameView, true);
    onValue(
      ref(database, `lobbies/${lobbyCode}`),
      async (snapshot) => {
        lobby = snapshot.val();
        if (!lobby) {
          elements.message.textContent = "This lobby has been closed.";
          elements.leave.textContent = "Return to main menu";
          setVisible(elements.leave, true);
          setVisible(elements.rematch, false);
          return;
        }
        game = lobby.game;
        if (!game) {
          elements.message.textContent =
            "This lobby does not have an active game.";
          return;
        }
        if (!disconnectCleanupRegistered) {
          const disconnectRef =
            user.uid === lobby.hostId
              ? ref(database, `lobbies/${lobbyCode}`)
              : ref(database, `lobbies/${lobbyCode}/players/${user.uid}`);
          await onDisconnect(disconnectRef).remove();
          disconnectCleanupRegistered = true;
        }
        if (game.phase !== "finished") rematchStarting = false;
        render();
        advanceWhenAllCaptionsSubmitted();
        const decision =
          lobby.rounds?.[game.matchId]?.[game.round]?.votes?.[game.pickerId];
        if (user.uid === lobby.hostId && game.phase === "judge" && decision) {
          try {
            await finishRound(decision);
          } catch (error) {
            elements.error.textContent = `Could not score the round: ${error.message}`;
          }
        }
        try {
          await startRematchIfReady();
        } catch (error) {
          elements.error.textContent = `Could not start the rematch: ${error.message}`;
        }
      },
      (error) => {
        elements.error.textContent = `Could not load the game: ${error.message}`;
      },
    );
    setInterval(updateCountdown, 1000);
  } catch (error) {
    setVisible(elements.gameView, true);
    elements.message.textContent = "Could not connect to the game.";
    elements.error.textContent = error.message;
  }
}

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// --- Configuration EJS ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// --- Critères de notation ---
const CRITERES = [
  { id: "clarte_oral", label: "Clarté orale" },
  { id: "clarte_explication", label: "Clarté de l'explication" },
  { id: "qualite_demo", label: "Qualité de la démonstration" },
  { id: "cahier_charges", label: "Respect du cahier des charges" },
];

// --- État en mémoire ---
// votes = [{ id, prenom, clarte_oral, clarte_explication, qualite_demo, cahier_charges }]
let votes = [];

// --- Calcul des moyennes ---
function calculerMoyennes(votesArray) {
  if (votesArray.length === 0) {
    return CRITERES.reduce((acc, c) => ({ ...acc, [c.id]: 0 }), {});
  }
  const sommes = CRITERES.reduce((acc, c) => ({ ...acc, [c.id]: 0 }), {});
  for (const vote of votesArray) {
    for (const c of CRITERES) {
      sommes[c.id] += vote[c.id];
    }
  }
  const moyennes = {};
  for (const c of CRITERES) {
    moyennes[c.id] = (sommes[c.id] / votesArray.length).toFixed(2);
  }
  return moyennes;
}

function getEtatComplet() {
  return {
    votes,
    moyennes: calculerMoyennes(votes),
    nbVotes: votes.length,
  };
}

// --- Routes HTTP ---
app.get("/", (req, res) => {
  res.redirect("/vote");
});

app.get("/vote", (req, res) => {
  res.render("vote", { criteres: CRITERES });
});

app.get("/professeur", (req, res) => {
  res.render("professeur", { criteres: CRITERES });
});

// --- Gestion Socket.IO ---
io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  // Envoi de l'état initial au client qui se connecte (utile pour le prof qui rafraîchit)
  socket.emit("maj_votes", getEtatComplet());

  // --- Réception d'un nouveau vote étudiant ---
  socket.on("nouveau_vote", (data) => {
    const { prenom, notes } = data;

    if (!prenom || typeof prenom !== "string" || prenom.trim() === "") {
      socket.emit("erreur_vote", "Le prénom est requis.");
      return;
    }

    // Validation des notes (-2 à +2)
    for (const c of CRITERES) {
      const note = Number(notes[c.id]);
      if (Number.isNaN(note) || note < -2 || note > 2) {
        socket.emit("erreur_vote", `Note invalide pour ${c.label}.`);
        return;
      }
    }

    // Empêche un même prénom de voter deux fois pour la même présentation
    const dejaVote = votes.some(
      (v) => v.prenom.toLowerCase() === prenom.trim().toLowerCase()
    );
    if (dejaVote) {
      socket.emit("erreur_vote", "Vous avez déjà voté pour cette présentation.");
      return;
    }

    const vote = {
      id: randomUUID(),
      prenom: prenom.trim(),
      clarte_oral: Number(notes.clarte_oral),
      clarte_explication: Number(notes.clarte_explication),
      qualite_demo: Number(notes.qualite_demo),
      cahier_charges: Number(notes.cahier_charges),
    };

    votes.push(vote);

    // Confirmation à l'étudiant
    socket.emit("vote_confirme");

    // Diffusion de l'état mis à jour à tous (notamment le professeur)
    io.emit("maj_votes", getEtatComplet());

    console.log(`Vote reçu de ${vote.prenom}`);
  });

  // --- Suppression d'un vote par le professeur ---
  socket.on("supprimer_vote", (voteId) => {
    const index = votes.findIndex((v) => v.id === voteId);
    if (index !== -1) {
      const supprime = votes.splice(index, 1)[0];
      console.log(`Vote supprimé : ${supprime.prenom}`);
      io.emit("maj_votes", getEtatComplet());
    }
  });

  // --- Réinitialisation des votes par le professeur ---
  socket.on("reset_votes", () => {
    votes = [];
    console.log("Votes réinitialisés par le professeur");
    io.emit("maj_votes", getEtatComplet());
    io.emit("votes_reset"); // signal spécifique pour réactiver les formulaires étudiants
  });

  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
  });
});

// --- Démarrage du serveur ---
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log(`  - Page étudiant : http://localhost:${PORT}/vote`);
  console.log(`  - Page professeur : http://localhost:${PORT}/professeur`);
});

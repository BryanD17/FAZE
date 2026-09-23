import "./App.css";

function App() {
  return (
    <main className="home">
      <div className="hero">
        <p className="eyebrow">FIND YOUR GROUP</p>

        <h1>FAZE</h1>

        <p className="description">
          Find gamers who play the same games, at the same times,
          for the same reasons.
        </p>

        <button className="browseButton">
          Browse Groups →
        </button>
      </div>

      <div className="floatingCard cardOne">
        🎮 Valorant
      </div>

      <div className="floatingCard cardTwo">
        ⛏️ Minecraft
      </div>

      <div className="floatingCard cardThree">
        🏆 Ranked
      </div>
    </main>
  );
}

export default App;
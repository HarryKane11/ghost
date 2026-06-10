import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import OrbApp from "./OrbApp";
import "./styles.css";

// `#orb` 해시면 플로팅 오브 미니 창(투명) — 그 외엔 메인 앱.
const isOrb = window.location.hash.replace("#", "").startsWith("orb");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOrb ? <OrbApp /> : <App />}
  </StrictMode>
);

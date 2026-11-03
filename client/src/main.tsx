import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { ParticipantApp } from "./participant/App";
import { Display } from "./display/Display";
import { Console } from "./control/Console";
import { Facilitator } from "./facilitator/Facilitator";
import { Notes } from "./notes/Notes";

function Router() {
  const path = location.pathname.replace(/\/$/, "");
  if (path.endsWith("/display")) { document.body.classList.add("dark"); return <Display />; }
  if (path.endsWith("/control")) { document.body.classList.add("dark"); return <Console />; }
  if (path.endsWith("/facilitator")) { document.body.classList.add("dark"); return <Facilitator />; }
  if (path.endsWith("/notes")) { document.body.classList.add("dark"); return <Notes />; }
  return <ParticipantApp />;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Router /></React.StrictMode>);

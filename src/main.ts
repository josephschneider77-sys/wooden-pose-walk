import "./style.css";
import { startStudio } from "./studio";

const canvas = document.querySelector("#stage");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #stage canvas");
}

try {
  startStudio(canvas);
} catch (error) {
  const hint = document.querySelector("#hint");
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  if (hint) hint.textContent = message;
  console.error(error);
}

import "./style.css";
import { startStudio } from "./studio";

const canvas = document.querySelector("#stage");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #stage canvas");
}

startStudio(canvas);
